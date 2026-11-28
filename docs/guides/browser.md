---
title: Editing in the browser
description: Open a project in Starboard's web app to browse its screens, flows and app map, walk through flows, and edit with the same rules as the CLI.
---

Starboard's web app, at
[starboard.c65llc.com/app](https://starboard.c65llc.com/app/), opens a
project folder from your disk and shows the reference as pages you can click
through: wireframes, flows, the app map and the lint findings. It runs the
same core as the `starboard` command, compiled to WebAssembly, so it lints,
formats and draws exactly as the CLI and CI do.

Nothing leaves your device: there is no account, no server and no
telemetry. Once loaded, the app works offline.

## Open a project

Choose **Open folder…** and pick the folder holding `starboard.yaml`, or
drop the folder on the page. **Explore the example project** opens
`examples/travel-app`, bundled with the app, without touching your disk.

What the app can do depends on the browser:

- **Chrome, Edge and other Chromium browsers** open the folder read-write.
  Edits are saved straight into your files, and the folder is listed under
  **Recent**. After a reload, the browser asks for permission again.
- **Safari and Firefox** open the folder view only. You can browse, lint
  and preview everything, and edit; your changes collect under **Not saved
  to disk**, and **Download changes** gives you the changed files to copy
  into the project.

## What you see

- **Screens:** each screen's wireframe for every form factor, its region
  tree, its fields, and the flows and links that use it.
- **Flows:** each flow with its diagram drawn and its references
  clickable, in two modes: **Edit**, the Markdown beside the diagram, and
  **Walk through**, a storyboard of the steps, each showing its screen with
  the step's region highlighted.
- **App map:** every link between screens. Select a screen to see its links
  in and out. **Find a screen**, in the map's header, lists the screens whose
  ID or title contains what you type (ID matches first); choose one, with
  the arrow keys and Enter or with a click, to select it, move keyboard
  focus to it and scroll it to the middle of the map. Escape clears the box
  and keeps the selection. Find lists at most 20 screens, says how many
  matched in all, and tells you when more are hidden so you can keep typing
  to narrow them. Find lists only the screens the platform and
  proposed filters show. **Focus** (All, 1 step, 2 steps; 1 step at
  first) shows only the centred screen and the screens within that many
  links of it, either way; **Re-centre on** says what moves the centre:
  **Picks** (a click, Space, a link in the panel, a Find result) or
  **Every selection** (the arrow keys too). Under Picks the arrow keys
  select without moving the centre. **All screens**, or Escape, shows the
  whole map; Back returns to the focused view. Both settings are
  remembered in this browser, and the address holds the view
  (`#/map/<screen>?steps=1`), so a shared link opens the same view.
  **Zoom**, in the header: **−**, the zoom as a percentage, **+**, **Fit**
  (the whole map in the box, down to 25%) and **100%**. On the map, `+` or
  `=` zooms in, `-` out, `0` shows 100% and `f` fits; Ctrl or ⌘ with the
  scroll wheel, or a trackpad pinch (in Safari too), zooms around the
  pointer, and dragging the map's background pans it, as the scroll wheel
  and scrollbars do. The arrow keys still move between screens. A new
  view opens at 100% with the centre in the middle, or fitted if the
  neighbourhood is larger than the box, but never below 50%. A new view
  is the map first shown, a pick that re-centres it, or Back, Forward or
  a pasted address to a focused view. A pick under Focus **All**, a change
  of level or filter, and **All screens** keep the zoom and bring the
  selection into view. The zoom is not remembered. See
  [The app map and flows](../../concepts/map-vs-flows/).
- **Lint:** the count of errors and warnings, always in the header, and
  the findings, each opening the screen or flow it is about. **Fix
  automatically** formats the sources and regenerates the generated pages,
  as `starboard lint --fix` does.

## Editing

The screen editor changes fields and the region tree through forms, with
the wireframe redrawn as you go. The flow editor changes the Markdown,
with the diagram redrawn as you type.

Every edit goes through the core, then the formatter, before it is written,
so what lands on disk is exactly what `starboard fmt` would write, and
lint runs again after each change. The app only writes `starboard.yaml`
and files in the content root. If a file changed on disk since the app read
it, the app reloads it instead of overwriting it.

The app does not run git: commit its changes as you would your own, and CI
checks them like any others.
