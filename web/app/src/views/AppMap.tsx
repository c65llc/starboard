// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app map (#/map): navigation structure only. Every to: in the
// registry is an edge between screens, labelled with the region that
// navigates, with no order and no action wording; a flow, one ordered
// path, is Flows' job. Selecting a screen highlights its links in and out.
// The address holds the map's centre (#/map/<id>?steps=n); the selection
// starts there and may move away from it (src/map/centre.ts).
// This module, ELK's API and its worker load only when the map is first
// shown (LazyAppMap); the layout runs in the worker, so the page stays
// responsive however large the project.

import type { Diagnostic, Model } from "@c65llc/starboard-core";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { TargetedKeyboardEvent } from "preact";

import { MapCanvas } from "../components/MapCanvas.tsx";
import type { FocusRequest } from "../components/MapCanvas.tsx";
import { MapFind } from "../components/MapFind.tsx";
import { MapFocus } from "../components/MapFocus.tsx";
import { linksOf, MapPanel } from "../components/MapPanel.tsx";
import { MapTable } from "../components/MapTable.tsx";
import { historyFor } from "../map/centre.ts";
import type { SelectBy } from "../map/centre.ts";
import { buildMap, mapPlatforms } from "../map/graph.ts";
import type { MapFilters } from "../map/graph.ts";
import { layoutFailure, layoutMap } from "../map/layout.ts";
import type { MapLayout } from "../map/layout.ts";
import { selectionStatus } from "../map/nav.ts";
import { saveLevel, savedLevel, savedRecentre, saveRecentre } from "../map/prefs.ts";
import type { Recentre } from "../map/prefs.ts";
import { navigate, replaceRoute } from "../router.ts";
import type { FocusLevel, Route } from "../router.ts";
import { targetOf } from "../screens/logic.ts";
import { app } from "../store.ts";
import "./map.css";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** errorCounts is the number of lint errors on each screen. */
function errorCounts(diagnostics: Diagnostic[], model: Model): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of diagnostics) {
    if (d.severity !== "error") continue;
    const t = targetOf(d, model.screens, model.flows);
    if (t.kind === "screen") out.set(t.screen, (out.get(t.screen) ?? 0) + 1);
  }
  return out;
}

interface Laid {
  layout?: MapLayout;
  /** What the layout was made from: a focus request is handled only against the layout for the model and filters now in effect. */
  model?: Model;
  filters?: MapFilters;
  error?: string;
}

type MapRoute = Route & { name: "map" };

