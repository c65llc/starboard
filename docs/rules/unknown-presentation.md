---
title: unknown-presentation
description: A screen's presentation is not root, push, tab, sheet, dialog, window or route.
---

## What it catches

A screen whose `presentation` is not one of `root`, `push`, `tab`, `sheet`,
`dialog`, `window` or `route`.

## Why it matters

The presentation says how a person arrives at the screen, and the wireframe
draws the screen's frame from it: a sheet or a dialog over a dimmed screen,
a window with a title bar. A `root` screen is also one the
[unreachable-screen](../unreachable-screen/) rule never reports, since
nothing has to link to it. A presentation outside the list cannot be drawn.
This is a correctness rule: it is always an error.

## How to fix

Pick the presentation that matches how the screen appears:

- `root`: a starting point of the app, such as its home screen.
- `push`: pushed onto a navigation stack.
- `tab`: one of the app's tabs.
- `sheet`: slides up over the current screen.
- `dialog`: a small modal over the current screen.
- `window`: its own window, on desktop.
- `route`: a page at its own URL, on the web.

## Example

The screen uses another framework's word for a sheet:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  activity.editor:
    title: Edit activity
    area: activity
    presentation: modal
```

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  activity.editor:
    title: Edit activity
    area: activity
    presentation: sheet
```
