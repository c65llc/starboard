---
title: The desktop app
description: Download Starboard's desktop app from a release for macOS, Windows or Linux, open an unsigned app, open a project folder, and edit it in place with changes from other editors picked up as they land.
---

Starboard's desktop app is the web app in a window of its own, with the
disk behind it. It shows the same pages as the
[browser app](../browser/): wireframes, flows, the app map and the lint
findings, from the same core as the `starboard` command. The difference
is the file access: on every OS the app reads and writes your project
folder directly, with no browser permission prompt to answer again after a
reload. Nothing leaves your machine: there is no account, no server and no
telemetry.

## Download

Each [release](https://github.com/c65llc/starboard/releases) carries one
bundle per OS, named for its version, and `starboard-desktop.sha256`, the
checksums of all three:

| OS | File |
|----|------|
| macOS (Apple silicon and Intel) | `Starboard_<version>_universal.dmg` |
| Windows (64-bit) | `Starboard_<version>_x64-setup.exe` |
| Linux (64-bit) | `Starboard_<version>_amd64.AppImage` |

```bash
gh release download v0.2.0 --repo c65llc/starboard --pattern 'Starboard_*' --pattern 'starboard-desktop.sha256'
sha256sum --ignore-missing -c starboard-desktop.sha256   # shasum -a 256 on macOS
```

## Open an unsigned app

The bundles are not signed with a developer certificate or notarised, so
each OS asks before it runs one the first time.

- **macOS:** open the `.dmg` and drag Starboard to Applications, then open
  it. The app is signed ad hoc, not notarised, so macOS does not trust it.
  Since macOS 15 the right-click **Open** route is gone. The first time,
  macOS says **“Starboard” Not Opened**; choose **Done**. Then open
  **System Settings → Privacy & Security**, scroll to **Security**, where
  it says “Starboard” was blocked, and choose **Open Anyway**. Confirm with
  your password or Touch ID, then choose **Open Anyway** once more in the
  dialog that follows. macOS remembers this; later launches open straight
  away.

  If macOS says the app **is damaged and can’t be opened**, which has no
  **Open Anyway** button, or you prefer the terminal, clear the quarantine
  flag once instead:

  ```bash
  xattr -dr com.apple.quarantine /Applications/Starboard.app
  ```

- **Windows:** run the installer. SmartScreen says it protected your PC;
  choose **More info**, then **Run anyway**.
- **Linux:** make the AppImage executable, then run it:

  ```bash
  chmod +x Starboard_0.2.0_amd64.AppImage
  ./Starboard_0.2.0_amd64.AppImage
  ```

  On Ubuntu 24.04 and newer, an AppImage needs `libfuse2`: install it
  (`sudo apt install libfuse2t64`), or run the file with
  `--appimage-extract-and-run`.

## Open a project

Choose **Open folder…** and pick the folder holding `starboard.yaml`.
The folder is listed under **Recent**, newest first, so the next launch
is one click. If a recent project has moved or been deleted, choosing it
says so and removes it from the list; it never opens a different folder.

The menu does the same from anywhere in the app: **File → Open Folder…**
(Cmd+O on macOS, Ctrl+O elsewhere) and **File → Open Recent**, which
lists the same recent projects. The standard **Edit** and **Window** menus
are there too, so copy and paste work as in any app.
**Explore the example project** opens `examples/travel-app`, bundled with
the app, without touching your disk.

The app only reads and writes inside the folder you opened. It never
asks for, or sends, a path outside it.

## Edit

Editing works in place on every OS. Screens change through forms and
flows through their Markdown, each redrawn as you go, and every edit
goes through the core and the formatter before it is written, so what
lands on disk is what `starboard fmt` would write. There is no **Not
saved to disk** list and no **Download changes**: a save is a write to
your files. If a write fails (the disk is full, or one file is read-only),
the app says so and **Save again** retries every change not yet saved.

The app writes only what core makes: `starboard.yaml`, and `.md`, `.yaml`
and `.svg` files in the content root. Anything else in the project is
read, never written.

The app does not run git: commit its changes as you would your own.

## Reloads

Edit `screens.yaml`, or any file in the project, in another editor, and
within about a second the app shows the change. A file made or deleted
shows too: a new flow an agent writes appears, and a deleted one goes,
because the app lists the project's folders again and reads it afresh
when they differ. It reloads through the same path the browser app uses,
so an edit in progress in the app is saved first and the app's own saves
never cause a reload.

The app does not watch `.git`, `node_modules`, `target`, `dist`,
`build`, `out`, `.venv` or `coverage` folders, which can be large and are
never the project's own files. A change under one of them shows the next
time the app's window comes to the front.
