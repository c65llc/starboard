# The VS Code extension and the desktop app

*Status: approved by the owner, 2026-11-28 ("looks good, build it"), from the
proposal in the conversation: the scope under Goals, in Gantry's shape. It amends [the Starboard design](2026-11-26-starboard-design.md),
whose goal 12 deferred both clients ("Built for later clients") and whose
non-goals kept them out of v1.*

## Intent

Starboard's reference lives beside the code it describes, but today you see
it in a browser tab or a terminal. Two clients bring it to where the work
happens:

- **A VS Code extension**, so the reference is part of the editor: findings
  as you type, screen references you can hover and follow, and the code that
  implements a screen linked to the screen.
- **A desktop app** (Tauri; macOS, Windows, Linux), so everyone can edit in
  place. The web app writes files only where the File System Access API
  exists (Chrome, Edge). Safari and Firefox users can only view and
  download, and the desktop app ends that.

Gantry, Starboard's sibling, has built both
([c65llc/gantry](https://github.com/c65llc/gantry): `web/vscode`, merged in
#6; `web/desktop`, #7). Its plans say its clients set the pattern for the
family, so Starboard's follow Gantry's shape and its lessons, with
Starboard's own features. Where this spec says "as Gantry does", the
builder reads Gantry's code and its review history and ports the behaviour,
not the ledger features.

## Goals

1. **VS Code:**
   - lint findings as you type, in the Problems panel, each linked to its rule's page;
   - hover, go-to-definition and completion for screen references;
   - a CodeLens over each file a screen says implements it;
   - New screen and New flow commands;
   - the web app's screen, flow and app map views in an editor panel.
2. **Desktop:** the whole web app with full editing in every engine, a
   project opened by path, recent projects, and reloads driven by the files
   changing on disk.
3. **One core.** Both clients answer every question from the WebAssembly
   core (`@c65llc/starboard-core`), as the web app and CI do, so a project
   lints, formats and renders the same everywhere.
4. **Shipped with every release:** the `.vsix` and the desktop bundles are
   attached to each GitHub release with their SHA-256 sums, as the CLI's
   archives are.

## Non-goals

- Publishing to the VS Code Marketplace or Open VSX. The `.vsix` is
  installed from the release.
- Code signing and notarisation of the desktop bundles, and auto-update.
  The docs say how to open an unsigned app on each OS (macOS 15's
  **Open Anyway**, Windows SmartScreen's **Run anyway**).
- A language server (`starboard lsp`). The extension is VS Code only.
- Gantry's ledger-specific features: evidence and capture ingest, the
  defect commands, the tray badge. Starboard has no counterpart.
- Any change to the web app's behaviour in the browser, beyond what the
  clients need to host it.

## Anti-goals (failure even if it works)

- **A second implementation of a grammar.** The extension never parses
  `screens.yaml`, a flow or a reference itself. The reference syntax comes
  from core (`model().refPattern`, `idPattern`), and every finding from
  `lint`.
- **A write that core did not produce.** Every write is the files a core
  call (`edit`, `format`, `fix`, `generate`) returned, computed from the
  client's own read of the project. A panel or page never hands the
  extension or Rust file contents to write.
- **A write outside the project, or a deletion outside
  `<content>/generated/`.** The web app's Host rule, enforced again at each
  client's boundary: in the extension's write path, and in Rust for the
  desktop app.
- **Overwriting unsaved work.** In VS Code, nothing writes to disk behind a
  dirty buffer. Every write is a `WorkspaceEdit`, so it lands in the buffer
  and is undoable.
- **Stale findings.** A lint result for an older text is never published
  over a newer one.

## Approaches considered

1. **Follow Gantry's clients (chosen).** The extension runs core in the
   extension host over a Node `worker_threads` transport, reads through
   `vscode.workspace.fs` with unsaved buffers overlaid, and shows the web
   app's views in a webview over a `postMessage` host. The desktop app is a
   Tauri v2 shell around the web app's own bundle, with a fourth Host,
   `tauri`, backed by a few Rust commands that do confined file I/O and
   watching, and nothing else. It is proven in the family, its review
   history has already found the traps, and it reuses `web/core` and
   `web/app` as the original architecture intended.
2. **A language server (`starboard lsp`) first, and a thin extension over
   it.** It would serve every LSP editor, but it adds a Go server process
   and protocol for one editor's worth of users today. The original spec
   lists it as later, and the extension's providers can move behind an LSP
   then without changing what users see.
3. **An Electron desktop app.** It ships Chromium, so the File System Access
   API would just work, but it costs ~100 MB per bundle, and its Node side
   is a wider attack surface than Tauri's narrow Rust commands. Tauri is
   what the original spec named.

## Design

### Shared rules

- Both clients join the `web/` pnpm workspace as `web/vscode` and
  `web/desktop`, and reuse `web/core` and `web/app`. `web/core`'s
  `worker_threads` transport, now a test helper, becomes part of the
  package for the extension.
- **Toolchain:** Node 24 and the workspace's pnpm, `minimumReleaseAge`
  3 days. Every new npm dependency is pinned exactly, and its version was
  published at least 3 days ago. Rust crates are pinned exactly (`=x.y.z`)
  with `Cargo.lock` committed, under the same 3-day rule.
- Every new source file carries the AGPL SPDX header and
  `Copyright 2026 C65 LLC`. The repo is public: nothing committed names a
  private project, a local path or a username.
- **Release:** `release.yml` builds the `.vsix` and the desktop bundles,
  GoReleaser attaches them (`extra_files`), and `checksums.txt` covers them.
  Each bundle is checked against its SHA-256 before it is attached, as
  Gantry's release does.

### The VS Code extension (`web/vscode`)

- **Package:** `starboard-vscode`, publisher `c65llc`, display name
  `Starboard`, `AGPL-3.0-only`, `engines.vscode` `^1.105.0`, built with
  esbuild and packaged with `@vscode/vsce` as
  `starboard-vscode-<version>.vsix`. It activates on
  `workspaceContains:**/starboard.yaml`.
- **Projects:** every `starboard.yaml` in the workspace is a project with
  its own core session. A file belongs to the nearest project above it, and
  a file outside every project gets nothing. Multi-root workspaces work.
- **Reading:** a `WorkspaceHost` lists and reads through
  `vscode.workspace.fs`, follows core's two-step `scope` (read
  `starboard.yaml`, list the folder, read what scope names), and overlays
  each open editor's unsaved text.
- **Diagnostics:** lint runs 300 ms after the last keystroke, with one core
  call per project at a time. A result for an older text is never
  published. Each diagnostic's `code` is `{value: rule, target: docs}`.
  Severity maps error to Error, warning to Warning and info to
  Information. A finding with a line covers that line; one without a line
  sits on the file's first line.
- **References:** in any file of scheme `file`, whatever its language (a
  reference in a Swift or Kotlin comment works without that language's
  extension), core's `refPattern` finds `@screen.id` and
  `@screen.id#region` references.
  - Hover shows the screen's title, area, purpose and wireframe.
  - Go-to-definition opens `screens.yaml` at the screen's line (`Screen.line`).
  - Completion after `@` offers the project's screen IDs.
  - An unknown ID gets no hover and no definition. Lint reports it.
- **CodeLens:** at the top of each file a screen lists under `files` (exact
  paths from the project root), one lens per screen:
  `Starboard: <screen id>`. It opens that screen's view in the panel.
- **Commands:**
  - **Starboard: New screen** and **New flow** ask for the ID and title and
    validate them against core's patterns. They run `addScreen` or
    `addFlow` through `core.edit`, apply the result as a `WorkspaceEdit`,
    save it and open it.
  - **Starboard: Open app map**, **Open screen…** and **Open flow…** open
    the panel.
  - **Starboard: Format project** and **Fix automatically** apply
    `format` and `fix` the same way.
- **The panel:** a webview that runs `web/app`'s screen, flow and app map
  views against a `vscode` host that talks to the extension over
  `postMessage`. The extension owns every read, write and core call
  (ruling 5 below), and applies every write as a `WorkspaceEdit`. The
  webview's CSP allows only the extension's own resources.
- **Tests:** unit tests in Vitest. Integration tests run under
  `@vscode/test-electron` with Mocha, through `xvfb-run` on Linux CI, as
  `make vscode-test`.

### The desktop app (`web/desktop`)

- **Package:** `@c65llc/starboard-desktop`, private, `AGPL-3.0-only`;
  Tauri 2; bundle identifier `com.c65llc.starboard`, product name
  `Starboard`. Bundles, unsigned: a universal macOS `.dmg`, a Windows x64
  NSIS installer (`.exe`; NSIS, not `.msi`, which rejects some pre-release
  versions), and a Linux x64 `.AppImage` built on Ubuntu 22.04 for an older
  glibc floor. No ARM builds for Windows or Linux.
- **The window** runs `web/app`'s production bundle with a fourth Host,
  `tauri`. In the desktop app the service worker is not registered (the app
  is already local), and the update prompt never shows.
- **Rust does only:**
  - file I/O confined to the root the user opened through the native
    dialog or a recent entry: list, read, stat, and an atomic write
    (temp file, then rename);
  - watching that root, so the app's existing "Reloaded" notice is driven
    by the watcher rather than by window focus;
  - remembering the recent projects;
  - the window and the native menu.

  No shell, no `fs` or `shell` plugin, and no process spawned. Plugins
  are limited to `tauri-plugin-dialog`.
- **Confinement:** every command takes a project-relative slash path and
  refuses anything that escapes the canonicalised root: `..`, an absolute
  path, a Windows drive or `\\?\` prefix, or a symlink or junction inside
  the root that points out. Deletions outside `<content>/generated/` are
  refused in Rust, whatever the page asks.
- **CSP:** `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`,
  `worker-src 'self'`, `img-src 'self' data: blob:`, `style-src 'self'`,
  `connect-src` only for Tauri's IPC. Core runs in the webview's Worker,
  as in the browser.
- **Open:** **Open folder…** (the native dialog), the recent list on the
  start screen and in the menu, and a project passed on the command line.
- **Tests:** `cargo test` for confinement, atomic writes and the watcher.
  Vitest for the `tauri` host against a fake IPC. The web app's own e2e
  suite still covers the views. `make desktop-test` runs both.

## Testing focus

The inputs most likely to bite a user that no single feature test owns:

1. **An unsaved buffer** (VS Code): findings follow the editor's text, and
   closing the buffer without saving returns them to the disk's.
2. **Two projects in one workspace, or a project in a subfolder** (VS
   Code): each gets its own session, a file belongs to the nearest project,
   and a file outside every project gets nothing.
3. **A write while the target file is open and dirty** (VS Code): New
   screen, Format and panel edits land in the buffer, never on the disk
   beneath it.
4. **A path that escapes the root** (desktop): `../x`, `/etc/hosts`,
   `C:\x`, `\\?\…`, and a symlink or junction inside the root pointing out
   are refused by every Rust command, on the OS that has them.
5. **The project changing on disk while it is open** (desktop): an editor
   saves a file, the watcher notices, and the app reloads as the web app
   does on focus. An edit in progress in the app is kept, as the web app
   keeps it.

## Delivery

Two plans, each executed task by task with a review per task, each landing
as its own PR (or stack):

- **Plan 7:** the VS Code extension, including its release packaging and docs
  (`docs/guides/vscode.md`).
- **Plan 8:** the desktop app, including its bundles in the release and docs
  (`docs/guides/desktop.md`).

The site's landing page and docs mention both once they ship.

## Rulings from the builder check

A fresh reader planned from this document and asked nine questions; each is
settled here (the author's calls, following Gantry where it has answered).

1. **Release structure.** As Gantry's `release.yml`:
   - `verify` gates everything.
   - A `vscode-package` job and a `desktop-bundle` matrix (macOS, Windows,
     Ubuntu 22.04) each build with a read-only token. Each hands its files
     and their SHA-256 to the `release` job as artifacts.
   - `release` checks every SHA-256 and that exactly the expected files,
     named for the tag, arrived. GoReleaser then attaches them through
     `release.extra_files`, in the same publish (a published release is
     immutable).
   - Plan 7 adds the `.vsix` leg; Plan 8 adds the desktop matrix. 7 lands
     first.
2. **Version.** `package.json`, `tauri.conf.json` and `Cargo.toml` carry a
   development version. The release jobs stamp the tag's version (without
   the `v`) at build time, as Gantry's `make vscode-package VERSION=…`
   does. A pre-release tag builds both clients with its pre-release
   version.
3. **Choosing a host.** `Host.kind` gains `"tauri"` and `"vscode"`. Each
   client builds `web/app` with its own entry, which installs its host and
   its start screen, so the browser build is unchanged. In the desktop
   build, Recent lists paths that Rust remembers, not the browser's stored
   directory handles.
4. **Watcher and focus.** The watcher adds to the focus check; it does not
   replace it.
   - Changes are debounced (about 200 ms), and the app's existing stamp
     check decides whether anything changed.
   - The app's own atomic writes update its stamps, so they never trigger
     "Reloaded". Gantry's watcher forgets the setup's own writes the same
     way.
5. **The panel's host.** As Gantry's final panel (`web/vscode/src/panel.ts`,
   `web/app/src/host/vscode-messages.ts`):
   - The webview runs no WebAssembly. Its core is a proxy whose calls the
     extension answers with its own core, passing core its own read of the
     project, never the page's files.
   - The webview's `vscode` host implements `Host` over typed, validated
     `postMessage`, so the views are unchanged.
   - The extension accepts a write only if it is exactly a result core
     returned to that panel (`edit` or `fix`), confined to the project and
     not behind a buffer changed since the panel read it.
   - The panel hides the Source tab, because VS Code itself is where text
     is edited, so the panel has no raw-text write.
6. **Targets:** as in the desktop package above.
7. **The Node transport** becomes a documented subpath export,
   `@c65llc/starboard-core/node`, beside the browser entry.
8. **Docs:** each plan adds its guide to the site's navigation, and a line
   on the landing page.
9. The proposal is the Goals section; the status line now says so.

## Left to the builder

- How the web app's views are bundled for the webview: a second Vite build,
  as Gantry's `vite.config.embed.ts` is, or another way.
- The exact wording of commands, notices and docs, following the existing
  docs' voice.
