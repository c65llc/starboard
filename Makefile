# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026 C65 LLC

SHELL := /bin/bash

COVERAGE_MIN  ?= 95
COVERPROFILE  := coverage.out
# golangci-lint from PATH, else where `go install` puts it.
GOLANGCI_LINT ?= $(or $(shell command -v golangci-lint 2>/dev/null),$(shell go env GOPATH)/bin/golangci-lint)

.DEFAULT_GOAL := help

.PHONY: help ci test cover lint actionlint wasm-vet fmt-check tidy-check spdx build examples-check docs-kinds docs-kinds-check wasm web-install web-test web-e2e vscode-test vscode-package site sync-standards diff-standards worktree-gc

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

ci: fmt-check spdx lint actionlint wasm-vet test cover tidy-check examples-check docs-kinds-check ## The Go gate; mirrors ci.yml's test, lint and actionlint jobs (the web job is make web-test web-e2e)

test: ## Run every test with the race detector and write coverage.out
	go test -race -coverprofile=$(COVERPROFILE) ./...

# Each package's share of coverage.out is fed to `go tool cover -func`, whose
# "total:" line is that package's statement-weighted coverage. Then every
# package `go list` reports with non-test Go files but that is absent from
# coverage.out is instrumented on its own: if that profile has any block, the
# package has statements nobody measured, and fails; if not (only
# declarations), it has nothing to cover and is skipped.
cover: test ## Fail if any package is under $(COVERAGE_MIN)% statement coverage
	@set -euo pipefail; \
	tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	mode=$$(head -n 1 $(COVERPROFILE)); \
	pkgs=$$(tail -n +2 $(COVERPROFILE) | sed -E 's|/[^/]+\.go:.*||' | sort -u); \
	fail=0; \
	for pkg in $$pkgs; do \
		{ echo "$$mode"; tail -n +2 $(COVERPROFILE) | awk -v pkg="$$pkg" '{ d = $$1; sub(/:.*/, "", d); sub(/\/[^\/]+$$/, "", d); if (d == pkg) print }'; } > "$$tmp/p.out"; \
		pct=$$(go tool cover -func="$$tmp/p.out" | awk '/^total:/ { sub(/%/, "", $$NF); print $$NF }'); \
		if awk -v p="$$pct" -v m="$(COVERAGE_MIN)" 'BEGIN { exit !(p + 0 < m + 0) }'; then \
			printf 'FAIL %6s%%  %s\n' "$$pct" "$$pkg"; fail=1; \
		else \
			printf 'ok   %6s%%  %s\n' "$$pct" "$$pkg"; \
		fi; \
	done; \
	listed=$$(go list -f '{{if .GoFiles}}{{.ImportPath}}{{end}}' ./...); \
	for pkg in $$listed; do \
		if printf '%s\n' "$$pkgs" | grep -qxF -- "$$pkg"; then continue; fi; \
		go test -count=1 -run '^$$' -coverprofile="$$tmp/m.out" "$$pkg" > /dev/null; \
		if [ -n "$$(tail -n +2 "$$tmp/m.out")" ]; then \
			printf 'FAIL  absent  %s (has statements, but is not in $(COVERPROFILE))\n' "$$pkg"; fail=1; \
		else \
			printf 'ok         -  %s (no statements)\n' "$$pkg"; \
		fi; \
	done; \
	if [ "$$fail" -ne 0 ]; then echo "cover: packages above are under $(COVERAGE_MIN)% or unmeasured" >&2; exit 1; fi

lint: ## golangci-lint with .golangci.yml; any finding fails
	$(GOLANGCI_LINT) run

# actionlint, pinned here and nowhere else: `go run` builds that exact
# module version, which the Go checksum database verifies. It runs
# shellcheck over each run: script when shellcheck is on PATH (it is on
# ubuntu-latest), so install it locally for the same result as CI.
ACTIONLINT_VERSION := v1.7.12

actionlint: ## Lint .github/workflows/*.yml with actionlint (and shellcheck, when installed)
	go run github.com/rhysd/actionlint/cmd/actionlint@$(ACTIONLINT_VERSION)

