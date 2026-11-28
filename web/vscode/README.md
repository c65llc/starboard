# Starboard for VS Code

[Starboard](https://starboard.c65llc.com) keeps an app's screens and flows
as files beside its code: `starboard.yaml`, a `screens.yaml` registry and a
folder of flows. This extension brings Starboard's lint into the editor.

## Lint as you type

Every folder in the workspace that holds a `starboard.yaml` is a project.
The extension lints each project as you type, about 300 ms after the last
keystroke, and lists the findings in the Problems panel. It lints the text
in your editors, saved or not, so a finding appears before you save and
goes away when you undo. Each finding links to its rule's page.

A file belongs to the nearest project above it. A workspace can hold
several projects, in different folders or one inside another, and a file
outside every project gets no findings.

The extension runs Starboard's own core, built to WebAssembly from the
same code as the `starboard` CLI, inside VS Code: nothing else is installed
and nothing leaves your machine.

## Settings

| Setting                     | Default | What it does                                                         |
| --------------------------- | ------- | -------------------------------------------------------------------- |
| `starboard.lint.debounceMs` | `300`   | How long, in milliseconds, to wait after the last keystroke to lint. |

## Licence

AGPL-3.0-only. See `LICENSE`.
