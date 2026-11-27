---
title: CLI
description: Every starboard command and flag, its output and its exit status.
---

`starboard` works on the project that holds the working directory: it looks
for `starboard.yaml` there, then in each parent directory. Every example on
this page runs, as written, in Starboard's tests: the commands that need a
project against a copy of `examples/travel-app`, and `init` in an empty
directory.

## Usage

<!-- verified: empty -->
```bash
starboard --help
```

<!-- output -->
```text
Usage: starboard [--dir D] <command> [flags]

Commands:
  init [--platform P]...                          Write a new project: starboard.yaml, docs/flows and .gitattributes lines.
  fmt [--check]                                   Rewrite the project's files in canonical form, listing each one.
  lint [--json] [--fix] [--strict]                Check the project and report its errors and warnings.
  rules [--json]                                  List every lint rule: its ID, kind, default severity and summary.
  generate [--check]                              Write <content>/generated: the app map, the screen catalog and the wireframes.
  render [--form-factor F] [-o FILE] <screen-id>  Print one screen's wireframe SVG.
  schema <config|screens>                         Print the JSON Schema for starboard.yaml (config) or screens.yaml (screens).
  skills install [--agent A]... [--dry-run]       Install the skills for each agent the project uses, or each --agent.
  skills list                                     List the skills this release carries.
  skills hooks <agent|pre-commit>                 Print configuration that runs fmt and lint after edits; edits nothing.
  version                                         Print starboard's version.

Flags:
  --dir D  work in directory D (default: the working directory)

Exit status: 0 clean, 1 findings, 2 usage error or no project.
```

`starboard <command> --help` prints one command's usage and flags. Flags
may come before or after a command's arguments.

## Global flags

| Flag | Meaning |
| --- | --- |
| `--dir D` | Work in directory D instead of the working directory. It comes before the command. |

<!-- verified: examples/travel-app in app -->
```bash
starboard --dir app lint
```

`--dir` changes where the project is looked for, not how paths you type are
read: `render -o` is still relative to the working directory.

## Exit status

| Status | Meaning |
| --- | --- |
| `0` | The command succeeded, with nothing to report. |
| `1` | Findings: `lint` found errors (or warnings, with `--strict`); `fmt --check` or `generate --check` would change files; `fmt` or `generate` found errors in the project; or `fmt` could not format a file. |
| `2` | A usage error, no `starboard.yaml` in the directory or any parent, or a command that could not run. |

## `starboard init`

```text
starboard [--dir D] init [--platform P]...
```

Writes a new project in the directory: `starboard.yaml`,
`docs/flows/README.md`, `docs/flows/screens.yaml` with one example screen,
`docs/flows/flows/example.md`, the generated pages, and lines in
`.gitattributes` that keep the files' line endings the same on every
operating system. It lists every file it writes. It refuses, changing
nothing, if any of the files it would write already exists.

| Flag | Meaning |
| --- | --- |
| `--platform P` | Add platform P; ios, android and web get suggested settings. Repeat it for each platform. |

<!-- verified: empty -->
```bash
starboard init --platform macos --platform web
```

<!-- verified-contents: empty starboard.yaml -->
```yaml
version: 1
platforms:
  macos: {}
  web:
    formFactors: [web-narrow, web-wide]
    screenFiles: ['**/*.{tsx,svelte,vue}']
areas: [home]
```

A platform other than `ios`, `android` and `web` starts with no settings;
add its `formFactors`, `roots` and `screenFiles` yourself. See
[Your first project](../../getting-started/first-project/).

## `starboard fmt`

```text
starboard [--dir D] fmt [--check]
```

Rewrites `starboard.yaml`, `screens.yaml` and every flow file in canonical
form, and lists each file it changed. Canonical form fixes key order,
indentation and the order of screens; it keeps comments. Formatting a
formatted file changes nothing, and a file whose only difference is CRLF
line endings counts as formatted.

Errors in the project are printed to stderr and make `fmt` exit 1, but every
file that can be formatted still is. A file `fmt` cannot format safely is
reported as `cannot format <path>: <reason>`.

| Flag | Meaning |
| --- | --- |
| `--check` | List the files fmt would change, change nothing, and exit 1 if any. |

<!-- verified: examples/travel-app -->
```bash
starboard fmt
starboard fmt --check
```

## `starboard lint`

```text
starboard [--dir D] lint [--json] [--fix] [--strict]
```

Checks the project and prints each finding, then a count. Correctness
findings are always errors; quality findings are warnings unless
`starboard.yaml` sets their severity. `lint` exits 1 when there is an error.
It includes the checks `fmt --check` and `generate --check` make, as the
rules [not-formatted](../../rules/not-formatted/) and
[generated-stale](../../rules/generated-stale/).

| Flag | Meaning |
| --- | --- |
| `--json` | Print the findings as a versioned JSON report. See [JSON output](../json-output/). |
| `--fix` | First format the sources and regenerate `<content>/generated`, listing each file, then lint. A project with errors that stop it loading is not fixed. With `--json`, the list goes to stderr. |
| `--strict` | Exit 1 on warnings as well as errors. |

<!-- verified: examples/travel-app -->
```bash
starboard lint
starboard lint --strict
starboard lint --fix
starboard lint --json
```

