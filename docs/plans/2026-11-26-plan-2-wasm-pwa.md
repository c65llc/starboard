# Starboard Plan 2 — WebAssembly core and the PWA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile Starboard's Go core to WebAssembly and ship a local-first PWA that views and edits a project folder, with the same lint, format and render results as the CLI.

**Architecture:**
- A new public Go package `core` puts a JSON-in/JSON-out API over Plan 1's `internal/` packages, and adds editing operations.
- `cmd/starboard-wasm` exposes that API to JavaScript.
- `web/core` (`@c65llc/starboard-core`) runs the WebAssembly module in a Web Worker behind a typed async API.
- `web/app` is a Preact + Vite PWA. It talks to files only through a `Host` interface, so Tauri and VS Code can supply their own host later.

**Tech Stack:**
- Go 1.27.4, built with `GOOS=js GOARCH=wasm` (standard Go, not TinyGo)
- TypeScript 7, Preact 11 with `@preact/signals`, Vite 8, `vite-plugin-pwa` 2
- CodeMirror 6, Mermaid 12 (lazy-loaded), elkjs (app-map layout), fflate (zip downloads), idb-keyval (folder handle persistence)
- Vitest 5, Playwright 1.65 with `@axe-core/playwright`

**Spec:** `docs/specs/2026-11-26-starboard-design.md`, sections Architecture, PWA viewer and editor (including the map-vs-flow distinction), Formatter and Linter. The mockup is at https://claude.ai/artifact/PkVifhj85LsvwgKb8jdxMr: five screens covering Open a project, Screen editor, Flow editor, Flow walkthrough and App map. Its structure and copy are the visual reference, and its colours become the PWA's tokens.

**Depends on:** Plan 1 merged, with `v0.1.0` tagged.

**Delivery:** Two PRs:

- **PR 1:** Tasks 1–3, the Go `core` API and the WebAssembly bundle
- **PR 2:** Tasks 4–9, the PWA

## Global Constraints

- Everything in Plan 1's Global Constraints still applies to Go code. In particular, `core` and everything it imports must not import `os`, and the archtest is extended to `core/`.
- **Dependency age:** every npm dependency is pinned to an **exact** version, the newest that was published at least 3 days before the task runs. Check with `npm view <pkg> time --json`. Record the check in the PR description. `pnpm` is the package manager, with a committed `pnpm-lock.yaml`, and Node 24 (`.nvmrc`).
- **pnpm per directory:** corepack pins pnpm per directory, from the `packageManager` field of the nearest `package.json` (`web/package.json`), so pnpm always runs from inside the directory (`cd web && pnpm …`, `cd web/app && pnpm …`), never as `pnpm -C <dir> …`.
- **License:** every `.ts`/`.tsx` file carries `// SPDX-License-Identifier: AGPL-3.0-only` and the copyright line, and `scripts/check-spdx.sh` is extended to cover them.
- **Privacy:** no network requests at runtime except loading the app's own assets. No analytics, no telemetry and no fonts from third-party CDNs; fonts are self-hosted. CSP-compatible: no inline scripts, and WebAssembly is instantiated with `WebAssembly.instantiateStreaming`. This needs `'wasm-unsafe-eval'`, which Plan 4's headers grant for `/app`.
- **Accessibility:** WCAG 2.2 AA. Every view passes `@axe-core/playwright` with zero violations, works by keyboard alone, and has visible focus.
- **Browser support:**
  - Editing in place on Chromium needs `showDirectoryPicker`.
  - Read-only viewing is supported on Safari 18+ and Firefox 130+.
  - The app chooses by **feature detection** (`'showDirectoryPicker' in window`), never by user-agent.