function MapView({ model, route }: { model: Model; route: MapRoute }) {
  const platforms = useMemo(() => mapPlatforms(model), [model]);
  const [platform, setPlatform] = useState("");
  const [showProposed, setShowProposed] = useState(true);
  const [onlySelected, setOnlySelected] = useState(true);
  // State, so the Focus controls can change them; a link's steps wins over the saved level and does not change it.
  const [saved, setSaved] = useState(savedLevel);
  const [mode, setMode] = useState(savedRecentre);
  const level = route.steps ?? saved;
  const [laid, setLaid] = useState<Laid | null>(null);
  const diagnostics = app.lint.value?.diagnostics;
  const errors = useMemo(() => errorCounts(diagnostics ?? [], model), [diagnostics, model]);

  const shown = useMemo<MapFilters>(() => ({ platform: platforms.includes(platform) ? platform : "", showProposed }), [platform, platforms, showProposed]);
  // What Find searches: the model through the platform and proposed filters
  // only, so it works while the first layout runs. Never a focused graph: a
  // screen outside the neighbourhood must still be found.
  const findable = useMemo(() => buildMap(model, shown), [model, shown]);
  // The centre is the address's screen, at any level (a pick at All is still
  // a link that restores it); an unknown or filtered-out one is no centre.
  const centre = route.screen !== undefined && findable.nodes.some((n) => n.id === route.screen) ? route.screen : null;

  // What is drawn: the shown screens, cut to the centre's neighbourhood. It
  // depends on the centre and level only, never on the selection, so an
  // arrow under Picks selects without a new layout.
  const steps = centre !== null && level > 0 ? level : 0;
  const filters = useMemo<MapFilters>(() => (centre === null || steps === 0 ? shown : { ...shown, focus: { id: centre, steps } }), [shown, centre, steps]);
  useEffect(() => {
    let live = true;
    layoutMap(model, filters)
      .then((layout) => live && setLaid({ layout, model, filters }))
      .catch((err: unknown) => live && setLaid({ error: err instanceof Error ? err.message : String(err) }));
    return () => {
      live = false;
    };
  }, [model, filters]);

  // The selection starts at the centre and goes back to it whenever the
  // centre changes (Back, Forward, a pasted address), but not when only the
  // level does. Each change of centre is a new era; a selection made in an
  // earlier era gives way to the centre. Counted in render, as the centre is.
  // One change of centre keeps the selection: the centred screen vanishing
  // (an edit removed it, a filter hides it) while the address still names
  // it. Then the map falls back to all screens, and a screen the arrows
  // moved to stays selected if it is still there.
  const [picked, setPicked] = useState<{ era: number; id: string | null }>({ era: 0, id: centre });
  const era = useRef<{ centre: string | null; n: number; kept: string | null }>({ centre, n: 0, kept: null });
  if (era.current.centre !== centre) {
    const vanished = centre === null && route.screen !== undefined && route.screen === era.current.centre;
    const was = picked.era === era.current.n ? picked.id : era.current.centre;
    era.current = { centre, n: era.current.n + 1, kept: vanished ? was : null };
  }
  const chosen = picked.era === era.current.n ? picked.id : (era.current.kept ?? centre);
  // A vanished or unknown centre leaves the address too, in place: Back should not lead to it.
  useEffect(() => {
    if (route.screen !== undefined && centre === null) replaceRoute({ name: "map" });
  }, [route.screen, centre]);

  // Until a new layout arrives (another filter, an edit) the last one stays.
  const layout = laid?.layout;
  const selected = chosen !== null && layout?.graph.nodes.some((n) => n.id === chosen) ? chosen : null;
  // A screen to focus: MapCanvas draws it first if its batch has not come yet.
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  // The centre this view last wrote to the address, so the effect below can tell its own re-centres from Back and Forward.
  const wrote = useRef<string | null>(null);
  const select = (id: string, by: SelectBy) => {
    setPicked({ era: era.current.n, id });
    // Selecting another screen cancels a focus request still waiting for its
    // layout, so a late layout cannot take focus and the selection back. The
    // request's own focus selects its screen, and keeps it.
    setFocus((f) => (f && f.id !== id ? null : f));
    const how = historyFor(by, mode);
    if (how === "none") return;
    wrote.current = id;
    // Always with steps, so a shared link shows this view in any browser.
    const to: Route = { name: "map", screen: id, steps: level };
    if (how === "push") navigate(to);
    else replaceRoute(to);
  };
  // Clearing pushes, so Back returns to the view that was centred.
  const clear = () => {
    setPicked({ era: era.current.n, id: null });
    setFocus(null);
    navigate({ name: "map" });
  };
  // The control's level is the browser's from now on, and this view's: in place, so Back does not step through levels.
  const changeLevel = (n: FocusLevel) => {
    saveLevel(n);
    setSaved(n);
    if (centre !== null) replaceRoute({ name: "map", screen: centre, steps: n });
  };
  const changeMode = (m: Recentre) => {
    saveRecentre(m);
    setMode(m);
  };
  // A centre from the address (Back, Forward, a pasted link) takes keyboard
  // focus with it while focus is on the map, so the keyboard stays where the
  // view is; focus elsewhere (Find, a filter) is left alone. A re-centre
  // made here asks for nothing: its screen has focus already, or the
  // keyboard has moved on (an arrow pressed before the address changed).
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const own = wrote.current === centre;
    wrote.current = null;
    if (centre === null || own) return;
    const at = document.activeElement;
    if (!(at instanceof HTMLElement) || !at.closest(".map__canvas") || !body.current?.contains(at)) return;
    if (at.getAttribute("data-id") !== centre) setFocus({ id: centre });
  }, [centre]);
  // The panel's links are picks.
  const go = (id: string) => {
    select(id, "pick");
    setFocus({ id });
  };
  // A Find result can be anywhere on a large map, so it is brought to the middle, not just to an edge.
  const found = (id: string) => {
    select(id, "pick");
    setFocus({ id, centre: true });
  };
  // Handled, the request goes: a MapCanvas made again (a filter that empties the map, then fills it) must not take focus again.
  const clearFocus = () => setFocus(null);
  const onKeyDown = (e: TargetedKeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape" && (selected !== null || route.screen !== undefined)) clear();
  };
  const said = selected && layout ? linksOf(layout.graph, selected) : null;
  // When the drawing fails, the table still lists every link.
  const graph = layout?.graph ?? (laid?.error ? findable : undefined);
  // A layout made for an earlier model or filters is still on screen until
  // the next comes; a focus request waits for that one, so a pick's
  // request lands in the new neighbourhood, not the old one it may leave.
  const current = laid?.model === model && laid?.filters === filters;
  // Says what the layout on screen was made from, which lags the controls until the next one comes.
  const drawnFocus = laid?.filters?.focus;
  const count = !layout
    ? ""
    : drawnFocus
      ? `${layout.graph.nodes.length} of ${plural(findable.nodes.length, "screen")}: ${plural(drawnFocus.steps, "step")} from ${drawnFocus.id}`
      : `${plural(layout.graph.nodes.length, "screen")} · ${plural(layout.graph.edges.length, "link")}`;

  return (
    <main id="main" class="view map">
      <div class="map__head">
        <h1>App map</h1>
        <p class="map__count">{count}</p>
        <MapFind nodes={findable.nodes} choose={found} disabled={findable.nodes.length === 0} />
        <MapFocus level={level} recentre={mode} onLevel={changeLevel} onRecentre={changeMode} centred={centre !== null} onAll={clear} />
        <div class="map__filters">
          <label class="map__filter">
            Platform
            <select value={shown.platform} onChange={(e) => setPlatform((e.currentTarget as HTMLSelectElement).value)}>
              <option value="">All</option>
              {platforms.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label class="map__filter">
            <input type="checkbox" checked={showProposed} onChange={(e) => setShowProposed((e.currentTarget as HTMLInputElement).checked)} />
            Show proposed
          </label>
          <label class="map__filter">
            <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected((e.currentTarget as HTMLInputElement).checked)} />
            Only links of selected
          </label>
        </div>
      </div>
      <p id="map-help" class="map__help">
        Click a screen, or Tab to it, to select it and highlight its links; arrow keys move to the nearest screen; Space centres on a
        screen; Enter opens it in the screen editor; Escape clears the selection; type in Find a screen to jump to it.
      </p>
      <p class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {said && selected ? selectionStatus(selected, said.out.length, said.into.length) : ""}
      </p>
      {!laid ? (
        <p class="view__note">Laying out the map…</p>
      ) : laid.error && !layout ? (
        <p class="view__note" role="alert">
          {layoutFailure(laid.error)}
        </p>
      ) : layout && layout.nodes.length === 0 ? (
        <p class="view__note">There are no screens to show{shown.platform || !showProposed ? " with these filters" : ": add one in Screens"}.</p>
      ) : layout ? (
        // Escape clears the selection from the map or its panel, not from the filters.
        <div ref={body} class="map__body" onKeyDown={onKeyDown}>
          <MapCanvas layout={layout} selected={selected} onlySelected={onlySelected} errors={errors} select={select} focus={current ? focus : null} onFocused={clearFocus} />
          <MapPanel model={model} graph={layout.graph} selected={selected} go={go} />
        </div>
      ) : null}
      <p class="map__caption">
        Arrows are every <code>to:</code> in screens.yaml, labelled with the region that navigates — the same graph as{" "}
        <code>generated/app-map.md</code>. The map shows every place a person <em>can</em> go. A flow is one path someone <em>does</em> take,
        in order — open it from Flows › Walk through.
      </p>
      {graph ? <MapTable graph={graph} /> : null}
    </main>
  );
}

export function AppMap({ route }: { route: Route }) {
  const model = app.model.value;
  if (!model) {
    return (
      <main id="main" class="view">
        <h1>App map</h1>
        <p class="view__note">Reading the project…</p>
      </main>
    );
  }
  // App shows this view only for map routes; MapView stays mounted across them, so a new centre keeps the layout.
  return <MapView model={model} route={route.name === "map" ? route : { name: "map" }} />;
}
