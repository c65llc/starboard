# Plan 8: The Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `web/desktop`, Starboard's Tauri v2 app for macOS, Windows and Linux. It runs the whole web app with full editing in every engine. It opens a project by path, remembers recent projects, and reloads when the files change on disk. Its unsigned bundles ship with every release.

**Architecture:** This ports Gantry's desktop app (c65llc/gantry `web/desktop`, branch `feat/desktop` at `3c100fb`, gantry#7), without Gantry's ledger features: no capture intake, no tray badge, no `git`. Read that code and gantry#7's fix commits before each task; they record the traps.
- The window runs `web/app` built with its own entry (`desktop.tsx`). That entry installs a fifth Host, `tauri`, and does not register the service worker.
- A few Rust commands do file I/O confined to the root the user opened (list, read, stat, atomic write), plus watching, recents and the native dialog. Nothing else.
- Core runs in the webview's Worker, exactly as in the browser.

**Tech Stack:**
- Rust: Tauri 2 (`tauri =2.12.7`, `tauri-build =2.7.6`, `tauri-plugin-dialog =2.8.4`, `notify =8.2.2`, `serde =1.0.229`, `serde_json =1.0.154`, `dirs =7.0.0`), the versions Gantry pinned.
- npm: `@tauri-apps/cli 2.12.6` and `@tauri-apps/api 2.12.5`.
- The existing `web/` workspace, Vite, Vitest, Playwright and `cargo test`.

**Spec:** [`docs/specs/2026-11-28-vscode-and-desktop-clients-design.md`](../specs/2026-11-28-vscode-and-desktop-clients-design.md): Design → *The desktop app*; *Rulings from the builder check* 1–4, 6 and 8.

## Global Constraints

