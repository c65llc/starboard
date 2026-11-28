# Plan 7: The VS Code Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `web/vscode`, Starboard's VS Code extension. It provides:
- lint findings as you type;
- hover, go-to-definition and completion for screen references in any file;
- a CodeLens over each file a screen says implements it;
- New screen, New flow, Format and Fix commands;
- a panel showing the web app's screen, flow and app map views.

The extension ships as a `.vsix` with every release.

**Architecture:** This ports Gantry's extension (c65llc/gantry, `web/vscode` at `c4319d7`, merged in gantry#6) to Starboard's core and features. Read that code and the fix commits in gantry#6 before each task; they record the traps.
- The extension host runs `@c65llc/starboard-core` over a Node `worker_threads` transport.
- A `WorkspaceHost` reads through `vscode.workspace.fs`, with unsaved buffers laid over the disk.
- Every grammar comes from core: references from `model().refPattern`, IDs from `idPattern`.
- Every write is a core result, applied as a `WorkspaceEdit` and then saved.
- The panel is `web/app` built with its own entry and a `vscode` host. It runs no WebAssembly: its core calls are answered by the extension's core, from the extension's own read.

**Tech Stack:**
- TypeScript and the VS Code API, `engines.vscode` `^1.105.0`.
- esbuild for the extension; Vite for the panel bundle.
- Vitest for unit tests; `@vscode/test-electron` with Mocha for integration tests.
- `@vscode/vsce` for packaging.
- Everything joins the existing `web/` pnpm workspace.

**Spec:** [`docs/specs/2026-11-28-vscode-and-desktop-clients-design.md`](../specs/2026-11-28-vscode-and-desktop-clients-design.md): Design → *The VS Code extension*; *Rulings from the builder check* 1, 2, 3, 5, 7 and 8.

## Global Constraints

- Every new `.ts`, `.tsx`, `.css`, `.mjs` and `.sh` file starts with `// SPDX-License-Identifier: AGPL-3.0-only` and `// Copyright 2026 C65 LLC`, or the `#` form for shell scripts. `make spdx` checks this.
- The repo is public. Nothing committed names a private project, a local path or a username.
- **Toolchain:** Node 24 (`web/.nvmrc`), the workspace pnpm, run as `corepack pnpm` from `web/`. `minimumReleaseAge` is 3 days.
  - New npm dependencies are pinned exactly, each to a version published at least 3 days ago.
  - New dependencies are limited to `@types/vscode`, `@vscode/test-electron`, `@vscode/vsce`, `esbuild`, `mocha` and `@types/mocha`.
