---
title: Editing in VS Code
description: Install Starboard's VS Code extension from a release, lint as you type, hover and jump from screen references in any file, and create, format and fix screens and flows from the editor.
---

Starboard's VS Code extension puts the reference in the editor. It lints
your screens and flows as you type, answers `@screen` references in any
file, marks the code that implements a screen, and creates screens and
flows from the Command Palette. It runs the same core as the `starboard`
command, compiled to WebAssembly inside the extension, so what it reports
is what `starboard lint` reports, and what it writes is what the CLI
writes. Nothing leaves your machine: there is no account, no server and no
telemetry.

## Install

The extension is not on the Visual Studio Marketplace. Install it from the
GitHub release, which carries one `.vsix` per version, named
`starboard-vscode-<version>.vsix`, and its checksum,
`starboard-vscode.sha256`:

```bash
gh release download v0.2.0 --repo c65llc/starboard --pattern 'starboard-vscode*'
sha256sum -c starboard-vscode.sha256        # shasum -a 256 -c on macOS
code --install-extension starboard-vscode-0.2.0.vsix
```

Or, in VS Code, open the Command Palette and run **Extensions: Install
from VSIX…**, then pick the file. It needs VS Code 1.105 or newer. Update
by installing the next release's `.vsix` over it.

The extension starts in a workspace that holds a `starboard.yaml`.

## What it does

### Lint as you type

Every finding `starboard lint` reports shows in the Problems panel, on the
line it names. A finding's code is the rule's ID and links to the rule's
page. The extension follows the editor, not the disk: an unsaved change is
linted when you pause typing (300 ms by default), and closing a file
without saving puts the findings back to what is on disk.

### References

In any file (a flow, a source file or a comment, in any language), a
screen reference such as `@auth.sign-in` or `@auth.sign-in#form` does
three things:

- **Hover** shows a card for the screen: its title, ID, area,
  presentation, purpose and status, the flows that use it, the region if
  the reference names one, and a link to open the screen in a panel.
- **Go to Definition** opens the screen's entry in `screens.yaml`.
- **Completion** offers screen IDs after `@`, and region names after `#`.

This works in a Swift or Kotlin comment with no language extension
installed.

### The CodeLens

A source file that a screen lists in its `files` gets a lens on its first
line, `Starboard: <screen id>`. Click it to open that screen in a panel.

### Commands

In the Command Palette, in the **Starboard** category:

| Command | What it does |
| --- | --- |
| **New Screen** | Asks for the ID, title, area and presentation, then adds the screen to `screens.yaml` the way `starboard new screen` does. |
| **New Flow** | Asks for the ID and title, then writes `flows/<id>.md` the way `starboard new flow` does. |
| **Format Project** | Formats every file, as `starboard fmt` does. |
| **Fix Automatically** | Applies the fixes lint knows, as `starboard fix` does. |
| **Open App Map** | Opens the app map in a panel. |
| **Open Screen…** | Picks a screen and opens it in a panel. |
| **Open Flow…** | Picks a flow and opens it in a panel. |

Each write edits the open buffers and then saves them: an unsaved change of
yours is kept, never overwritten, and nothing is written behind it.

### The panels

The screen, flow and app map views are the web app's, in a VS Code panel.
They show wireframes, flows, the app map and the findings, and read the
project as the editor holds it, unsaved changes included. An edit made in a
panel is written as the commands write. If you have typed in a file since
the panel read it, the panel reads again instead of writing over your
change.

The panel needs no browser and no network. It runs only its own bundled
script, under a Content Security Policy that allows nothing else.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `starboard.lint.debounceMs` | `300` | How long, in milliseconds, to wait after the last keystroke before linting the project again. |

## Several projects in one workspace

Every folder in the workspace that holds a `starboard.yaml` is a project,
with its own copy of the core. A file belongs to the nearest project above
it, so a workspace can hold several projects, in several roots or one
inside another. A file under no project gets no findings, no hovers and no
lenses. Commands that need a project ask which one when the active file
does not say.

## Building it yourself

The extension lives in [`web/vscode/`](https://github.com/c65llc/starboard/tree/main/web/vscode), in the `web/`
pnpm workspace, and needs Node 24 and Go:

```bash
make vscode-test                        # the integration tests, in VS Code 1.105.0
make vscode-package                     # web/vscode/starboard-vscode-0.0.0-dev.vsix and its checksum
make vscode-package VERSION=0.2.0
```

Each release's `.vsix` is built by the release workflow and attached to
the release before it is published. [`docs/releasing.md`](https://github.com/c65llc/starboard/blob/main/docs/releasing.md)
has the procedure.