# The js/wasm entry point builds only for GOOS=js, so the plain `go vet`
# in golangci-lint never sees it.
wasm-vet: ## go vet the WebAssembly entry point for GOOS=js GOARCH=wasm
	GOOS=js GOARCH=wasm go vet ./cmd/starboard-wasm/...

fmt-check: ## Fail if gofmt would change any file, or cannot read one
	@set -euo pipefail; \
	files=(); \
	while IFS= read -r -d '' f; do if [ -f "$$f" ]; then files+=("$$f"); fi; done \
		< <(git ls-files -z --cached --others --exclude-standard -- '*.go'); \
	if [ "$${#files[@]}" -eq 0 ]; then exit 0; fi; \
	out=$$(gofmt -l -- "$${files[@]}") || { echo "fmt-check: gofmt failed" >&2; exit 1; }; \
	if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi

tidy-check: ## Fail if go.mod or go.sum is untidy, uncommitted or untracked
	@set -euo pipefail; \
	go mod tidy -diff || { echo "tidy-check: run go mod tidy" >&2; exit 1; }; \
	st=$$(git status --porcelain -- go.mod go.sum); \
	if [ -n "$$st" ]; then echo "tidy-check: go.mod or go.sum is not committed:"; echo "$$st"; exit 1; fi

spdx: ## Fail if any Go or TypeScript file lacks the SPDX and copyright header
	./scripts/check-spdx.sh

build: ## Build the CLI to bin/starboard
	go build -o bin/starboard ./cmd/starboard