- **Package:** `starboard-vscode`, `"publisher": "c65llc"`, `"displayName": "Starboard"`, `"license": "AGPL-3.0-only"`, `"version": "0.0.0-dev"` (the release stamps the tag's version), `engines.vscode` `^1.105.0`. It activates on `workspaceContains:**/starboard.yaml`.
  - Packaged as `starboard-vscode-<version>.vsix`.
  - Marketplace publishing is not part of this plan.
- **Core only:** the extension never parses `screens.yaml`, a flow or a reference itself. Answers come from `scope`, `model`, `lint`, `edit`, `format`, `fix`, `generate`, `render` and `walkthrough`.
- **Writes:** every write is the files a core call returned, computed from the extension's own read. Each is applied with `vscode.workspace.applyEdit` as a `WorkspaceEdit`, then saved.
  - Paths stay inside the project.
  - Deletions are allowed only under `<content>/generated/` (the web app's `DeletionRefusedError` rule).
  - Nothing writes to disk behind a dirty buffer.
- **Lint:** runs 300 ms after the last change (setting `starboard.lint.debounceMs`, default 300), with one core call per project at a time. A result for older text is never published.
- **Diagnostics:** collection name `starboard`.
  - `code` is `{ value: rule, target: Uri.parse(docs) }`.
  - Severity maps error to Error, warning to Warning and info to Information.
  - A finding with `line` covers that whole line (1-based in core, 0-based in VS Code). One without a line sits on line 0.
- **Gate for every task:** `make ci web-test`, and from Task 1 on `make vscode-test`. Playwright runs with `CI=1` (port 4173 is shared across worktrees).
- **Commits:** author `Don Albrecht <107735+dalbrecht@users.noreply.github.com>`. Each message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage files by name. Never force-push.

## Review Focus

1. **An unsaved buffer.** Findings follow the editor's text, not the disk. Closing the buffer without saving returns them to the disk's state. Owner: Task 1, `diagnostics.test.ts`.
2. **Two projects in one workspace, or a project in a subfolder.** Each `starboard.yaml` gets its own session. A file belongs to the nearest project above it, and a file outside every project gets nothing. Owner: Task 1, `multiroot.test.ts`.
3. **A reference in a language VS Code knows nothing about.** `@auth.sign-in` in a `.swift` comment, with no Swift extension installed, still hovers and goes to its definition. Owner: Task 2, `refs-anylang.test.ts`.
4. **A write while the target file is open and dirty.** New screen, Format or a panel edit lands in the buffer, never on the disk beneath it. A panel edit worked out from text that has changed since is refused. Owner: Task 4, `commands.test.ts`; Task 5, `panel.test.ts`.
5. **A forged write from the panel.** A `write` message whose files are not exactly a result core returned to that panel, or that names a path outside the project or a deletion outside `generated/`, is refused, and nothing is written. Owner: Task 5, `panel-messages.test.ts` (unit) and `panel.test.ts`.

---

### Task 1: The Node transport, the scaffold and lint as you type

**Files:**
- Create:
  - `web/core/src/node.ts`, the `worker_threads` transport, moved from `web/core/test/node-transport.ts` and `node-worker.ts`. The tests import it from there.
  - `web/vscode/`:
    - `package.json`, `tsconfig.json`, `esbuild.mjs`, `.vscodeignore`, `README.md`, `LICENSE` (a copy of the root's);
    - `src/extension.ts`, `src/core.ts`, `src/host.ts`, `src/projects.ts`, `src/diagnostics.ts`;
    - `test/unit/{host,projects}.test.ts`;
    - `test/integration/runTest.ts` and `test/integration/suite/{index,diagnostics,multiroot}.test.ts`;
    - `test/fixtures/` (a copy of `examples/travel-app`, plus a multi-root workspace with two projects, one in a subfolder).
- Modify:
  - `web/core/package.json`: an `exports` entry `"./node"` (source, types, default), with the browser entry unchanged;
  - `web/pnpm-workspace.yaml`;
  - `Makefile`: `vscode-test`, and `web-test` running the extension's Vitest;
  - `.github/workflows/ci.yml`: a `vscode` job (Linux, `xvfb-run -a make vscode-test`) in the CI Gate's `needs` and the `changes` filter for `web/**`;
  - `web/core/README` or its doc comment, saying `./node` is for Node hosts (VS Code, tests).

**Interfaces:**
- `createNodeCore(opts?: { wasmPath?: string; timeoutMs?: number }): StarboardCore` from `@c65llc/starboard-core/node`.
- `class WorkspaceHost`, constructed as `new WorkspaceHost(root: vscode.Uri)`:
  - `readAll(): Promise<{ files: Files; content: string }>` follows core's two-step `scope`, as `web/app/src/host/fsaccess.ts` does. It skips `.git`, and defers `node_modules` as `web/app/src/host/readonly.ts` does, reading it once a configured root reaches it, so the editor lints as the CLI does (ruling R3, made during execution).
  - `overlay(path: string, text: string | null): void` sets or clears an unsaved buffer.
- `class Projects`:
  - finds every `starboard.yaml` with `workspace.findFiles('**/starboard.yaml', '**/node_modules/**')`, and keeps up with creates and deletes;
  - `projectFor(uri: vscode.Uri): Project | undefined` returns the nearest one above the file;
  - `Project` is `{ root: vscode.Uri; host: WorkspaceHost; core: StarboardCore; model(): Promise<Model> }`.
  - The model is cached per project and refreshed when the project re-lints. Each project allows one core call at a time.
- `class Diagnostics` re-lints a project on open, change (debounced), save, close, create, delete and rename. It publishes the `starboard` collection by the Global Constraints' mapping.

- [ ] **Step 1: Write the tests.**
  - `web/core`: its existing tests pass through `@c65llc/starboard-core/node` (import changed only).
  - Unit:
    - `projects.test.ts`: `projectFor` picks the nearest of `/w/starboard.yaml` and `/w/sub/starboard.yaml` for `/w/sub/x/y.kt`, and gives `undefined` for `/elsewhere/z.kt`.
    - `host.test.ts`: an overlay changes what `readAll` returns, and clearing it restores the disk text. `.git/` is never listed. A `node_modules/` the scope does not reach is not listed, and one it reaches is, with lint equal to the CLI's.
  - Integration:
    - `diagnostics.test.ts` (Review Focus 1): open `docs/flows/screens.yaml` and set one screen's `area` to `nowhere` in the buffer. Within 2 s a diagnostic whose `code.value` is the unknown-area rule appears on that line, and `code.target` is its `https://starboard.c65llc.com/rules/…` page. Revert the buffer without saving and it clears.
    - `multiroot.test.ts` (Review Focus 2): both projects get their own findings. A file outside both gets none.
- [ ] **Step 2:** Run `make vscode-test` and `corepack pnpm -F starboard-vscode test`, run from `web/` so Corepack picks the workspace's pinned pnpm. Expected: FAIL (no extension).
- [ ] **Step 3:** Implement, porting Gantry's `core.ts`, `host.ts`, `projects.ts` and `diagnostics.ts`. Its fixes "never publish stale lint; nested projects keep their own" and "one core call per project" apply as written.
- [ ] **Step 4:** Run the gate and `make vscode-test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(vscode): the extension, a Node core and lint as you type`.

### Task 2: References everywhere: hover, go-to-definition and completion

**Files:**
- Create `web/vscode/src/refs.ts`, `test/unit/refs.test.ts` and `test/integration/suite/{refs,refs-anylang}.test.ts`.

**Interfaces:**
- **Registration:** the providers register for `{ scheme: "file" }` and `{ scheme: "untitled" }` with no language filter.
- **Finding references:** `new RegExp(model.refPattern, "g")`, where group 2 is the screen ID and group 3 the region. The range starts at the `@` (after group 1) and ends after the region. Results are cached per document version.
- **Hover** shows a Markdown card with `isTrusted: false` and `supportHtml: false`:
  - the screen's title, ID, area, presentation and purpose;
  - its status by platform, and the flows using it (`Flow.screens`);
  - for `#region`, the region's kind and label if `Model` has it;
  - a final link line, `Open in Starboard`, built as a command URI only in Task 5. Until then it is omitted.
  - An unknown ID gets no hover.
- **Go-to-definition** goes to the project's `screens.yaml` at `Screen.line - 1`. An unknown ID gets none.
- **Completion:** right after `@`, or inside a partial ID that matches the start of `idPattern`, it offers every screen ID with the title as its detail. After `#` it offers that screen's region names. It offers nothing anywhere else.

- [ ] **Step 1: Write the tests.**
  - Unit:
    - trigger detection: `@`, `@auth.si` and `@auth.sign-in#` complete; `email@domain.com` and `a@b` do not (refPattern's group 1 rule).
    - Markdown escaping: a hostile title such as ``[x](command:workbench.action.quit)`` renders as text.
  - Integration:
    - `refs.test.ts`: hover, definition and completion in a flow's Markdown, using the fixture's `@auth.sign-in`.
    - `refs-anylang.test.ts` (Review Focus 3): hover and definition on `@auth.sign-in` in a `.swift` comment.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement, following the shape of Gantry's `refs.ts`.
- [ ] **Step 4:** Run the gate and `make vscode-test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(vscode): hover, go-to-definition and completion for screen references in any file`.

### Task 3: CodeLens over implementation files

**Files:**
- Create `web/vscode/src/lens.ts` and `test/integration/suite/lens.test.ts`.

**Interfaces:**
- A file gets lenses when its project-relative path is listed, exactly, in some screen's `files[platform]`. These are exact paths, not patterns (`docs/reference/screens-yaml.md`).
- One lens per screen, on line 0, titled `Starboard: <screen id>`.
  - Until Task 5, its command goes to the definition, as Task 2's does.
  - Task 5 changes it to open the screen's panel.
- Lenses refresh when the project's model changes.

- [ ] **Step 1: Write the test.** `lens.test.ts`:
  - `src/android/SignInScreen.kt` in the fixture shows one lens titled exactly `Starboard: auth.sign-in`, on line 0.
  - Removing that path from `files` in `screens.yaml` (a buffer edit, then save) removes the lens.
  - A file no screen lists shows none.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the gate and `make vscode-test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(vscode): CodeLens over the files that implement a screen`.

### Task 4: New screen, New flow, Format and Fix

**Files:**
- Create `web/vscode/src/write.ts`, `src/commands.ts` and `test/integration/suite/commands.test.ts`.

**Interfaces:**
- `applyCoreResult(project: Project, changes: Record<string, string | null>, base: Files): Promise<void>` in `write.ts`:
  - checks every path is inside the project, and every deletion is under `<content>/generated/`;
  - refuses, without writing, if any target's current text, buffer or disk, differs from `base`;
  - applies one `WorkspaceEdit` and saves the touched documents.

  This ports Gantry's `write.ts` and its fix "every write is confined to the project's records".
- **Commands** in category `Starboard`:
  - `starboard.newScreen` ("New Screen") asks, in order, for the ID (validated against `idPattern` and not already used), the title, the area (a quick pick of `model.areas`) and the presentation (a quick pick of `model.presentations`). It runs `core.edit([{ op: "addScreen", ... }])` with the field names `web/app/src/components/NewScreen.tsx` sends, then applies and opens `screens.yaml` at the new screen.
  - `starboard.newFlow` ("New Flow") asks for the ID (`flowIdPattern`) and the title, as `NewFlow.tsx` does. It runs `addFlow`, applies, and opens the new flow file.
  - `starboard.format` ("Format Project") runs `core.format(files)`.
  - `starboard.fix` ("Fix Automatically") runs `core.fix(files)`: it writes `write` and deletes `remove`.
  - Each acts on the active editor's project. With several projects and no active one, it asks which.

- [ ] **Step 1: Write the test.** `commands.test.ts`:
  - New screen `auth.reset` / "Reset password" / area `auth` / presentation `screen` produces a `screens.yaml` byte-identical to `starboard` CLI output for the same `addScreen` op. Make the golden with `core.edit` in the test itself, on the disk files.
  - New flow writes the file `NewFlow.tsx`'s test expects for the same input.
  - Review Focus 4: with `screens.yaml` open and dirty, New screen changes the buffer and leaves the disk unchanged until the save. If the buffer changes between the read and the apply, the command refuses with a message, and both buffer and disk are left as they were.
  - Fix on a project with a stale generated page removes it. A forged change that deletes `starboard.yaml` is refused by `applyCoreResult`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the gate and `make vscode-test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(vscode): New screen, New flow, Format and Fix from the editor`.

### Task 5: The panel: the web app's views in a webview

**Files:**
- Create:
  - `web/app/src/host/vscode-messages.ts`: the message types, and guards each side reads through. Port Gantry's, with Starboard's core functions.
  - `web/app/src/host/vscode.ts`, a `Host` (`kind: "vscode"`) over `postMessage`;
  - `web/app/src/core-proxy.ts`, a `StarboardCore` whose calls go to the extension;
  - `web/app/src/embed.tsx`, the panel's entry. It installs the host and the proxy core, opens the project at once (no Open screen, no service worker, no update prompt), hides the Source tab, and routes to the view the extension names.
  - `web/app/vite.config.embed.ts`, building `dist-embed/`, which the extension copies at package time;
  - `web/vscode/src/panel.ts`;
  - `test/unit/panel-messages.test.ts` and `test/integration/suite/panel.test.ts`.
- Modify:
  - `web/app/src/host/host.ts`: `kind` gains `"vscode"`;
  - the Screens view: no Source tab when `host.kind === "vscode"`;
  - `web/app/src/core.ts` (or `getCore`): the embed can supply its core;
  - `refs.ts` and `lens.ts`: their links open the panel.

**Interfaces:**
- **Commands:**
  - `starboard.openMap` ("Open App Map");
  - `starboard.openScreen` ("Open Screen…", a quick pick of screens, or an ID argument);
  - `starboard.openFlow` ("Open Flow…").

  Each opens or reveals a `WebviewPanel` per project and view, titled `Starboard: <screen or flow id>` or `Starboard: App map`. It routes to `#/screens/<id>`, `#/flows/<id>` or `#/map`, or the screen's route at `#/map/<id>`.
- **CSP:**
  - `default-src 'none'`;
  - `script-src`, `style-src` and `font-src` `${cspSource}`;
  - `img-src ${cspSource} data: blob:`.

  There is no `wasm-unsafe-eval` and no worker: the panel runs no WebAssembly. `localResourceRoots` is the extension's `dist-embed/`.
- **Messages:**
  - The page sends `readAll`, `read`, `stat`, `write` and `core`.
  - The extension sends `reply` and `reload`.
  - A `core` call's files are ignored: the extension passes its own read. The one exception is `lint`, which may overlay the page's text for flow files already in the extension's read, so the panel's flow editor lints its unsaved draft. Lint writes nothing. The allowed functions are exactly those web/app calls: `model`, `lint`, `edit`, `fix`, `render`, `walkthrough` and `scope` (rulings R2, R6 and R12, made during execution).
  - A `write` is accepted only if its changes are exactly one result of an `edit` or `fix` the extension returned to that panel since its last `readAll`, as Gantry's `checkWrite` does. It is then applied through `applyCoreResult`.
  - A message whose type is not one of these, or a path that is not a clean project-relative path, is refused.
- **Reload:** the panel posts `reload`, debounced, when its project's files change. The page then runs the app's existing external-change path.

- [ ] **Step 1: Write the tests.**
  - Unit, `panel-messages.test.ts` (Review Focus 5): each guard refuses an unknown type, `../x`, `/abs` and `a\b`.
  - Integration, `panel.test.ts`:
    - **Opening:** Open Screen `auth.sign-in`; the page reports, through a test-only message, that the screen's title rendered, and that no Source tab exists.
    - **Editing:** setting the screen's purpose through the page's state (`applyEdit`, driven by a test-only message, as Gantry's `testApply`) lands in the `screens.yaml` buffer.
    - **Forged write** (Review Focus 5): a `write` with altered text is refused, and the disk and buffer are unchanged.
    - **Stale write** (Review Focus 4): an edit whose base changed in the editor meanwhile is refused, and the page reloads.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Check that the browser build is byte-for-byte unaffected in behaviour: `make web-test` and the web app's Playwright suite (`CI=1`) pass unchanged.
- [ ] **Step 4:** Run the gate and `make vscode-test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(vscode): the screen, flow and app map views in a panel`.

### Task 6: Packaging, the release leg and docs

**Files:**
- Create:
  - `scripts/check-vsix.sh`;
  - `docs/guides/vscode.md`.
- Modify:
  - `Makefile`: `vscode-package VERSION=<semver>`, defaulting to `0.0.0-dev`;
  - `.github/workflows/release.yml`;
  - `.goreleaser.yaml` (`release.extra_files`);
  - `docs/releasing.md`;
  - the site's sidebar in `website/astro.config.mjs`, so the guide is listed;
  - the landing page, `website/src/pages/index.astro`: one line where it lists the ways to use Starboard;
  - `README.md`, with an "Editor" line;
  - `web/vscode/README.md`;
  - the spec, whose status line now marks the VS Code extension built.

**Interfaces:**
- `make vscode-package VERSION=x.y.z`:
  - stamps `version` into a copy of `package.json` (the committed file keeps `0.0.0-dev`);
  - builds `dist/extension.js` and `dist-embed/`;
  - runs `vsce package --no-dependencies`;
  - writes `web/vscode/starboard-vscode-x.y.z.vsix` and `web/vscode/starboard-vscode.sha256`.
- `scripts/check-vsix.sh <vsix> <version>` asserts:
  - the archive holds `extension/dist/extension.js`, `extension/dist-embed/index.html`, `extension/LICENSE` and `extension/package.json`, whose version is `<version>`;
  - it holds no `node_modules/`, no `.map` files, no `src/` and no `test/`.
- **`release.yml`:** a `vscode-package` job, `needs: verify`, with read-only `contents: read` and no persisted credentials.
  - It runs `make vscode-package VERSION=${GITHUB_REF_NAME#v}` and the check, then uploads both files as an artifact.
  - `release` gains `needs: vscode-package`. It downloads the artifact and checks that it holds exactly one `.vsix` named for the tag, and that `sha256sum -c starboard-vscode.sha256` passes.
  - GoReleaser then attaches both through `release.extra_files` in the same publish, as Gantry's does. Port its comments' reasoning: a published release is immutable.

- [ ] **Step 1: Write the test.** Run `scripts/check-vsix.sh` against a deliberately wrong archive (a zip with `node_modules/`). Expected: it fails, naming the problem.
- [ ] **Step 2:** Run `make vscode-package VERSION=9.9.9 && sh scripts/check-vsix.sh web/vscode/starboard-vscode-9.9.9.vsix 9.9.9`. Expected: FAIL before the target exists, PASS after.
- [ ] **Step 3:** Implement. Write the guide:
  - installing from the release's `.vsix` (**Extensions: Install from VSIX…**);
  - each feature, with its command;
  - the settings;
  - that the panel needs no browser.

  Match `docs/guides/browser.md`'s voice.
- [ ] **Step 4:** Run the gate, `make vscode-test`, `make vscode-package VERSION=9.9.9` and the check, `actionlint`, and `make site`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(vscode): ship the extension with each release; the editor guide`.

---

## Done means

- Every Review Focus test exists and passes.
- In the Extension Development Host, `examples/travel-app` shows:
  - diagnostics as you type;
  - hovers and definitions on `@auth.sign-in` in a flow and in `SignInView.swift`;
  - the CodeLens on `SignInScreen.kt`;
  - New screen writing the CLI's bytes;
  - the app map in a panel.
- `make ci web-test vscode-test` passes, and the PR's CI is green, including the `vscode` job. Codex is clean on the final commit.
- The next release has `starboard-vscode-<version>.vsix` attached, with its SHA-256.
