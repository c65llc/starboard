# Starboard Plan 6 — App map: find, focus and zoom — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the PWA's app map, find a screen by name, show only its 1- or 2-step neighbourhood, and zoom and pan the drawing, without losing keyboard and screen-reader access or the 100 ms budget.

**Architecture:** Find and the neighbourhood are pure functions over the existing `MapGraph` (`src/map/find.ts`, a `focus` field on `MapFilters` handled in `buildMap`), so a focused map is just another filtered map laid out in the worker. The map route carries the centre and level; `AppMap` reads them from the route and keeps the *selection* (highlight, panel) apart from the *centre* (what the neighbourhood is built on). Zoom scales the existing canvas with a CSS transform inside a sized box in the existing scroller; its maths is pure (`src/map/zoom.ts`).

**Tech Stack:** Preact + `@preact/signals`, TypeScript, Vite, Vitest (`web/app/test/unit/`), Playwright (`web/app/e2e/`, Chromium, WebKit, Firefox), axe. No new dependency.

**Spec:** `docs/specs/2026-11-28-app-map-find-focus-zoom-design.md`.

## Global Constraints

- No new runtime or dev dependency.
- Every e2e spec asserts axe 0 and CSP 0 (`expectNoAxeViolations`, `cspViolations` from `e2e/helpers.ts`), and imports `test`/`expect` from `e2e/test.ts`.
- No main-thread task of 100 ms or more on the 300-screen fixture (`perf.spec.ts` style: driven from inside the page, long tasks observed, at the runner's speed).
- The map keeps: one Tab stop (roving tabindex), arrow keys move to the spatial neighbour (`nav.ts`), Enter or a modified click follows the link, `aria-current` on the selection, `MapTable` for assistive tech.
- Focus levels: `0` (All), `1`, `2`. Default level **1**. Re-centre setting: `"picks"` (default) or `"every"`. Both remembered in `localStorage` with try/catch (a refusing store must not break the map).
- Address: `#/map`, `#/map/<screen-id>`, `#/map/<screen-id>?steps=0|1|2`. The app always writes `steps` when it writes a screen. A missing or bad `steps` reads as the saved level; opening a link never changes the saved level.
- Zoom steps (%): 25, 33, 50, 67, 80, 100, 125, 150, 200. Range 25–200. New-view floor 50. Keys: `+`/`=` in, `-` out, `0` 100%, `f` Fit; Space re-centres. Zoom transitions ≤ 150 ms, none under `prefers-reduced-motion: reduce`. Zoom is not remembered.
- Find: case-insensitive; ID-prefix matches, then other ID matches, then title matches, each in map node order; at most 20 options; searches the screens the current platform/proposed filters show, ignoring the focus.
- `make web-test`, `make web-e2e` and `make ci` pass before each PR; each PR closes nothing until its own task list is done (`Part of #7`; the last PR `Closes #7`).
- Pull requests: one per Delivery item — PR 1 = Tasks 1–3, PR 2 = Tasks 4–7, PR 3 = Tasks 8–10.

## Review Focus

1. **A screen ID with characters that need encoding** (spaces, `#`, `?`, `/`) in `#/map/<id>?steps=1` must round-trip through `hrefFor`/`parseRoute` → Task 1, `it("round-trips an ID with ? / # and a space")`.
2. **The centred screen is deleted by an edit, or hidden by a filter, while focused** → the map shows all screens and the address drops the screen (replace, not push) → Task 6, e2e `"a centred screen that disappears falls back to all screens"`.
3. **localStorage throws** (private window, blocked storage) → the level and setting still work for the page's life → Task 5, `it("keeps the choice for the page when storage refuses")`.
4. **Zooming with the selected screen off-screen, then pressing an arrow key** → focus moves and the newly focused screen is scrolled into view at the current zoom → Task 9, e2e `"at 50% an arrow key scrolls the next screen into view"`.
5. **Find typed into while a layout is still running** (a large map) → options still list and choosing one waits for the screen to be drawn, then focuses it (the existing `focus` request) → Task 3, e2e `"choosing a Find result before the map is drawn focuses it once drawn"`.

---

## PR 1 — Find

### Task 1: The map route carries a screen and a level

**Files:**
- Modify: `web/app/src/router.ts` (the `Route` union, `parseRoute`, `hrefFor`, header comment)
- Test: `web/app/test/unit/router.test.ts`

**Interfaces:**
- Produces: `type FocusLevel = 0 | 1 | 2`; the map route becomes `{ name: "map"; screen?: string; steps?: FocusLevel }`. `parseRoute` reads `#/map/<id>` and an optional `?steps=` query on the map route only; `steps` absent or not `0`/`1`/`2` → `steps` omitted. `hrefFor({name:"map", screen, steps})` writes `#/map/<encoded id>?steps=<n>` when `screen` is set (always writing `steps` when given), `#/map` otherwise.

- [ ] **Step 1: Write the failing tests** in `router.test.ts`:
  - `parseRoute` cases: `"#/map"` → `{name:"map"}`; `"#/map/trip.timeline"` → `{name:"map", screen:"trip.timeline"}`; `"#/map/trip.timeline?steps=2"` → `{..., steps:2}`; `"?steps=0"` → `steps:0`; `"?steps=3"`, `"?steps=x"`, `"?steps="` → no `steps`; `"#/map/a/b"` → `notFound`; a query on any other route (`"#/screens?steps=1"`) → `notFound`.
  - `hrefFor` cases: `{name:"map", screen:"trip.timeline", steps:1}` → `"#/map/trip.timeline?steps=1"`; `{name:"map"}` → `"#/map"`.
  - `it("round-trips an ID with ? / # and a space")`: for IDs `"a b"`, `"a?b"`, `"a/b"`, `"a#b"`: `parseRoute(hrefFor(r))` deep-equals `r` (Review Focus 1).
- [ ] **Step 2:** `cd web/app && pnpm vitest run test/unit/router.test.ts` → FAIL on the new map cases.
- [ ] **Step 3:** Implement: split a trailing `?…` off the hash before the path split; accept it only when `head === "map"`.
- [ ] **Step 4:** Rerun → PASS.
- [ ] **Step 5:** Commit `feat(app): the map route carries a screen and a focus level` (body `Part of #7`).

### Task 2: Find's matching

**Files:**
- Create: `web/app/src/map/find.ts`
- Test: `web/app/test/unit/map-find.test.ts`

**Interfaces:**
- Consumes: `MapNode` (`src/map/graph.ts`).
- Produces: `findScreens(nodes: MapNode[], query: string, limit = 20): MapNode[]`. Empty or whitespace query → `[]`.

- [ ] **Step 1: Write the failing tests:** given nodes in order `[home.dashboard "Home", trip.list "Trips", trip.timeline "Timeline", activity.editor "Edit trip activity"]`:
  - `findScreens(nodes, "trip")` → ids `["trip.list", "trip.timeline", "activity.editor"]` (ID prefix, then title match).
  - `findScreens(nodes, "TIME")` → `["trip.timeline"]` (case-insensitive; ID-contains before title).
  - `findScreens(nodes, "  ")` → `[]`.
  - 30 nodes all matching → length 20, in node order.
- [ ] **Step 2:** `pnpm vitest run test/unit/map-find.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `findScreens`.
- [ ] **Step 4:** Rerun → PASS.
- [ ] **Step 5:** Commit `feat(app): match screens for the map's Find` (`Part of #7`).

### Task 3: The Find combobox on the map

**Files:**
- Create: `web/app/src/components/MapFind.tsx`
- Modify: `web/app/src/views/AppMap.tsx` (header, help text), `web/app/src/views/map.css`
- Modify: `docs/guides/browser.md` (the app map section: Find)
- Test: `web/app/e2e/map-find.spec.ts`

**Interfaces:**
- Consumes: `findScreens` (Task 2); `MapView`'s existing `go(id)` (selects and requests focus).
- Produces: `MapFind({ nodes, choose }: { nodes: MapNode[]; choose(id: string): void })`, a WAI-ARIA combobox (input `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; a `role="listbox"` of `role="option"`), labelled "Find a screen". Arrow Up/Down move the active option, Enter chooses, Escape clears and closes (and does not reach the map's Escape). Each option shows the title and the ID.

- [ ] **Step 1: Write the failing e2e tests** in `map-find.spec.ts` (open the example, go to `#/map`):
  - `"Find selects and focuses a screen by part of its title"`: type `"timel"`, the listbox shows `Timeline trip.timeline`, Enter → the node `trip.timeline` has `aria-current` and keyboard focus; axe 0, CSP 0.
  - `"Escape in Find clears it and keeps the selection"`.
  - `"choosing a Find result before the map is drawn focuses it once drawn"` on the 300-screen fixture from `perf.spec.ts` (`largeProject()`): type and choose a late screen immediately after opening the map; expect it focused (Review Focus 5).
- [ ] **Step 2:** `cd web/app && pnpm build && pnpm exec playwright test e2e/map-find.spec.ts` → FAIL.
- [ ] **Step 3:** Implement `MapFind` and place it in `map__head` before `map__filters`; it lists `findScreens(layout.graph.nodes, query)` (the filtered graph, not a focused one: in PR 1 there is no focus yet). Add "type in Find a screen to jump to it" to the help text.
- [ ] **Step 4:** Rerun the spec, then `make web-test web-e2e` → PASS.
- [ ] **Step 5:** Update `docs/guides/browser.md`; commit `feat(app): find a screen on the app map` (`Part of #7`). Open PR 1.

## PR 2 — Focus

### Task 4: The neighbourhood filter

**Files:**
- Modify: `web/app/src/map/graph.ts` (`MapFilters`, `buildMap`)
- Test: `web/app/test/unit/map-graph.test.ts` (create if absent; else extend the file that tests `buildMap`)

**Interfaces:**
- Produces: `MapFilters` gains `focus?: { id: string; steps: 1 | 2 }`. `buildMap` applies platform and proposed filters first, then, when `focus` is set and its screen survives them, keeps the screens within `steps` links of it, **ignoring direction**, and the edges and links between kept screens. A `focus` whose screen the filters hide is ignored (the full filtered map). `neighbourhood(graph: MapGraph, id: string, steps: 1 | 2): Set<string>` is exported for the status line.

- [ ] **Step 1: Write the failing tests** on a model `a→b→c→d`, `e→b`, `c→a` (cycle), `f` isolated, `g` proposed with `b→g`:
  - focus `{id:"b", steps:1}` → nodes `a, b, c, e, g` (both directions; `g` only with proposed shown).
  - `{id:"b", steps:2}` → adds `d`.
  - `{id:"f", steps:2}` → just `f`.
  - with `showProposed:false`, focus on `g` → the full filtered map (no `g`).
  - edges kept are exactly those with both ends kept.
- [ ] **Step 2:** `pnpm vitest run test/unit/map-graph.test.ts` → FAIL.
- [ ] **Step 3:** Implement with a breadth-first walk over the filtered edges.
- [ ] **Step 4:** Rerun, plus `test/unit/map-layout.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(app): a neighbourhood filter for the app map` (`Part of #7`).

### Task 5: The saved level and re-centre setting

**Files:**
- Create: `web/app/src/map/prefs.ts`
- Test: `web/app/test/unit/map-prefs.test.ts`

**Interfaces:**
- Consumes: `FocusLevel` (Task 1); the `KeyValue` shape used by `src/flows/walk.ts`.
- Produces: `type Recentre = "picks" | "every"`; `savedLevel(store?): FocusLevel` (default `1`), `saveLevel(level, store?)`, `savedRecentre(store?): Recentre` (default `"picks"`), `saveRecentre(mode, store?)`. Keys `starboard.map.focusLevel`, `starboard.map.recentre`. `store` defaults to `localStorage`, guarded like `walk.ts` (a module-level fallback keeps the page's choice when the store throws).

- [ ] **Step 1: Write the failing tests:** defaults with an empty store; save then read; an unknown stored value reads as the default; `it("keeps the choice for the page when storage refuses")` with a store whose `getItem`/`setItem` throw (Review Focus 3).
- [ ] **Step 2:** `pnpm vitest run test/unit/map-prefs.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun → PASS.
- [ ] **Step 5:** Commit `feat(app): remember the map's focus level and re-centre setting` (`Part of #7`).

### Task 6: Selection apart from centre; who re-centres

**Files:**
- Create: `web/app/src/map/centre.ts`
- Modify: `web/app/src/components/MapCanvas.tsx` (the `select` prop gains a reason; Space), `web/app/src/components/MapPanel.tsx` (its links are picks), `web/app/src/views/AppMap.tsx` (state from the route)
- Test: `web/app/test/unit/map-centre.test.ts`, `web/app/test/unit/map-canvas.test.ts`

**Interfaces:**
- Produces:
  - `type SelectBy = "pick" | "move" | "tab"` — `pick`: a plain click, Space, a panel link, a Find result; `move`: arrow keys, Home, End; `tab`: focus arriving by Tab.
  - `recentres(by: SelectBy, mode: Recentre): boolean` — `pick` → true; `move` → `mode === "every"`; `tab` → false.
  - `historyFor(by: SelectBy, mode: Recentre): "push" | "replace" | "none"` — the address holds only the centre, so: a `pick` (always re-centres) → `"push"`; a `move` under `"every"` (re-centres) → `"replace"`; a `move` under `"picks"` and any `tab` (do not re-centre, so the address does not change) → `"none"`. Clearing (Escape, All screens) always pushes `#/map`.
  - `MapCanvas`'s `select(id: string, by: SelectBy)`; Space on a screen calls `select(id, "pick")` and is prevented from scrolling.
  - In `AppMap`: `centre` comes from `route.screen` (when level > 0 and the screen is in the filtered graph); `selected` is local state initialised from the centre; a re-centre writes `{name:"map", screen, steps}` with `navigate` (push) or `replaceRoute` (replace) per `historyFor`. Under `"every"` a re-centre by arrow keeps the current zoom (PR 3 reads this as "not a new view").
- [ ] **Step 1: Write the failing unit tests:** the full `recentres` and `historyFor` truth tables (3 × 2 each); in `map-canvas.test.ts`, Space on a node calls `select(id, "pick")`, an arrow calls `select(next, "move")`, focus by Tab calls `select(id, "tab")`.
- [ ] **Step 2:** `pnpm vitest run test/unit/map-centre.test.ts test/unit/map-canvas.test.ts` → FAIL.
- [ ] **Step 3:** Implement `centre.ts`, the `MapCanvas` reasons (`onFocus` from a key the canvas just handled is `move`; otherwise `tab`), and the `AppMap` route wiring. The existing Escape handler becomes a clear (push to `#/map`).
- [ ] **Step 4:** Rerun → PASS; `pnpm exec playwright test e2e/app-map.spec.ts` still passes with the level at All (update its setup to set level 0 where it asserts the full map on selection).
- [ ] **Step 5:** Commit `feat(app): keep the map's selection apart from its centre` (`Part of #7`).

### Task 7: The Focus controls

**Files:**
- Create: `web/app/src/components/MapFocus.tsx`
- Modify: `web/app/src/views/AppMap.tsx` (filters with `focus`, status line, help text, `MapTable` gets the view's graph), `web/app/src/views/map.css`
- Modify: `docs/guides/browser.md`, `docs/concepts/map-vs-flows.md` (focus, re-centre)
- Test: `web/app/e2e/map-focus.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, 5, 6.
- Produces: `MapFocus({ level, recentre, onLevel, onRecentre, centred, onAll })`: a radio group **Focus** (All · 1 step · 2 steps), a select **Re-centre on** (Picks · Every selection), and an **All screens** link shown when `centred`. Changing the level saves it (`saveLevel`) and `replaceRoute`s the current view with the new `steps`; changing Re-centre saves it. The status line (the existing `map__count`): `"12 of 312 screens: 1 step from trip.timeline"` when focused, `"312 screens · 410 links"` otherwise. With level > 0 and no centre: the note "Select a screen to focus on it" and the full map.

- [ ] **Step 1: Write the failing e2e tests** in `map-focus.spec.ts` (example project; axe 0, CSP 0 in each):
  - `"focus at 1 step shows exactly the neighbourhood"`: click `trip.timeline` → the drawn node set equals its 1-step neighbourhood (from `#/map/trip.timeline?steps=1`).
  - `"clicking a neighbour or Space on it re-centres; Back returns"`.
  - `"under Picks arrow keys select without re-laying out"`: record node boxes, press ArrowRight, boxes unchanged, `aria-current` moved.
  - `"under Every selection an arrow key re-centres and keeps focus"`.
  - `"All screens and Escape show the full map; Back returns to the focused view"`.
  - `"a shared #/map/<id>?steps=2 shows 2 steps and leaves the saved level"`: set level 1, load `?steps=2`, then reload `#/map/<id>` → 1 step.
  - `"a centred screen that disappears falls back to all screens"`: centre a screen, then remove it with `putFile`; the full map shows and the address is `#/map` (Review Focus 2).
- [ ] **Step 2:** `pnpm build && pnpm exec playwright test e2e/map-focus.spec.ts` → FAIL.
- [ ] **Step 3:** Implement `MapFocus` and wire it: `filters` gains `focus: centre && level > 0 ? { id: centre, steps: level } : undefined`; `MapTable` receives the drawn graph; help text adds "Space centres on a screen".
- [ ] **Step 4:** `make web-test web-e2e` → PASS.
- [ ] **Step 5:** Update the docs; commit `feat(app): focus the app map on a screen's neighbourhood` (`Part of #7`). Open PR 2.

## PR 3 — Zoom and pan

### Task 8: Zoom maths

**Files:**
- Create: `web/app/src/map/zoom.ts`
- Test: `web/app/test/unit/map-zoom.test.ts`

**Interfaces:**
- Produces: `ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2] as const`; `MIN_ZOOM = 0.25`, `MAX_ZOOM = 2`, `NEW_VIEW_FLOOR = 0.5`; `stepZoom(z: number, dir: 1 | -1): number` (the next step strictly beyond `z`, clamped); `clampZoom(z: number): number`; `fitZoom(panel: {width,height}, layout: {width,height}, floor = MIN_ZOOM): number` (min of the two ratios, clamped to `[floor, 1]` — Fit never enlarges past 100%); `zoomAround(scroll: {left,top}, point: {x,y}, from: number, to: number): {left,top}` (keeps the content point under the viewport point `point`).

- [ ] **Step 1: Write the failing tests:** `stepZoom(1, 1)` → 1.25; `stepZoom(1.1, -1)` → 1; `stepZoom(2, 1)` → 2; `stepZoom(0.25, -1)` → 0.25; `fitZoom({width:800,height:600},{width:3200,height:600})` → 0.25; with floor 0.5 → 0.5; a layout smaller than the panel → 1; `zoomAround({left:0,top:0},{x:100,y:100},1,2)` → `{left:100,top:100}` and the content point under (100,100) is the same before and after.
- [ ] **Step 2:** `pnpm vitest run test/unit/map-zoom.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun → PASS.
- [ ] **Step 5:** Commit `feat(app): zoom maths for the app map` (`Part of #7`).

### Task 9: Zoom and pan on the canvas

**Files:**
- Create: `web/app/src/components/MapZoom.tsx`
- Modify: `web/app/src/components/MapCanvas.tsx` (sizer and transform, keys, wheel, drag, new-view rule), `web/app/src/views/AppMap.tsx`, `web/app/src/views/map.css`
- Modify: `docs/guides/browser.md` (zoom keys)
- Test: `web/app/e2e/map-zoom.spec.ts`

**Interfaces:**
- Consumes: Task 8; Task 6's `SelectBy` (a new view is a `pick` re-centre or the first show).
- Produces: `MapZoom({ zoom, onZoom, onFit })`: buttons **−**, **+**, **Fit**, **100%** and the percentage as `role="status"` `aria-live="polite"`. `MapCanvas` gains `zoom: number` and `onZoom(z: number, around?: {x,y})`; the canvas is scaled with `transform: scale(z)` (origin top left) inside a box of `width*z × height*z` in `.map__scroll`. Keys on the canvas: `+`/`=`, `-`, `0`, `f`. Ctrl/⌘+wheel zooms continuously around the pointer (`zoomAround`). A pointer drag starting on the background (not a node) pans by scroll. New view (first show, or a `pick` re-centre): 100% and the centre scrolled to the middle, or `fitZoom(..., NEW_VIEW_FLOOR)` when the neighbourhood is larger than the panel; an `every` re-centre by arrow keeps zoom. Transitions ≤ 150 ms; none under `prefers-reduced-motion: reduce`.

- [ ] **Step 1: Write the failing e2e tests** in `map-zoom.spec.ts` (axe 0, CSP 0 each):
  - `"the zoom buttons and keys step the percentage"`: + → 125%, − twice → 80%, `0` → 100%, `f` on a wide map → below 100%.
  - `"Ctrl+wheel zooms around the pointer"`: the node under the pointer stays under it (±2 px).
  - `"dragging the background pans; dragging a screen does not"`.
  - `"at 50% an arrow key scrolls the next screen into view"` (Review Focus 4).
  - `"a pick opens at 100% or fits, never below 50%"`; `"Every selection keeps the zoom on an arrow re-centre"`.
  - `"with reduced motion no transition runs"` (emulate `reducedMotion: "reduce"`; the canvas's computed `transition-duration` is `0s`).
- [ ] **Step 2:** `pnpm build && pnpm exec playwright test e2e/map-zoom.spec.ts` → FAIL.
- [ ] **Step 3:** Implement `MapZoom` and the canvas changes; add the zoom keys to the help text.
- [ ] **Step 4:** `make web-test web-e2e` → PASS (including `map-draw.spec.ts` and `app-map.spec.ts` unchanged at 100%).
- [ ] **Step 5:** Update the docs; commit `feat(app): zoom and pan the app map` (`Part of #7`).

### Task 10: The zoom-and-pan performance test

**Files:**
- Modify: `web/app/e2e/perf.spec.ts`

**Interfaces:**
- Consumes: `largeProject()`, `runAtRunnerSpeed`, `watchMainThread`, `activate` (in `perf.spec.ts`).

- [ ] **Step 1: Write the test** `"zooming, panning and focusing the 300-screen map makes no long task of 100 ms"`: open the map at level All (driven from inside the page as the existing map test is), then while watching: zoom 100% → 25% by steps and back, Fit, scroll the map end to end, set level 1, pick a screen, change to 2 steps, and pick three linked screens in turn. Assert the longest task < 100 ms, with each task's start in the annotation as the existing test does.
- [ ] **Step 2:** `pnpm build && pnpm exec playwright test e2e/perf.spec.ts` → PASS (it guards; if it fails, the edges-to-canvas fallback in the spec is the next step — do not relax the budget).
- [ ] **Step 3:** `make web-test web-e2e` and `make ci` → PASS.
- [ ] **Step 4:** Commit `test(app): no long task while zooming and focusing a large map` with `Closes #7`. Open PR 3.
