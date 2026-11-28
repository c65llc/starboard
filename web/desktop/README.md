# @c65llc/starboard-desktop

Starboard's desktop app: a [Tauri v2](https://v2.tauri.app) window around
the web app (`web/app`), for macOS, Windows and Linux. It gives every
platform, Safari's and Firefox's users included, editing in place through
native file access confined to the project folder the user opened.

## How it fits together

- **The page is the web app's own, built for the desktop.**
  `web/app/vite.config.desktop.ts` builds `src/desktop.tsx` into
  `web/app/dist-desktop`, which `tauri.conf.json` names as `frontendDist`
  and Tauri embeds in the app. The page is served from `/` with no CSP meta
  tag: the policy is `tauri.conf.json`'s, which Tauri sends with the page,
  and the window freezes `Object.prototype` (`freezePrototype`). No service
  worker is registered and the update prompt never shows: the app is
  already local.
- **The `tauri` host** (`web/app/src/host/tauri.ts`) reads and writes
  through the Rust commands, and checks every answer. It reads a project
  as the browser's read-write host does, listing only what core's `scope`
  reaches, and checks each write with `checkChanges` before sending it.
  Core runs in the page's worker, as in the browser. On the Open screen,
  **Open folder…** is the native dialog and **Recent** is the list Rust
  keeps; a folder named on the command line opens at once.
- **Rust** (`src-tauri/src/`) does file I/O and nothing else. It runs no
  process.
  - `confine.rs`: the one guard every path goes through. A path is
    project-relative, written with `/`; `..`, absolute paths, backslashes,
    drive and verbatim prefixes, symbolic links and junctions that lead out
    of the root, and anything in a `.git` folder (in any case) are refused.
  - `fsops.rs`: list, read, stat and atomic writes (a hidden temporary
    file beside the target, synced, then renamed). It writes and deletes
    only `.md`, `.yaml` and `.svg` files, the kinds core makes, judged by
    the name as written and by where it resolves. A text is written only
    to `starboard.yaml` (by that name) or under the content root, in no
    hidden folder, as written and as resolved. A write that resolves to
    `starboard.yaml` under any other name is refused, and a
    `starboard.yaml` written must keep the content setting exactly as Rust
    reads it now (a reformat is fine), so the page cannot move the content
    root. Deletions are only of names under `<content>/generated/`, as
    written and as resolved (a link there is removed, never followed). A
    write that fails part way stops there, says which file, and leaves no
    temporary file behind.
  - `roots.rs`: the roots the user opened, by `root_id`, and
    `read_content`, which reads the content root from `starboard.yaml` on
    disk for every write; the page never names it. A project whose
    `starboard.yaml` is a link (or, on Windows, a junction), or not a
    regular file, is refused at open and at every write, with a notice to
    replace the link with the file. The `content:` line is read by a line
    scan, not a YAML parser, that refuses what it cannot follow cheaply
    (unplain top-level keys, quoted top-level values, anchors, aliases,
    tags, block scalars, and quotes or flow collections it sees running
    onto an unindented line), refusing every write in that project with a
    notice to use the CLI. It does not follow every form YAML allows, so a
    hand-crafted `starboard.yaml` can be read differently by core; only the
    project's author can write one, who could set the content root
    directly, and whatever Rust reads, it writes only `.md`, `.yaml` and
    `.svg` files. `internal/config`'s golden test writes
    `testdata/scan-content.json` and proves that each form the scan
    accepts there, `examples/travel-app`'s own included, is read by core as
    the same value.
  - `recents.rs`: the ten most recent projects, by canonical path, in
    `<config dir>/starboard/recents.json`. A recent project that has moved
    or been deleted is said to be gone and is taken off the list; nothing
    else is opened in its place.
  - `watch.rs`: follows the open project on disk (`notify`; `.git`,
    `node_modules`, `target`, `dist`, `build`, `out`, `.venv` and
    `coverage` are never watched, in any mode) and, once changes have been
    quiet for 200 ms, sends `files-changed` with no payload. The watch
    starts on a thread of its own, so opening a large tree never waits for
    it. The page answers by listing again the folders core's scope walks,
    and asking again whether each file scope names outside them is there:
    a file made or deleted there (other than by the app) reads the project
    again (`reload`); otherwise it runs the web app's own check
    (`checkDisk`), whose stamps decide whether anything it read changed.
    The app's own writes reload nothing, and an edit being saved is saved
    first. Opening another project stops the old watch. Window focus gives
    the same answer, so it catches a change in a folder that is not
    watched, a file made or deleted there included.
  - `menu.rs`: Tauri's standard menu (`Menu::default`: Edit has Undo,
    Redo, Cut, Copy, Paste and Select All on macOS and Windows, and no Undo
    or Redo on Linux, where GTK 3 has no such menu items; Window has
    Minimize, Maximize and Close Window on macOS and Windows, and nothing
    on Linux; macOS adds View → Enter Full Screen) with **File → Open Folder…**
    (Cmd/Ctrl+O) and **Open Recent** (the recent list, rebuilt whenever it
    changes) at the top of File. Each sends the page `menu-open`, which
    opens it through the start screen's own actions and these commands.
  - `main.rs`: the commands. A page names a root only by the id that
    `open_dialog` (the native folder dialog), `open_recent` (a path already
    in the recents) or `open_arg` (the folder named on the command line)
    gave it. The window may call the commands and listen for events
    (`core:event:allow-listen`: `files-changed` and `menu-open`), nothing
    else.

## Commands

From the repository root:

- `make desktop-test`: builds the desktop bundle, then runs `cargo test`
  here and the tauri host's Vitest in `web/app`.
- `make desktop-build`: the app and its bundles for this OS (`tauri
  build`; `.app` and `.dmg`, NSIS's `-setup.exe` or the AppImage), not
  signed with a developer certificate.

Every crate is pinned exactly (`=x.y.z`) and locked in the committed
`Cargo.lock`, each version published at least three days before it was
added; the only Tauri plugin is `tauri-plugin-dialog`. The icons are made
from `web/app/public/icons/icon-512.png` with `pnpm tauri icon`, keeping
those `tauri.conf.json` names and `icon.png`.
