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
> nothing is installable yet.

Website: <https://starboard.c65llc.com> (coming with the first release).

## License

Copyright © 2026 C65 LLC. Starboard is free software, licensed under the
[GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`).
