# Starboard for VS Code

[Starboard](https://starboard.c65llc.com) keeps an app's screens and flows
as files beside its code: `starboard.yaml`, a `screens.yaml` registry and a
folder of flows. This extension brings Starboard into the editor: lint as you
type, `@screen` references you can hover and follow, and commands to create,
format and fix screens and flows. The full guide is
[Editing in VS Code](https://starboard.c65llc.com/guides/vscode/).

## Install

The extension is not on the Visual Studio Marketplace. Download
`starboard-vscode-<version>.vsix` from the
[latest release](https://github.com/c65llc/starboard/releases/latest), then
run **Extensions: Install from VSIX…** from the Command Palette. It needs
VS Code 1.105 or newer.

## Lint as you type

Every folder in the workspace that holds a `starboard.yaml` is a project.
The extension lints each project as you type, about 300 ms after the last
keystroke, and lists the findings in the Problems panel. It lints the text
in your editors, saved or not, so a finding appears before you save and
goes away when you undo. Each finding links to its rule's page.

The extension reads a project's files as the `starboard` CLI does,
including any `node_modules` folder a configured root reaches, so the
editor's findings are the CLI's. Only `.git` is never read.

A file belongs to the nearest project above it. A workspace can hold
several projects, in different folders or one inside another, and a file
outside every project gets no findings.

The extension runs Starboard's own core, built to WebAssembly from the
same code as the `starboard` CLI, inside VS Code: nothing else is installed
and nothing leaves your machine.

## References, the CodeLens and the panels

`@auth.sign-in` in any file, in any language, hovers and goes to its
definition, and completes after `@` and `#`. A source file a screen lists in
`files` gets a `Starboard: <screen id>` lens that opens the screen in a
panel. **Open App Map**, **Open Screen…** and **Open Flow…** open the web
app's views in a VS Code panel, which needs no browser.

## Commands

**New Screen**, **New Flow**, **Format Project** and **Fix Automatically**
write what the `starboard` CLI writes, into the open buffers, then save each
file that had no unsaved changes. A file you had already changed and not
saved gets the write in its buffer and stays unsaved, for you to save.

## Settings

| Setting                     | Default | What it does                                                         |
| --------------------------- | ------- | -------------------------------------------------------------------- |
| `starboard.lint.debounceMs` | `300`   | How long, in milliseconds, to wait after the last keystroke to lint. |

## Licence

AGPL-3.0-only. See `LICENSE`.