- **Size budget:**
  - `starboard.wasm`: at most 8 MB raw and 2 MB with brotli (amended 2026-11-26: Go 1.27's wasm output is 6.9 MB; brotli is the transfer size that matters)
  - the app shell without Mermaid: at most 250 kB gzip of JS

  CI fails if either budget is exceeded.

## Review Focus

1. **Permission lost after a reload.** A remembered folder handle whose permission is `prompt` shows a "Reconnect folder" button, which needs a user gesture to work. It never fails silently. Covered by `host-fsaccess.test.ts` `reconnect`.
2. **A file changes on disk while it's open** (an agent or editor wrote it). On window focus and before every save, the app compares the modified time and size. If they differ, it reloads instead of overwriting and shows "Reloaded: changed on disk". Covered by e2e `external-change.spec.ts`.
3. **Unparseable project files.** A `screens.yaml` with a syntax error still opens. The lint panel shows `yaml-syntax` at its line, the other views show an error state, and the Source tab lets the user fix it. Covered by e2e `broken-yaml.spec.ts`.
4. **Large projects.** 300 screens and 60 flows stay responsive: lint runs in the worker, the UI never blocks for more than 100 ms, and the screen list is virtualised. Covered by `perf.spec.ts`, which uses a generated fixture and asserts the main thread's long tasks stay under 100 ms during load.
5. **Read-only browser edits.** Edits on Safari or Firefox accumulate in a pending set. "Download changes" produces exactly the changed files, formatted, as one file or as a zip with project-relative paths. Covered by e2e `readonly-download.spec.ts`, run on WebKit and Firefox.

---

## File Structure

```
core/core.go                 # public JSON API (Task 1)
core/edit.go                 # edit operations on yaml.Node (Task 2)
core/walkthrough.go          # flow → walkthrough model (Task 1)
cmd/starboard-wasm/main.go   # js/wasm bridge (Task 3)
web/
  package.json, pnpm-workspace.yaml, tsconfig.base.json, .nvmrc
  core/                      # @c65llc/starboard-core
    src/index.ts, src/worker.ts, src/types.ts
    test/*.test.ts
  app/
    index.html, vite.config.ts
    src/main.tsx, src/state.ts, src/tokens.css
    src/host/{host.ts,fsaccess.ts,readonly.ts,memory.ts}
    src/views/{Open,Screens,Flows,FlowEdit,FlowWalk,AppMap,LintPanel}.tsx
    src/components/{Wireframe,RegionTree,Inspector,RefChip,Toolbar}.tsx
    test/unit/*.test.ts
    e2e/*.spec.ts, e2e/fixtures/
Makefile                     # + wasm, web-test, web-e2e, web-build
.github/workflows/ci.yml     # + web job
```

---

### Task 1: Public `core` API and walkthrough model

**Files:**
- Create: `core/core.go`, `core/walkthrough.go`
- Test: `core/core_test.go`, `core/walkthrough_test.go`

**Interfaces:**
- Consumes: Plan 1's `project.Load`, `lint.Run`, `format.Project`, `generate.All`, `render.Wireframe`, `flows.Step`.
- Produces. All of these are pure, take `Files` (a `map[string]string` of project-relative path to content) and return JSON-serialisable structs:
  - `type Files map[string]string`
  - `func Lint(f Files, strict bool) LintResult`, where `LintResult{ Diagnostics []diag.Diagnostic \`json:"diagnostics"\`; Errors, Warnings int }`
  - `func Format(f Files) map[string]string`: only the changed files
  - `func Generate(f Files) map[string]string`
  - `func Fix(f Files) FixResult`, where `FixResult{ Write map[string]string; Remove []string }` mirrors Plan 1's `lint.Changes`, including removal of obsolete generated files
  - `func Render(f Files, screenID, formFactor string) (string, error)`: the SVG
  - `func Model(f Files) (ModelResult, error)`. `ModelResult` holds the screens (ID, title, area, status by platform, presentation, layouts as region trees with lines, edges), flows (ID, title, status, steps) and form factors per screen. It is everything the UI lists.
  - `func Walkthrough(f Files, flowID, formFactor string) (Walk, error)`. `Walk{ Steps []WalkStep }`, and each `WalkStep{ Number int; Text string; Screen, Region, Presentation, Next string; Branches []string; SVG string }`. `SVG` is the screen's wireframe with `Region` highlighted. `Next` is the next step's screen, or `""`.
  - `func RenderHighlighted(s *registry.Screen, ff string, ffSize config.FormFactor, region string) []byte`, added to `internal/render`. It draws the named region with a 2 px `#0B6B4E` outline and a numbered badge, and is otherwise identical to `Wireframe`.

The wire format, meaning field names, is part of the public API. Set it with JSON tags in lowerCamelCase.

- [ ] **Step 1:** Write failing tests:
  - `TestLintMatchesCLI`: for each Plan 1 fixture project, `core.Lint` gives byte-identical JSON to `starboard lint --json`, built from the same files.
  - `TestFormatOnlyChanged`.
  - `TestModelTimeline`.
  - `TestWalkthroughSteps`: a fixture flow with 3 steps gives 3 `WalkStep`s, with `Steps[0].Region == "add-activity"`, `Steps[2].Next == ""`, and an SVG containing `stroke="#0B6B4E"`.
  - `TestWalkthroughStepWithoutRef`: gives `Screen == ""` and `SVG == ""`.
  - `TestRenderHighlightedGolden`.
- [ ] **Step 2:** Run `go test ./core/ ./internal/render/`. Expected: FAIL.
- [ ] **Step 3:** Implement. `Files` becomes an `fstest.MapFS` for `project.Load`.
- [ ] **Step 4:** Run `make ci`. Expected: PASS with coverage ≥95%.
- [ ] **Step 5:** Commit: `feat(core): public JSON API and flow walkthrough model`.

### Task 2: Edit operations

**Files:**
- Create: `core/edit.go`
- Test: `core/edit_test.go`, `core/testdata/edit/*.yaml`

**Interfaces:**
- Produces:
  - `type EditOp struct{ Op string; Screen string; Path string; Key string; Value any; Index int; Flow string }`. `Path` is a region path in `registry.Walk`'s form (`layout[2].children[0]`), or `""` for the screen itself.
  - `func Edit(f Files, ops []EditOp) (map[string]string, []diag.Diagnostic, error)`. It applies the ops in order and returns the changed files, **formatted**, plus the lint diagnostics of the result.
- **Ops:**
  - `set`: sets `Key` to `Value` on a screen or region. `Value: null` removes the key.
  - `addScreen`: `Value` holds `{id, title, area, presentation}`.
  - `removeScreen`.
  - `insertRegion`: `Value` is a region map, `Index` is the position within `Path`'s children, and an empty `Path` means top-level layout.
  - `removeRegion`.
  - `moveRegion`: moves to `Index` within the same parent.
  - `setFlowMeta`: sets `Key` in a flow's front matter.
  - `writeFlowBody`: `Value` is the full Markdown body, and the front matter is kept.
- **Comments survive:** an op touches only its target nodes, so comments on other nodes stay. A removed node's own comments go with it.
- Unknown ops, a bad path, or a missing screen return an `error` and change no file.

- [ ] **Step 1:** Write failing tests:
  - a table test per op, comparing against golden YAML
  - `TestEditPreservesUnrelatedComments`
  - `TestEditAtomicOnError`: the second op fails, so the result has no changes from the first
  - `TestEditThenLintSameAsCLI`
  - `FuzzEditSetLabel`: random unicode labels round-trip through `set` then `Model`
- [ ] **Step 2:** Run `go test ./core/`. Expected: FAIL.
- [ ] **Step 3:** Implement on `yaml.Node`, then run `format.Screens` and `format.Flow` on the result.
- [ ] **Step 4:** Run the tests, plus `-fuzz=FuzzEditSetLabel -fuzztime=60s`. Expected: PASS with coverage ≥95%.
- [ ] **Step 5:** Commit: `feat(core): comment-preserving edit operations`.

### Task 3: WebAssembly bridge and the TypeScript core package (PR 1 ends here)

**Files:**
- Create:
  - `cmd/starboard-wasm/main.go` (`//go:build js && wasm`)
  - `web/package.json`, `web/pnpm-workspace.yaml`, `web/tsconfig.base.json`, `web/.nvmrc`
  - `web/core/src/{index.ts,worker.ts,types.ts}`
  - `web/core/test/core.test.ts`
- Modify: `Makefile` (`wasm`, `web-test`), `.github/workflows/ci.yml` (job `web` on ubuntu), `scripts/check-spdx.sh`

**Interfaces:**
- **Go side:** `main` registers `globalThis.__starboard = { lint, format, generate, render, model, walkthrough, edit }`. Each function takes a single JSON string and returns a JSON string `{ "ok": true, "value": … }` or `{ "ok": false, "error": "…" }`. It never panics across the boundary: each call recovers and returns an error. Then `select {}` keeps it alive.
- **`make wasm`:** builds `web/core/dist/starboard.wasm` with `-trimpath -ldflags="-s -w"` and copies `$(go env GOROOT)/lib/wasm/wasm_exec.js`, which must come from the same toolchain.
- **TypeScript side:**
  - `export interface StarboardCore { lint(files: Files, strict?: boolean): Promise<LintResult>; format(files: Files): Promise<Record<string,string>>; generate(files: Files): Promise<Record<string,string>>; render(files: Files, screen: string, formFactor: string): Promise<string>; model(files: Files): Promise<Model>; walkthrough(files: Files, flow: string, formFactor: string): Promise<Walk>; edit(files: Files, ops: EditOp[]): Promise<EditResult>; }`
  - `export function createCore(opts: { wasmUrl: URL; workerUrl?: URL }): StarboardCore`. It spawns a module Worker that loads `wasm_exec.js` and the module once. Requests carry an incrementing id. The worker is restarted after a crash and the in-flight calls are rejected.
  - Types in `types.ts` mirror the Go JSON tags exactly.

- [ ] **Step 1:** Write failing tests:
  - `core.test.ts`, run in Node through Vitest, with a Node worker shim using `wasm_exec.js` under Node.
  - `lint matches golden`: the CLI's JSON for the valid fixture.
  - `round trip edit`.
  - `error surfaces as rejected promise`.
  - `size budget`: the `.wasm` is at most 8 MB (8 * 1024 * 1024 bytes) raw, and brotli at most 2 MB using `zlib.brotliCompressSync`.
- [ ] **Step 2:** Run `make wasm`, then `cd web && pnpm test`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add a CI job `web` that runs `make wasm`, then `cd web && pnpm install --frozen-lockfile`, `cd web && pnpm lint` (ESLint plus `tsc --noEmit`) and `cd web && pnpm test`.
- [ ] **Step 4:** Run `make ci` and `cd web && pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(wasm): WebAssembly build and @c65llc/starboard-core`, then open PR 1.

### Task 4: PWA shell, tokens and hosts

**Files:**
- Create:
  - `web/app/{index.html,vite.config.ts}`
  - `web/app/src/{main.tsx,state.ts,tokens.css}`
  - `web/app/src/host/{host.ts,fsaccess.ts,readonly.ts,memory.ts}`
  - `web/app/src/views/Open.tsx`
- Test: `web/app/test/unit/{host-fsaccess,host-readonly,state}.test.ts`, `web/app/e2e/open.spec.ts`

**Interfaces:**
- `export interface Host { kind: 'fsaccess'|'readonly'|'memory'; name: string; canWrite: boolean; readAll(): Promise<Files>; stat(path: string): Promise<{mtime: number; size: number} | null>; write(changes: Record<string,string|null>): Promise<void>; }`. A `null` value deletes the file, and hosts refuse deletion outside `<content>/generated/`
  - `readAll` reads only `starboard.yaml`, the content root, and the files that vocabularies and screen files reference.
- `fsaccess.ts`:
  - `openFolder(): Promise<Host>` via `showDirectoryPicker({mode:'readwrite'})`
  - `restoreRecent(): Promise<RecentEntry[]>`, using idb-keyval to store handles
  - `reconnect(entry): Promise<Host>`, which calls `requestPermission` and must run on a click
  - Writes are atomic per file: write to `.<name>.starboard-tmp`, then `move()` where supported, else overwrite.
- `readonly.ts`:
  - `fromDirectoryInput(files: FileList)` and `fromDrop(items: DataTransferItemList)`
  - `canWrite: false`, so `write` collects changes into `pending`
  - `downloadPending(): Blob`: a single file, or a zip via fflate
- `memory.ts`: an in-memory Host, used by tests and by "Explore the example project", which loads `examples/travel-app` bundled at build time.
- **`state.ts`:** signals for `host`, `files`, `model`, `lint`, `dirty`, and the selection. Every change runs `edit` through the core, then sets `files`, then calls `host.write`. Each write is preceded by a `stat` comparison (Review Focus 2).
- **`tokens.css`:** colours, type and spacing from the mockup:
  - ground `#F6F6F3`, surface `#FFFFFF`, ink `#16181D`, secondary `#3D4148`, muted `#5B5F66`, border `#E2E2DC`
  - flow accent `#0B6B4E`, navigation highlight `#2F5D8A`, error `#A23A22`/`#FBE7E3`, warn `#8A5A06`/`#FCF0D9`
  - Inter and JetBrains Mono, self-hosted woff2
  - a dark theme of equal contrast under `prefers-color-scheme`
- **`Open.tsx`:** implements the mockup's "Open a project" screen. Recent projects come from idb-keyval. The browser-capability copy follows feature detection.

- [ ] **Step 1:** Write failing tests:
  - unit tests with fake `FileSystemDirectoryHandle` objects: `reconnect` asks for permission and handles `denied`; `readonly` accumulates pending changes; `downloadPending` gives a zip with project-relative paths; the state write path calls `stat` before `write`
  - e2e `open.spec.ts`: on Chromium, the "Explore the example project" path loads the memory host and shows 0 errors; on WebKit, "Open folder…" is replaced by "Open folder (view only)"
- [ ] **Step 2:** Run `cd web/app && pnpm test` and `cd web/app && pnpm e2e`. Expected: FAIL.
- [ ] **Step 3:** Implement. The Vite config uses `vite-plugin-pwa` with `registerType: 'prompt'` (an "Update available" toast), precaching the app plus `starboard.wasm`, with `base: '/app/'`.
- [ ] **Step 4:** Run the tests. Expected: PASS, with axe reporting 0 violations on Open.
- [ ] **Step 5:** Commit: `feat(app): PWA shell, design tokens and file hosts`.

### Task 5: Screen editor

**Files:**
- Create: `web/app/src/views/Screens.tsx`, `web/app/src/components/{Wireframe,RegionTree,Inspector,Toolbar}.tsx`, `web/app/src/views/LintPanel.tsx`
- Test: `web/app/e2e/screens.spec.ts`, `web/app/e2e/broken-yaml.spec.ts`, `web/app/e2e/perf.spec.ts`

**Interfaces:**
- Implements the mockup's Screen editor:
  - a virtualised screen list grouped by area, with filtering by text or `status:proposed`
  - a form-factor tab per form factor of the screen, plus "Override layout" (an `edit set layouts.<ff>` that copies the default layout)
  - the wireframe from `core.render`, shown with `<img src="data:image/svg+xml,…">` so the SVG can never run script, even though labels are user content
  - the region tree, with keyboard support: arrows move, Enter selects, Alt+↑/↓ moves the region
  - an inspector whose fields map to `set` ops; `kind` and `presentation` are selects from the vocabularies in `core.model`, and `to` is a combobox of screen IDs
  - "Implemented in", "Used in flows" and "Navigates to"
  - a lint panel that lists diagnostics, where clicking one selects its screen or region
  - "Fix automatically", which applies `format` and `generate`
- **Source tab:** a CodeMirror YAML view of `screens.yaml`, editable when the model can't parse (Review Focus 3).

- [ ] **Step 1:** Write failing e2e tests:
  - `edit label`: changing Label on `add-activity` changes the memory host's `screens.yaml` and nothing else, and the formatted output matches `core.format`
  - `move region by keyboard`
  - `lint click selects`
  - `broken-yaml.spec.ts`
  - `perf.spec.ts`
  - axe on the view
- [ ] **Step 2:** Run `cd web/app && pnpm e2e screens broken-yaml perf`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(app): screen editor with live wireframes and lint panel`.

### Task 6: Flow editor (Edit mode)

**Files:**
- Create: `web/app/src/views/{Flows,FlowEdit}.tsx`, `web/app/src/components/RefChip.tsx`
- Test: `web/app/e2e/flow-edit.spec.ts`

**Interfaces:**
- **Left pane:** CodeMirror Markdown editor with:
  - `@` autocomplete of screen IDs, and of `#region` after a screen
  - diagnostics from `core.lint` restricted to this file, as CodeMirror lint markers
  - a ⌘/Ctrl-S save that sends `writeFlowBody` and `setFlowMeta`, and autosaves after 1.5 s idle
- **Right pane:**
  - the Mermaid diagram, lazy-loaded with `securityLevel: 'strict'`, where nodes whose label is an `@` reference become links to the screen
  - reference chips that show a wireframe preview on hover and focus
- The `Edit | Walk through` toggle routes between `#/flows/<id>/edit` and `#/flows/<id>/walk`.

- [ ] **Step 1:** Write failing e2e tests:
  - `autocomplete inserts ref`
  - `unresolved ref underlined`
  - `diagram node navigates`
  - `save writes formatted file`
  - `external-change.spec.ts`: the memory host's file is changed underneath the app, then focus is triggered; the app reloads and shows the notice, and the next save doesn't clobber the change
  - axe on the view
- [ ] **Step 2:** Run `cd web/app && pnpm e2e flow-edit external-change`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(app): flow editor with references, diagram and live lint`.

### Task 7: Flow walkthrough (Walk through mode)

**Files:**
- Create: `web/app/src/views/FlowWalk.tsx`
- Test: `web/app/e2e/flow-walk.spec.ts`

**Interfaces:**
- Implements the mockup's walkthrough from `core.walkthrough`:
  - a storyboard strip of step buttons, with `aria-current="step"` on the current one
  - the current step's highlighted wireframe
  - step text, screen link, region and "Leads to"
  - "Other paths from this step" from `Branches`
  - Previous and Next buttons, plus ←/→ keys while the strip has focus
- A step without a reference shows "This step names no screen. Add `@screen#region` to show it", with the `step-without-ref` warning.
- A platform/form-factor select re-renders the walkthrough.

- [ ] **Step 1:** Write failing e2e tests:
  - `steps render`: 5 steps from the example's add-activity flow
  - `next moves highlight`
  - `keyboard arrows`
  - `step without ref message`
  - axe on the view
- [ ] **Step 2:** Run `cd web/app && pnpm e2e flow-walk`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(app): flow walkthrough storyboard`.

### Task 8: App map (navigation only)

**Files:**
- Create: `web/app/src/views/AppMap.tsx`
- Test: `web/app/e2e/app-map.spec.ts`, `web/app/test/unit/map-layout.test.ts`

**Interfaces:**
- `layoutMap(model: Model): Promise<MapLayout>` uses elkjs `layered` with `elk.direction: RIGHT`, orthogonal edge routing, and one partition per area in config order.
- The map is rendered as SVG. Nodes are focusable links.
- Selecting a node highlights its links in and out in `#2F5D8A`; the others stay grey `#A3A39B`. Tabs are drawn as two-way edges. Edge labels are the source region name.
- Filters: platform, show proposed, and only links of selected.
- **There is no step order and no action wording.** A caption repeats the mockup's map-vs-flow sentence. "Flows that pass through here" links to the walkthroughs.

- [ ] **Step 1:** Write failing tests:
  - unit `deterministic layout`: the same model gives the same coordinates
  - e2e `select highlights only its edges`
  - e2e `proposed toggle hides dashed nodes`
  - e2e `keyboard traversal`
  - axe on the view
- [ ] **Step 2:** Run `cd web/app && pnpm test map-layout` and `cd web/app && pnpm e2e app-map`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(app): navigation-only app map`.

### Task 9: Read-only browsers, offline and budgets (PR 2 ends here)

**Files:**
- Modify: `web/app/src/host/readonly.ts`, `vite.config.ts`, `.github/workflows/ci.yml`
- Test: `web/app/e2e/{readonly-download,offline}.spec.ts`, `web/app/test/unit/budget.test.ts`

- [ ] **Step 1:** Write failing tests:
  - `readonly-download.spec.ts` (Review Focus 5), on WebKit and Firefox
  - `offline.spec.ts`: after the first load, `context.setOffline(true)` and a reload still show the app and lint the memory project
  - `budget.test.ts`: reads the `vite build` manifest and asserts the size budgets from Global Constraints
- [ ] **Step 2:** Run `cd web/app && pnpm build`, then `cd web/app && pnpm e2e readonly-download offline` and `cd web/app && pnpm test budget`. Expected: FAIL.
- [ ] **Step 3:** Implement. Extend the CI `web` job to run `cd web/app && pnpm build`, the budget test, and Playwright on Chromium, WebKit and Firefox.
- [ ] **Step 4:** Run `make ci`, `cd web && pnpm test` and `cd web/app && pnpm e2e`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(app): read-only browsers, offline support and size budgets`, then open PR 2. The deployment to `starboard.c65llc.com/app` is Plan 4.