- **Headers:** every new `.ts`, `.tsx`, `.rs`, `.sh` and `.toml` file carries the AGPL SPDX header and `Copyright 2026 C65 LLC`.
- **Public repo:** nothing committed names a private project, a local path or a username.
- **npm:** dependencies are pinned exactly and are at least 3 days old (`minimumReleaseAge`).
- **Rust:** crates are pinned exactly (`=x.y.z`) with `Cargo.lock` committed, and each version is at least 3 days old. The crates allowed are those under Tech Stack and what they pull in. No Tauri plugin beyond `tauri-plugin-dialog`. No `shell` or `fs` plugin.
- **Package:**
  - `@c65llc/starboard-desktop`, private, `AGPL-3.0-only`, version `0.0.0-dev` (the release stamps the tag's version into `package.json`, `tauri.conf.json` and `Cargo.toml`).
  - Bundle identifier `com.c65llc.starboard`, product name `Starboard`.
  - Icons are generated from `web/app/public/icons/icon-512.png` with `tauri icon`.
- **The Rust boundary:**
  - Every command takes a `root_id` that indexes a root the user opened (the dialog, a recent entry, or the command-line argument), and a project-relative slash path. The page never sends an absolute path.
  - `confine` refuses `..`, absolute paths, backslashes, Windows drive and `\\?\` prefixes, and any symlink or junction inside the root that resolves outside it.
  - Writes are atomic: a temp file in the same directory, then a rename.
  - Deletions outside `<content>/generated/` are refused, whatever the page asks. `<content>` comes from `starboard.yaml` as Rust reads it.
  - No process is spawned.
- **CSP (`tauri.conf.json`):**
  - `default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'`; `worker-src 'self'`;
  - `img-src 'self' data: blob:`; `style-src 'self'`; `font-src 'self'`;
  - `connect-src 'self' ipc: http://ipc.localhost`;
  - `object-src 'none'`; `base-uri 'none'`; `form-action 'none'`;
  - `freezePrototype: true`.
- **The browser build is unchanged:** desktop-only behaviour lives in `desktop.tsx` and is gated on `host.kind === "tauri"`.
- **Gate for every task:**
  - `make ci web-test`;
  - from Task 1 on, `make desktop-test` (`cargo test` in `web/desktop/src-tauri` plus the tauri host's Vitest);
  - the web app's Playwright suite with `CI=1`.
  - Put `$HOME/.cargo/bin` on PATH.
- **Commits:** author `Don Albrecht <107735+dalbrecht@users.noreply.github.com>`, each ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage files by name. Never force-push.

## Review Focus

1. **A path that escapes the root.** `../x`, `/etc/hosts`, `C:\x`, `\\?\C:\x`, `a\b`, and a symlink (a junction on Windows) inside the root that points out are each refused by every command. Nothing outside the root is read, stat'ed, written or deleted. Owner: Task 1, `confine.rs` tests, with the junction case on Windows CI.
2. **A deletion the page should not make.** A write that deletes `starboard.yaml`, or anything outside `<content>/generated/`, is refused in Rust, even if the page skipped its own check. Owner: Task 1, `fsops.rs` tests.
3. **The project changing on disk while the app is open.** An editor saves `screens.yaml`, and within about a second the app shows the change, through the web app's existing reload path. The app's own writes never trigger it. An edit in progress in the app is kept, as the web app keeps it. Owner: Task 2, `watch.rs` and `host-tauri.test.ts`.
4. **A recent project that has moved or been deleted.** Choosing it says so and removes it from the list. It never opens a different folder. Owner: Task 1, `recents.rs` and `host-tauri.test.ts`.
5. **A write that fails part way** (the disk is full, or permission is denied on one file). The files already renamed stay. The failure is reported, and the web app's "Save again" path still works, because no temp file is left behind as a project file. Owner: Task 1, `fsops.rs` tests.

---

### Task 1: The Tauri shell, the `tauri` host, open by path and recents

**Files:**
- Create:
  - `web/desktop/`:
    - `package.json` and `README.md`;
    - `src-tauri/`: `Cargo.toml`, `Cargo.lock`, `build.rs`, `tauri.conf.json`, `capabilities/default.json` and `icons/`;
    - `src-tauri/src/`: `main.rs`, `confine.rs`, `fsops.rs`, `recents.rs`, `roots.rs`, each with `#[cfg(test)]` tests.
  - `web/app/src/host/tauri.ts` and `web/app/test/host-tauri.test.ts`.
  - `web/app/src/desktop.tsx`, the desktop entry, and `web/app/vite.config.desktop.ts`, which builds `dist-desktop/`, the folder `tauri.conf.json`'s `frontendDist` names.
- Modify:
  - `web/app/src/host/host.ts`: `kind` gains `"tauri"`;
  - the Open view: under `kind === "tauri"` it offers **Open folder…** and the recent list, both from Rust;
  - `web/pnpm-workspace.yaml`;
  - `Makefile`: `desktop-test` and `desktop-build`;
  - `.github/workflows/ci.yml`: a `desktop` job on `ubuntu-22.04`, `macos-latest` and `windows-latest`. It runs `make desktop-test` and `cargo build --locked`, installs the Linux WebKitGTK packages Gantry's job installs, and is added to the CI Gate's `needs` and the `changes` filter.

**Interfaces:**
- **Rust commands:**
  - `open_dialog() -> Option<Opened>`, with `Opened { root_id: u32, name: String }`;
  - `open_recent(path: String) -> Result<Opened>`, which requires the path to be in the recents list, and removes it there if it is missing;
  - `open_arg() -> Option<Opened>`, the project passed on the command line, if any;
  - `recents() -> Vec<Recent { path, name, opened_at }>`, the 10 most recent, de-duplicated;
  - `list(root_id) -> Vec<String>`, skipping `.git` and deferring `node_modules` as web/app's readonly host does;
  - `read_text(root_id, path) -> Option<String>`;
  - `stat(root_id, path) -> Option<Stamp { mtime, size }>`;
  - `write(root_id, changes: HashMap<String, Option<String>>) -> Result<()>`.
- `confine(root: &Path, rel: &str) -> Result<PathBuf>` is the one guard every path goes through.
- **The `tauri` host:**
  - implements `Host` with `kind: "tauri"` and `canWrite: true`;
  - follows the two-step scope through web/app's `selectFiles`, as `fsaccess.ts` does;
  - checks its writes with `checkChanges`, then calls `write`.
- **`desktop.tsx`:**
  - mounts `App`;
  - never calls `startPwa`;
  - installs the tauri host on Open;
  - opens `open_arg()`'s project at once when there is one.

- [ ] **Step 1: Write the tests.**
  - `confine.rs` (Review Focus 1): every case listed there, plus a plain `screens/a.yaml` accepted. The symlink case is skipped on Windows, which uses a junction instead.
  - `fsops.rs` (Review Focus 2 and 5):
    - an atomic write leaves no temp file;
    - deleting `starboard.yaml` is refused, and deleting `docs/flows/generated/x.md` is allowed;
    - a write into a read-only directory reports the error and leaves no `*.tmp`.
  - `recents.rs` (Review Focus 4): 10 most recent, de-duplicated by canonical path; a moved project is removed and reported.
  - `host-tauri.test.ts`, with a mocked `invoke`: `readAll` scopes like `fsaccess`; `write` refuses what `checkChanges` refuses, before any `invoke`.
- [ ] **Step 2:** Run `make desktop-test`. Expected: FAIL.
- [ ] **Step 3:** Implement. Port Gantry's `confine.rs`, `fsops.rs` and `recents.rs`, with its review fixes:
  - "writes stay in content, symlinks can't…";
  - "an unclear content line … refuses every write";
  - "the content scanner refuses every form core could read differently".
- [ ] **Step 4:** Run the gate and `make desktop-test`. `make desktop-build` must produce an app on this Mac that opens `examples/travel-app` by path and saves an edit. Expected: PASS.
- [ ] **Step 5:** Commit `feat(desktop): the Tauri shell, a native host, and recent projects`.

### Task 2: Reload when the project changes on disk

**Files:**
- Create `web/desktop/src-tauri/src/watch.rs` with tests.
- Modify:
  - `main.rs`: the watcher's lifecycle follows the open root;
  - `web/app/src/host/tauri.ts` and `desktop.tsx`: listen for `files-changed` and run the app's existing external-change check.

**Interfaces:**
- `notify` watches the open root recursively, ignoring `.git` and `node_modules`.
- Events are debounced to 200 ms, then Rust emits `files-changed` with no payload. The page calls the app's existing `checkDisk()`, whose stamps decide whether anything changed.
- The window-focus check stays.
- The app's own writes update its stamps, so they cause no reload (Review Focus 3).
- Opening another project stops the old watcher.

- [ ] **Step 1: Write the tests.**
  - `watch.rs`:
    - one write produces one debounced event;
    - a burst of 20 writes within 100 ms produces one event;
    - `.git/` changes produce none;
    - after the watcher stops, nothing more is emitted.
  - `host-tauri.test.ts` (Review Focus 3):
    - a `files-changed` after an outside edit reloads;
    - one right after the app's own write does not;
    - an unsaved edit in progress is kept, as `state.ts` keeps it.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Gantry's `watch.rs` and its fixes apply: "each watch mode is tested on the OS that uses it", and "the watcher tests forget the setup's own writes FSEvents delivers late".
- [ ] **Step 4:** Run the gate and `make desktop-test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(desktop): reload when the project changes on disk`.

### Task 3: Bundles with every release, and docs

**Files:**
- Create:
  - `scripts/check-desktop-bundles.sh`;
  - `docs/guides/desktop.md`.
- Modify:
  - `.github/workflows/release.yml`;
  - `.goreleaser.yaml` (`release.extra_files`);
  - `docs/releasing.md`;
  - `README.md` (a "Desktop" line);
  - the landing page, `website/src/pages/index.astro` (one line beside the editor's);
  - the spec, whose status line marks the desktop app built.

**Interfaces:**
- **`release.yml`:** a `desktop-bundle` job.
  - Its matrix is `macos-latest` (a universal `.dmg`, `--target universal-apple-darwin`), `windows-latest` (NSIS `.exe`) and `ubuntu-22.04` (`.AppImage`).
  - It has `needs: verify`, `permissions: contents: read` and no persisted credentials.
  - It stamps `${GITHUB_REF_NAME#v}` into the three version fields, runs `tauri build`, then checks its bundle and writes a SHA-256 for it.
  - Each leg uploads an artifact.
  - `release` gains `needs: desktop-bundle`. It downloads every leg and checks each SHA-256 and the exact expected names. It then writes `starboard-desktop.sha256` covering all three.
  - GoReleaser attaches them through `extra_files` in the same publish.
  - Port Gantry's `release.yml` legs and its fixes ("the desktop bundles' globs belong to extra_files", "each desktop bundle is checked against the SHA-256 its leg wrote").
- **Bundle names:** `Starboard_<version>_universal.dmg`, `Starboard_<version>_x64-setup.exe` and `Starboard_<version>_amd64.AppImage`.
- **`check-desktop-bundles.sh <version> <dir> <kind>`** asserts that the expected file for `<kind>` (`dmg`, `exe` or `appimage`) exists, is non-empty, and is the only bundle of that kind there.
- **The guide** covers:
  - where to download each bundle from the release;
  - opening an unsigned app (macOS 15's **System Settings → Privacy & Security → Open Anyway**, Windows SmartScreen's **More info → Run anyway**, `chmod +x` for the AppImage);
  - Open folder and recents;
  - that editing works in place on every OS;
  - reloads.

  Match the voice of `docs/guides/browser.md`.

- [ ] **Step 1: Write the test.** Run `check-desktop-bundles.sh` against an empty directory and against one holding two `.dmg` files. Expected: it fails, naming the problem.
- [ ] **Step 2:** Run it against a local `make desktop-build`'s `.dmg`, renamed as the release names it. Expected: PASS.
- [ ] **Step 3:** Implement the release legs and write the guide.
- [ ] **Step 4:** Run the gate, `make actionlint` and `CI=1 make site`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(desktop): bundles with each release; the desktop guide`.

---

## Done means

- Every Review Focus test exists and passes.
- `make desktop-build` produces a macOS app that:
  - opens `examples/travel-app` by path;
  - lists it under Recent;
  - saves an edit;
  - reloads when `screens.yaml` is edited in another editor.
- CI's `desktop` job is green on all three OSes. Codex is clean on the final commit.
- The next release has the three bundles and `starboard-desktop.sha256` attached.
- Code signing and notarisation need certificates you hold, so they are not part of this plan.
