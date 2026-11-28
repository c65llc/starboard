# App map: find, focus and zoom — design

Date: 2026-11-28
Status: approved 2026-11-28
Issue: [#7](https://github.com/c65llc/starboard/issues/7) (re-scoped from "zoom-to-fit and pan")

## Intent

People open the app map to **find a screen and work on it and the screens
around it**: the local flows they are changing. They rarely need the shape
of the whole app at once (owner, 2026-11-28). Today a large project's map
is drawn at full size in a scrolling box: finding a screen means scrolling
and reading, and its neighbours may be a screen-width away.

This design adds three things to the map, in this order of importance:

1. **Find**: jump to a screen by name or ID.
2. **Focus**: show only a screen and the screens within one or two links
   of it, laid out on their own, so a local flow fits the panel.
3. **Zoom**: shrink or enlarge the drawing, fit it to the panel, and pan
   it, for the neighbourhoods and full maps that are still too big.

The map stays what the original spec rules it to be: navigation structure
only, every `to:` edge, no order and no action wording.

## Goals

- From the map, reach any screen by typing part of its ID or title.
- Walk a local flow by following links, with only the relevant screens on
  the map, each with a readable name.
- See a neighbourhood or a whole map that is larger than the panel without
  losing keyboard and screen-reader access.
- Stay within the app's performance budget: no main-thread task of 100 ms
  or more, for a 300-screen project, while finding, focusing, zooming or
  panning.

## Non-goals

- An overview or minimap of the whole app (the owner does not use the map
  that way).
- Splitting the map per area (still left open by the original spec).
- Editing on the map. Selecting and opening screens stay as they are.
- Touch gestures beyond what the browser gives for free (pinch on a
  trackpad arrives as a Ctrl+wheel event and is covered; touch-screen
  pinch is not designed for).

## Anti-goals (failure even if it works)

- A zoomed-out map whose names cannot be read, used as the default view.
- Losing what the map already does well: one Tab stop with arrow-key
  navigation between screens, Enter to open, ⌘/Ctrl-click to open
  elsewhere, `aria-current` on the selection, the accessible table
  (MapTable), axe 0 and CSP 0 in every e2e spec.
- A new runtime dependency.

## Approaches considered

- **A. Find and focus only.** Neighbourhood view plus search; no zoom.
  Cheapest; hub screens with many links might still overflow.
- **B. Zoom and pan the full map, plus find.** What the issue first asked
  for. Keeps one stable layout, but the owner would mostly sit at 100% and
  scroll a huge drawing: today plus a search box.
- **C. A and B together (chosen, owner 2026-11-28).** Focus for everyday
  work; zoom for neighbourhoods and maps that are still wide.

**Rendering (owner question, 2026-11-28): no canvas for the screens.**
Each screen stays an HTML link over an SVG of the edges. A canvas would
lose real links (focus, Enter, ⌘-click, screen readers, axe) and need a
hidden accessible layer re-built by hand. Zoom scales the existing drawing
with a CSS transform, which the browser composites without laying the
nodes out again. **Fallback, with a trigger:** if the zoom-and-pan
performance test below records a long task of 100 ms or more, or the
project's target size grows well past 300 screens, the *edges* move to a
`<canvas>`. They are already `aria-hidden` and are most of the elements,
so nothing is lost; the screens stay links. This is not built now.

## Design

### Find

- A combobox, **Find a screen**, in the map's header beside the filters
  (the WAI-ARIA combobox pattern with a listbox popup).
- It matches the typed text, case-insensitively, against each screen's ID
  and title: prefix matches of the ID first, then other ID matches, then
  title matches; each group in the map's node order. At most 20 options.
  An option shows the title and the ID.
- It searches the screens of the **current filters** (platform, proposed),
  not the focus: a screen outside the focused neighbourhood can be found.
  A screen the filters hide is not listed. *(Builder's call whether to show
  a "hidden by filters" hint.)*
- Choosing an option selects the screen and asks the canvas to focus it
  (the existing `focus` request, which draws it first if needed and moves
  keyboard focus to it). With Focus on, the neighbourhood re-centres on it
  (below). With Focus off, the canvas scrolls it into view, centred.
- Escape in the box clears it and closes the list; the map's existing
  Escape-clears-selection stays on the map and panel.

### Focus

- A control, **Focus**, with three levels: **All**, **1 step**, **2 steps**
  (a radio group or segmented buttons).
- With a level of 1 or 2 and a selected screen, the map shows only that
  screen and every screen reachable from it, or reaching it, in at most
  that many `to:` links, ignoring direction, among the screens the current
  filters show. Edges shown are those whose both ends are shown. The
  focused screen is marked (it is the selection, so `aria-current` and the
  selected style already apply).
- The neighbourhood is a new `MapFilters` field, so it reuses the existing
  path: `buildMap` keeps only the neighbourhood, and `layoutMap` lays it
  out in the worker as it does any filtered map. *(Shape: `focus?: { id:
  string; steps: 1 | 2 }`; builder's call on names.)*
- **What re-centres the neighbourhood is the viewer's choice** (owner,
  2026-11-28), a setting beside the Focus level, **Re-centre on**:
  - **Picks** (the default): a click on a screen, **Space** on the
    focused screen, a link in the panel, or a Find result re-centres the
    neighbourhood on that screen. Arrow keys, Home and End move between
    the screens already shown; the screen they reach is selected
    (highlighted, its links lit, the panel filled) but the layout and the
    zoom stay as they are. Arrow keys keep their spatial meaning
    (`nav.ts`). Space is the keyboard's way to walk a flow.
  - **Every selection:** arrow keys, Home and End re-centre too, as each
    selection does. The layout changes on each move; the screen moved to
    keeps keyboard focus, and the **zoom is kept** (the new-view rule
    under Zoom applies only to picks and to first showing the map).
  - In both, keyboard focus arriving by **Tab** into the map does not
    re-centre: it lands on the selected screen, or on the first screen
    drawn when none is selected, and that screen is selected as today.
    Enter still opens the screen editor and never re-centres.
  - This splits two ideas MapCanvas has kept as one: the **selection**
    (highlighted, in the panel, `aria-current`) and the **centre** (what
    the neighbourhood is built around). Under Picks they differ after
    arrow keys; under Every selection they are always the same screen.
- **Defaults:** the level and the Re-centre setting are remembered per
  browser (localStorage, as the walkthrough remembers its form factor);
  the level starts at **1 step**, Re-centre at **Picks**. With no screen
  centred the map shows all screens whatever the level, and says so
  ("Select a screen to focus on it").
- A link, **All screens**, and **Escape** on the map or panel, both clear
  the selection and the centre, and so show the full map; each pushes a
  history entry, so Back returns to the focused view. The level is kept
  for the next centre.
- **The address carries the view** *(author's calls, after the builder
  check)*:
  - The map route takes an optional centre and level:
    `#/map/<screen-id>?steps=<0|1|2>`, where 0 is All. The app always
    writes `steps` when it writes a centre, so a shared link shows the
    same view in any browser. `#/map` alone is the full map with nothing
    selected.
  - A typed `#/map/<screen-id>` without `steps` uses the browser's saved
    level. A bad `steps` value is read as the saved level; an unknown
    screen ID falls back to the full map, as a vanished screen does.
  - Opening a link with `steps` shows that level and does **not** change
    the saved one; changing the level with the control saves it and
    **replaces** the current history entry.
  - The address holds only the centre. A pick (re-centring) **pushes** a
    history entry, so Back and Forward retrace the walk; a re-centre by
    arrow keys under Every selection **replaces** it, so moving around does
    not flood history; a selection that does not re-centre (arrow keys
    under Picks, Tab) leaves the address alone.
  - `router.ts` gains the optional screen on `{ name: "map" }` and the
    `steps` parameter; the map's state (centre, level) is read from the
    route, with the saved level filling a missing `steps`.
- When the focused screen disappears (an edit removed it, or a filter now
  hides it), the map falls back to all screens, as the selection already
  does.

### Zoom and pan

- **Controls** in the map's header: **−**, the zoom as a percentage (a
  live status, `aria-live="polite"`), **+**, **Fit** and **100%**. Steps:
  25, 33, 50, 67, 80, 100, 125, 150, 200 (%). Range 25%–200%.