# Every project under examples/ must stay clean, and the web app bundles
# examples/travel-app: strict lint also fails on unformatted files and stale
# generated pages, so zero findings means canonical and current too.
EXAMPLES := $(patsubst %/,%,$(wildcard examples/*/))

examples-check: build ## Lint every project under examples/ with --strict
	@set -e; for dir in $(EXAMPLES); do \
		echo "starboard --dir $$dir lint --strict"; \
		bin/starboard --dir "$$dir" lint --strict; \
	done

# docs/reference/screens-yaml.md shows each region kind's YAML beside the
# wireframe starboard renders from it. The YAML is docs/reference/kinds/<kind>.yaml;
# docs-kinds renders <kind>.svg next to it, and docs-kinds-check fails if
# the committed pictures differ from a fresh render, or one is missing or extra.
KINDS_DIR := docs/reference/kinds

docs-kinds: build ## Render docs/reference/kinds/<kind>.svg from each <kind>.yaml
	./scripts/docs-kinds.sh bin/starboard $(KINDS_DIR) $(KINDS_DIR)

docs-kinds-check: build ## Fail if docs/reference/kinds/*.svg differ from what make docs-kinds renders
	@set -euo pipefail; \
	tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	./scripts/docs-kinds.sh bin/starboard $(KINDS_DIR) "$$tmp"; \
	if [ "$$(cd "$$tmp" && ls)" != "$$(cd $(KINDS_DIR) && ls -- *.svg)" ]; then \
		echo "docs-kinds-check: the .svg files in $(KINDS_DIR) do not match its .yaml fixtures; run make docs-kinds" >&2; exit 1; \
	fi; \
	for f in "$$tmp"/*.svg; do \
		if ! cmp -s "$$f" "$(KINDS_DIR)/$$(basename "$$f")"; then \
			echo "docs-kinds-check: $(KINDS_DIR)/$$(basename "$$f") is stale; run make docs-kinds" >&2; exit 1; \
		fi; \
	done

WASM_DIST := web/core/dist

# wasm_exec.js is the JavaScript half of Go's js/wasm ABI, so it is copied
# from the very toolchain that builds starboard.wasm, never vendored.
wasm: ## Build web/core/dist/starboard.wasm and copy the matching wasm_exec.js
	@mkdir -p $(WASM_DIST)
	GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o $(WASM_DIST)/starboard.wasm ./cmd/starboard-wasm
	cp "$$(go env GOROOT)/lib/wasm/wasm_exec.js" $(WASM_DIST)/wasm_exec.js

# pnpm runs from inside web/: corepack picks the pnpm version from the
# packageManager field of the package.json nearest the working directory,
# and `pnpm -C web` from the root would run whatever pnpm is the default.
web-install: ## Install web/ dependencies from the committed lockfile
	cd web && pnpm install --frozen-lockfile

# The core tests compare the bundle against the CLI, so they need
# bin/starboard as well as the bundle. This is what the CI job `web` runs.
# pnpm -r covers every package of the workspace, so web/vscode's Vitest
# unit tests run here too; its integration tests are make vscode-test.
web-test: build wasm web-install ## Lint, build and test the web/ workspace (web/vscode's unit tests included)
	cd web && pnpm lint
	cd web && pnpm build
	cd web && pnpm test

# Playwright against `vite preview` of web/app's production build, on
# Chromium, WebKit and Firefox (the CI job installs them with --with-deps).
web-e2e: web-test ## Run web/app's Playwright tests
	cd web/app && pnpm exec playwright install chromium webkit firefox
	cd web/app && pnpm e2e

# The extension's integration tests, in VS Code 1.105.0 (engines.vscode's
# floor), which @vscode/test-electron downloads to web/vscode/.vscode-test/
# on the first run. On Linux without a display, run it under xvfb-run -a,
# as the CI job vscode does.
vscode-test: build wasm web-install ## Build web/vscode and run its integration tests in VS Code 1.105.0
	cd web/vscode && pnpm run test:integration

# Packages the extension as web/vscode/starboard-vscode-$(VERSION).vsix and
# writes its SHA-256 beside it. vsce stamps VERSION into the package.json it
# packs and, with --no-update-package-json, leaves the committed file at
# 0.0.0-dev. LICENSE is committed in web/vscode so the .vsix carries it.
# release.yml runs this in its own job, away from the write token; the
# .vsix is built by `make vscode-package VERSION=<tag without the v>` and
# scripts/check-vsix.sh checks the result.
VERSION ?= 0.0.0-dev
vscode-package: build wasm web-install ## Package web/vscode as starboard-vscode-$(VERSION).vsix, with its SHA-256
	rm -f web/vscode/starboard-vscode-*.vsix web/vscode/starboard-vscode.sha256
	cd web/vscode && pnpm run build
	cd web/vscode && pnpm exec vsce package $(VERSION) --no-dependencies --no-update-package-json --no-git-tag-version --out starboard-vscode-$(VERSION).vsix
	cd web/vscode && (sha256sum starboard-vscode-$(VERSION).vsix 2>/dev/null || shasum -a 256 starboard-vscode-$(VERSION).vsix) > starboard-vscode.sha256

# The website (starboard.c65llc.com), as ci.yml's site job (site.yml) runs
# it: the PWA is built first because the site publishes it at /app/, and the
# checks compare the site with bin/starboard. pnpm runs inside website/.
site: build wasm web-install ## Build starboard.c65llc.com into website/dist and run its checks and Playwright tests
	cd web && pnpm build
	cd website && pnpm install --frozen-lockfile
	cd website && pnpm exec playwright install chromium
	cd website && pnpm build
	bash website/scripts/test-csp-postbuild.sh
	bash website/scripts/test-check-links.sh
	cd website && pnpm test:unit
	node website/scripts/site-check.mjs
	node website/scripts/check-links.mjs
	cd website && pnpm e2e

# --- coding-standards targets (as written by .standards' install.sh) ---------

sync-standards: ## Sync project standards to latest version (run from project root)
	@if [ -d ".standards" ]; then \
		./.standards/scripts/sync-standards.sh; \
	else \
		echo "❌ .standards directory not found. Run install script first."; \
		exit 1; \
	fi

diff-standards: ## Show what sync-standards would change (add --exit-code to gate CI)
	@if [ -d ".standards" ]; then \
		./.standards/scripts/diff-standards.sh; \
	else \
		echo "❌ .standards directory not found. Run install script first."; \
		exit 1; \
	fi

worktree-gc: ## Remove merged, gone and idle agent worktrees; report the rest (ARGS="--dry-run" to preview)
	@if [ -d ".standards" ]; then \
		./.standards/scripts/worktree-gc.sh $(ARGS); \
	else \
		echo "❌ .standards directory not found. Run install script first."; \
		exit 1; \
	fi
