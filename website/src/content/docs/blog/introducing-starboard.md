---
title: Introducing Starboard
description: Why Starboard exists, what its first 0.x releases include, and how to try it on your own repository in a few minutes.
date: 2026-11-27
authors: c65
excerpt: A plain-text reference for your product's screens and user flows, kept in the repository and checked in CI, so every platform adapts the same design.
---

Starboard keeps the canonical screens and user flows of a product as plain
text in its repository, so each platform adapts one reference, and CI says
when the code and the reference disagree.

## Why it exists

A product that ships on iOS, Android and the web starts from one design.
After a few releases, the platforms have drifted apart: a screen gained a
region on one of them, a flow takes an extra step on another, and the
original design file no longer matches any of them. The usual fix is to
treat whichever platform shipped first as the spec. Then "what should this
screen contain?" is answered by reading that platform's code, and every
other platform follows it, including its accidents.

Coding agents make this sharper. An agent asked to "build the trip
timeline on Android" will happily copy the iOS view if that is the only
description of the screen it can find.

Starboard gives the design a home that is neither a platform's code nor a
picture: a registry of screens with stable IDs and named layout regions,
and Markdown flows whose steps refer to those screens by ID. It is text, so
it is reviewed in pull requests, merged with Git and edited by agents like
any other file. It is checked, so it cannot quietly rot.

## What 0.x includes

- **The `starboard` command**, a single binary for macOS, Linux and
  Windows on amd64 and arm64: `init`, `fmt`, `lint`, `rules`, `generate`,
  `render`, `schema`, `skills` and `version`.
- **A linter with stable rule IDs.** Each rule has a page under
  [Rules](/rules/file-missing/), and `starboard lint --json` gives a
  machine-readable report for CI annotations and coding agents. It also
  fails when a file is not in canonical form or when the generated pages are
  out of date, so one command is the whole check.
- **Generated pages:** an app map, a screen catalog and grey-box
  wireframes for every screen at every form factor, written into your
  repository by `starboard generate`. The
  [travel-app example](/examples/travel-app/) shows all three.
- **A GitHub Action** that downloads a released binary, checks its SHA-256
  against the release's checksums and runs it.
- **The web app** at [/app/](/app/), which opens a project folder from
  your disk to browse, walk through and edit its screens and flows. It runs
  the same core as the CLI, compiled to WebAssembly, so it lints exactly as
  CI does. Nothing leaves your device.
- **Agent skills** for Claude Code, Cursor, Copilot, Codex, Gemini and
  Aider: short runbooks that keep an agent's edits formatted and lint-clean,
  and hooks that run `starboard fmt` and `starboard lint` after each edit.

Starboard is not a UI framework and does not generate platform code. It
describes what each screen contains and how the screens connect; each
platform's code stays its own.

## Try it

With Go 1.27 or later:

```text
go install github.com/c65llc/starboard/cmd/starboard@latest
```

Or download a release archive and its `checksums.txt` from the
[releases page](https://github.com/c65llc/starboard/releases); the
[install guide](/getting-started/install/) covers both. Then, at the root
of your app's repository:

```bash
starboard init --platform ios --platform web
starboard lint
```

[Your first project](/getting-started/first-project/) takes it from there:
two screens, one flow, and the generated pages. To see a finished project
first, open the web app and choose **Explore the example project**.

Starboard is free software under the AGPL ([what that means for you](/agpl/)),
developed in the open at
[github.com/c65llc/starboard](https://github.com/c65llc/starboard). Issues
and pull requests are welcome.