- **Keyboard**, while focus is anywhere in the map's canvas: `+`/`=` zoom
  in, `-` zoom out, `0` 100%, `f` Fit. Arrow keys keep moving between
  screens; they never pan. Space is taken by Focus (re-centre).
- **Pointer:** Ctrl/⌘+wheel (and a trackpad pinch, which browsers send as
  Ctrl+wheel) zooms around the pointer, continuously within the range.
  Dragging on the canvas's empty background pans; a drag that starts on a
  screen does nothing new (a click still selects). Plain wheel and the
  scrollbars still scroll, which pans.
- **How:** the canvas keeps its layout size and is scaled with a CSS
  transform (`transform: scale(z)`, origin top left) inside a sizer of
  `width × z` by `height × z`, in the existing scrolling box. Panning is
  that box's scroll position. Zooming around a point sets the scroll so the
  point stays under the pointer. No layout runs on zoom.
- **What a new view shows:** when a pick re-centres the neighbourhood, or
  the map is first shown, the zoom resets to 100% and the focused screen is scrolled
  to the centre; if the whole neighbourhood is larger than the panel, the
  view fits it instead, but never below 50%, so names stay readable. With
  no focus (all screens), the map opens at 100%, scrolled to the selection
  if there is one, as today. Fit on demand may go down to 25%.