A finding reads `<file>:<line>: <severity> <rule>: <message>`, with the
line left out when there is none. Each rule has a page at
`https://starboard.c65llc.com/rules/<rule>/`; [JSON output](../json-output/#rules)
lists them all.

## `starboard rules`

```text
starboard [--dir D] rules [--json]
```

Lists every lint rule: its ID, whether it is a correctness or a quality
rule, its default severity and a one-sentence summary. It needs no project.

| Flag | Meaning |
| --- | --- |
| `--json` | Print the rules as a versioned JSON report, each with its documentation page. |

<!-- verified: empty -->
```bash
starboard rules
starboard rules --json
```

## `starboard generate`

```text
starboard [--dir D] generate [--check]
```

Writes `<content>/generated/`: `app-map.md`, `screens.md` and one wireframe
per screen per form factor under `wireframes/`. It writes only files whose
content changes, prints `wrote <path>` for each, and removes, printing
`removed <path>`, a wireframe it no longer generates, such as a deleted
screen's. It never touches other files under `generated/`. A project with
errors that stop it loading is refused, with exit status 1.

| Flag | Meaning |
| --- | --- |
| `--check` | List what generate would write or remove, change nothing, and exit 1 if anything. |

<!-- verified: examples/travel-app -->
```bash
starboard generate
starboard generate --check
```

`--check` prints `would write <path>` and `would remove <path>`.

## `starboard render`

```text
starboard [--dir D] render [--form-factor F] [-o FILE] <screen-id>
```

Prints one screen's wireframe as SVG, the same bytes `generate` writes for
it. It is for trying out a layout without regenerating everything.

| Flag | Meaning |
| --- | --- |
| `--form-factor F` | Draw form factor F (default: the screen's first). Any configured form factor works, not only the screen's own. |
| `-o FILE` | Write the SVG to FILE, an .svg path relative to the working directory or absolute, instead of stdout. |

<!-- verified: examples/travel-app -->
```bash
starboard render trip.timeline --form-factor web-wide -o timeline.svg
```

<!-- output -->
```text
wrote timeline.svg
```

`-o` must end in `.svg`, so it can never overwrite a source file, and it
writes the file whole or not at all. An unknown screen or form factor is a
usage error, exit 2.

## `starboard schema`

```text
starboard [--dir D] schema <config|screens>
```

Prints the JSON Schema for `starboard.yaml` (`config`) or `screens.yaml`
(`screens`). It needs no project. See [JSON Schemas](../schemas/).

<!-- verified: empty -->
```bash
starboard schema config
starboard schema screens
```

## `starboard skills install`

```text
starboard [--dir D] skills install [--agent A]... [--dry-run]
```

Installs Starboard's agent skills for each coding agent the project already
uses, or for each `--agent`. Without `--agent`, it detects the agents from
files at the project root, such as `.claude/` or `AGENTS.md`, and stops if
it finds none. Files you have edited since Starboard installed them are
kept, and the new version is staged under `.starboard/pending/`.
[Working with coding agents](../../guides/agents/) covers the details.

| Flag | Meaning |
| --- | --- |
| `--agent A` | Install for agent A: claude-code, cursor, copilot, codex, gemini or aider. Repeat it for each agent. |
| `--dry-run` | List what install would write or stage, and change nothing. |

<!-- verified: examples/travel-app -->
```bash
starboard skills install --agent claude-code --dry-run
starboard skills install --agent claude-code
```

## `starboard skills list`

```text
starboard [--dir D] skills list
```

Lists the skills this release carries, with what each is for.

<!-- verified: empty -->
```bash
starboard skills list
```

<!-- output -->
```text
starboard            Use when reading or editing a project's Starboard reference (screens.yaml, flow files or starboard.yaml), so every edit stays formatted, lint-clean and in step with the generated pages.
starboard-adopt      Use when adding Starboard to an existing app, to bootstrap the screen registry and flows from the code area by area, keeping starboard lint passing at every commit.
starboard-implement  Use when building proposed Starboard screens, regions or flows on one named platform, to implement them in that platform's code and mark them shipped in the same change.
starboard-propose    Use when planning a new or changed screen, region or user flow, to express the change in the Starboard reference as proposed items for review before any platform code is written.
```

## `starboard skills hooks`

```text
starboard [--dir D] skills hooks <agent|pre-commit>
```

Prints configuration that runs `starboard fmt` and `starboard lint` after
edits, and edits no file: a Claude Code hook for `claude-code`, a git hook
script for `pre-commit`, and for `cursor`, `copilot`, `codex`, `gemini` and
`aider`, which have no edit hook, a paragraph for the agent's instructions
file. A note on where to put it goes to stderr.

<!-- verified: examples/travel-app -->
```bash
starboard skills hooks claude-code
starboard skills hooks pre-commit
starboard skills hooks codex
```

## `starboard version`

```text
starboard [--dir D] version
```

Prints `starboard` and the version: the release's for a release binary,
the module's for `go install`, and `dev` for a build from a source checkout.

<!-- verified: empty -->
```bash
starboard version
```

## Internal commands

`starboard hook claude-code` is not in the usage: it is the command the
Claude Code hook that `starboard skills hooks claude-code` prints runs
after each edit. It reads the hook's input on stdin, and exits 2 with the
findings when the edited file breaks the reference, which Claude Code hands
back to the agent. See
[Working with coding agents](../../guides/agents/#claude-code).
