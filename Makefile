# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026 C65 LLC

SHELL := /bin/bash

COVERAGE_MIN  ?= 95
COVERPROFILE  := coverage.out
# golangci-lint from PATH, else where `go install` puts it.
GOLANGCI_LINT ?= $(or $(shell command -v golangci-lint 2>/dev/null),$(shell go env GOPATH)/bin/golangci-lint)

.DEFAULT_GOAL := help

.PHONY: help ci test cover lint fmt-check tidy-check spdx build wasm web-install web-test sync-standards diff-standards worktree-gc

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

ci: fmt-check spdx lint test cover tidy-check ## The Go gate; mirrors ci.yml's test and lint jobs (the web job is make web-test)

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
web-test: build wasm web-install ## Lint, build and test the web/ workspace
	cd web && pnpm lint
	cd web && pnpm build
	cd web && pnpm test

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
