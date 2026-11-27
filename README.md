# Starboard

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

**The canonical user flows and screen layouts of your product, kept as plain
text in your repo — so every platform adapts one reference, and CI tells you
when the code and the reference disagree.**

Starboard is a CLI (plus a local-first PWA editor) for teams shipping one
product on several platforms — iOS, Android, web, desktop. It gives you:

- a **screen registry** with stable IDs, layout regions, and the source files
  that implement each screen on each platform;
- **flow documents** — Mermaid diagrams and steps that refer to screens by ID;
- **generated grey-box wireframes**, an app map and a screen catalog;
- a **formatter and linter** with stable rule IDs and JSON output, built for
  co-editing with AI agents;
- **agent skills** so Claude Code, Codex, Cursor, Gemini and others know how to
  work with it.

> **Status:** pre-release. The design is in
> [`docs/specs/2026-11-26-starboard-design.md`](docs/specs/2026-11-26-starboard-design.md);
> the first installable release is `v0.1.0`.

Website: <https://starboard.c65llc.com> (coming with the first release).

## Install

Starboard is one static binary for macOS, Linux and Windows, on amd64 and
arm64.

**Binary download.** Each [release](https://github.com/c65llc/starboard/releases)
has `starboard_<version>_<os>_<arch>.tar.gz` (`.zip` for Windows) and a
`checksums.txt` of SHA-256 sums. Verify before you run it:

```bash
v=0.1.0 os=linux arch=amd64   # os: linux | darwin | windows; arch: amd64 | arm64
base="https://github.com/c65llc/starboard/releases/download/v$v"
curl -fsSLO "$base/starboard_${v}_${os}_${arch}.tar.gz"
curl -fsSLO "$base/checksums.txt"
sha256sum -c --ignore-missing checksums.txt   # macOS: shasum -a 256 -c --ignore-missing checksums.txt
tar -xzf "starboard_${v}_${os}_${arch}.tar.gz" starboard && ./starboard version
```

**Go.** With Go installed:

```bash
go install github.com/c65llc/starboard/cmd/starboard@v0.1.0
```

A `go install` build reports its version as `dev`; release binaries carry
the release version.

**GitHub Action.** Run Starboard in CI without installing anything:

```yaml
- uses: c65llc/starboard@v0
  with:
    version: v0.1.0          # required: the exact release to download
    args: lint               # default; split on whitespace, e.g. "lint --strict"
    working-directory: .     # default
```

The action downloads that release's archive for the runner (Linux, macOS or
Windows; x64 or arm64), checks it against `checksums.txt` and fails before
running anything if the SHA-256 does not match. `@v0` is a floating tag that
follows the latest 0.x release; at 1.0.0 the floating tag becomes `@v1`. The
binary itself is pinned by `version`; pin the action to a commit SHA too if
your policy requires it. Maintainers: [`docs/releasing.md`](docs/releasing.md).

## License

Copyright © 2026 C65 LLC. Starboard is free software, licensed under the
[GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`).