- **Focus and zoom together:** keyboard focus moving to a screen that is
  out of view scrolls it into view at the current zoom (`scrollIntoView`
  respects the transform). Selected-screen highlighting, edge highlighting
  and the "only the selected screen's links" filter are unchanged.
- **Reduced motion:** no animated zoom or scroll when
  `prefers-reduced-motion: reduce`; otherwise zoom steps may ease over at
  most 150 ms.
- **Remembered:** the zoom is not remembered across visits. Each new view
  starts as above.

### Accessibility

- Every control is a native button, input or radio, labelled, with visible
  focus, reachable by Tab in reading order: Find, Focus, zoom controls,
  then the map's single Tab stop, then the panel.
- The map's help text (`map-help`) gains the new keys.
- The status line says what is shown: "12 of 312 screens: 1 step from
  trip.timeline" or "312 screens".
- MapTable lists the screens and links of the **current view** (the focus
  applies to it as to the drawing), so assistive tech gets what is drawn.

### Performance

- A new e2e test, in `perf.spec.ts`'s style (driven from inside the page,
  long tasks observed, at the runner's speed): on the 300-screen fixture
  with Focus at All, zoom from 100% to 25% and back by steps, Fit, and pan
  across the map by scroll; then focus a screen, change the level and walk
  three links. No main-thread task may reach 100 ms. This test is the
  trigger for the edges-to-canvas fallback.
- The existing 300-screen layout test keeps passing unchanged.

## Testing

Unit (Vitest), next to the code:

- The neighbourhood: 0, 1 and 2 steps; both directions; a cycle; filters
  applied before the neighbourhood; a focused screen the filters hide.
- Find's matching and order, the 20-option limit, case-insensitivity.
- Zoom maths: steps up and down from any value, clamping, zoom around a
  point keeps it fixed, Fit's scale for a given panel and layout, the 50%
  floor on a new view.
- The router: `#/map`, `#/map/<id>`, `#/map/<id>?steps=0|1|2`, a missing
  or bad `steps`, an unknown ID.
- Centre and selection: which inputs re-centre under each Re-centre
  setting; history push versus replace for each.

End to end (Playwright, Chromium, WebKit and Firefox, axe 0 and CSP 0, as
every spec):

- Find a screen by part of its title; the map selects and focuses it.
- Focus at 1 step shows exactly the neighbourhood; clicking a neighbour,
  or Space on it, re-centres; Back returns to the previous centre; All
  screens and Escape show the full map.
- Under Picks, arrow keys select without re-laying out (the screens'
  positions and the zoom are unchanged); under Every selection, an arrow
  key re-centres and keeps the zoom and keyboard focus.
- A shared `#/map/<id>?steps=2` shows the 2-step view whatever the saved
  level, and leaves the saved level as it was.
- The zoom buttons and keys change the percentage; Ctrl+wheel zooms around
  the pointer; dragging the background pans; arrow keys still move between
  screens at 50%.
- With reduced motion, no transition runs.

## Delivery

Three PRs, each standing alone, in this order:

1. **Find** (with the router's optional screen).
2. **Focus** (the neighbourhood filter, the level and Re-centre controls,
   the split of selection and centre, the address, defaults).
3. **Zoom and pan** (controls, keys, pointer, the new-view rule, the
   performance test).

Each updates `docs/` where the app map is described and the map's help
text.

## Left to the builder

- Exact names of the new filter field, components and CSS classes.
- The combobox's markup details within the WAI-ARIA pattern.
- Whether Find shows a "hidden by filters" hint for a screen the filters
  hide.
- The easing curve for zoom steps (within 150 ms, none under reduced
  motion).
- Icons or text for the zoom buttons, within the app's tokens.
