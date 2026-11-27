# @c65llc/starboard-app

Starboard's local-first web app (a PWA), served from `/app/`. It opens a
project folder and views and edits its screens and flows with the same
lint, format and render results as the CLI, through `@c65llc/starboard-core`
(the Go core compiled to WebAssembly, in a worker). Nothing leaves the
device: no server, no telemetry, fonts self-hosted.

- **Chromium** (`showDirectoryPicker`): the folder opens read-write and is
  remembered in Recent (handles in IndexedDB). After a reload the browser
  asks again; **Reconnect folder** must be clicked.
- **Safari and Firefox**: the folder opens view-only, from the picker or a
  drop. Edits collect as **Not saved to disk** in the header, which lists
  the files changed and the files to delete; **Download changes** gives one
  changed file alone (named by its base name, its project path shown), or
  else a zip of project-relative paths with `.starboard-deleted.txt` listing the files
  to remove.
- **Offline**: the service worker precaches the app, the core and the
  example after the first load (Mermaid's diagram types other than the
  flowchart are cached on first use).
- **Explore the example project** opens `examples/travel-app`, bundled at
  build time, in memory.

The app chooses by feature detection, never by user agent.

## Layout

- `src/host/` — `Host`, the only way to files: `fsaccess.ts`, `readonly.ts`,
  `memory.ts`; `host.ts` has the interface and the shared read logic
  (`core.scope` says which files a project uses).
- `src/state.ts` — signals for the open project. Every change is `edit` in
  core → `files` → `host.write`, and each write is preceded by a `stat`:
  a file changed on disk is reloaded, never overwritten.
- `src/router.ts` — hash routes `#/`, `#/screens[/<id>]`, `#/flows`,
  `#/flows/<id>/edit|walk`, `#/map`. `src/App.tsx` maps each to a view.
- `src/tokens.css` — the design tokens (light and dark); `src/app.css` uses
  only them.

## Development

From `web/` (corepack picks pnpm from `web/package.json`; run pnpm from
inside the directory, never `pnpm -C`):

```sh
make build wasm                    # from the repository root, once
cd web && pnpm install --frozen-lockfile
cd app
pnpm dev                           # http://localhost:5173/app/
pnpm test                          # unit tests (Vitest); after a build, the size budgets too
pnpm build && pnpm e2e             # Playwright on `vite preview`, under the CSP
pnpm exec playwright install chromium webkit firefox   # first time only
pnpm icons                         # re-render public/icons from docs/brand
```

The production build carries the deployment's Content-Security-Policy as
a meta tag (`vite.config.ts`), so the e2e tests prove the app runs under it.

Size budgets (`test/unit/budget.test.ts`, on `dist/`): the app shell (the
entry's static imports, the core's worker, `wasm_exec.js` and the service
worker registration) at most 250 kB of JS gzipped; `starboard.wasm` at most
8 MB raw and 2 MB brotli. Without a build the test skips and says so; with
`CI` set it fails instead.

Firefox runs the view-only specs (open, readonly-download, offline). On
macOS, Playwright's Firefox crashes its content process once the editor has
changed a file, so `readonly-download` is `fixme` there and runs in CI on
Linux (c65llc/starboard#9).
