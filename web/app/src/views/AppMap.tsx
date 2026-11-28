// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app map (#/map): navigation structure only. Every to: in the
// registry is an edge between screens, labelled with the region that
// navigates, with no order and no action wording; a flow, one ordered
// path, is Flows' job. Selecting a screen highlights its links in and out.
// This module, ELK's API and its worker load only when the map is first
// shown (LazyAppMap); the layout runs in the worker, so the page stays
// responsive however large the project.

import type { Diagnostic, Model } from "@c65llc/starboard-core";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { TargetedKeyboardEvent } from "preact";

import { MapCanvas } from "../components/MapCanvas.tsx";
import type { FocusRequest } from "../components/MapCanvas.tsx";
import { MapFind } from "../components/MapFind.tsx";
import { linksOf, MapPanel } from "../components/MapPanel.tsx";
import { MapTable } from "../components/MapTable.tsx";
import { buildMap, mapPlatforms } from "../map/graph.ts";
import type { MapFilters } from "../map/graph.ts";
import { layoutFailure, layoutMap } from "../map/layout.ts";
import type { MapLayout } from "../map/layout.ts";
import { selectionStatus } from "../map/nav.ts";
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
  error?: string;
  /** What it was laid out for: a layout of an older model or filters is shown only until the new one comes. */
  model: Model;
  filters: MapFilters;
}

function MapView({ model }: { model: Model }) {
  const platforms = useMemo(() => mapPlatforms(model), [model]);
  const [platform, setPlatform] = useState("");
  const [showProposed, setShowProposed] = useState(true);
  const [onlySelected, setOnlySelected] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [laid, setLaid] = useState<Laid | null>(null);
  const diagnostics = app.lint.value?.diagnostics;
  const errors = useMemo(() => errorCounts(diagnostics ?? [], model), [diagnostics, model]);

  const filters = useMemo<MapFilters>(() => ({ platform: platforms.includes(platform) ? platform : "", showProposed }), [platform, platforms, showProposed]);
  useEffect(() => {
    let live = true;
    layoutMap(model, filters)
      .then((layout) => live && setLaid({ layout, model, filters }))
      .catch((err: unknown) => live && setLaid({ error: err instanceof Error ? err.message : String(err), model, filters }));
    return () => {
      live = false;
    };
  }, [model, filters]);

  // Until a new layout arrives (another filter, an edit) the last one stays.
  const layout = laid?.layout;
  // A focus request goes to the canvas only on the layout for what is shown
  // now: centred on a stale one, the screen would move off when the new one
  // came. The request itself waits in state, where a selection can cancel it.
  const current = laid?.model === model && laid.filters === filters;
  const selected = picked !== null && layout?.graph.nodes.some((n) => n.id === picked) ? picked : null;
  // A screen to focus: MapCanvas draws it first if its batch has not come yet.
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const go = (id: string) => {
    setPicked(id);
    setFocus({ id });
  };
  // A Find result can be anywhere on a large map, so it is brought to the middle, not just to an edge.
  const found = (id: string) => {
    setPicked(id);
    setFocus({ id, centre: true });
  };
  // Handled, the request goes: a MapCanvas made again (a filter that empties the map, then fills it) must not take focus again.
  const clearFocus = () => setFocus(null);
  // A selection of another screen is newer than a focus request still
  // waiting for its layout, so it cancels it: the request landing later would
  // select its own screen again. The request's own focus selects its screen,
  // which keeps it.
  const select = (id: string) => {
    setPicked(id);
    setFocus((f) => (f && f.id !== id ? null : f));
  };
  const onKeyDown = (e: TargetedKeyboardEvent<HTMLElement>) => {
    // A waiting request counts: its screen would be selected when its layout came.
    if (e.key === "Escape" && (selected !== null || focus !== null)) {
      setPicked(null);
      setFocus(null);
    }
  };
  const said = selected && layout ? linksOf(layout.graph, selected) : null;
  // What Find searches: the model through the platform and proposed filters
  // only, so it works while the first layout runs. Never a focused graph: a
  // screen outside the neighbourhood must still be found.
  const findable = useMemo(() => buildMap(model, filters), [model, filters]);
  // When the drawing fails, the table still lists every link.
  const graph = layout?.graph ?? (laid?.error ? findable : undefined);

  return (
    <main id="main" class="view map">
      <div class="map__head">
        <h1>App map</h1>
        <p class="map__count">
          {layout ? `${plural(layout.graph.nodes.length, "screen")} · ${plural(layout.graph.edges.length, "link")}` : ""}
        </p>
        <MapFind nodes={findable.nodes} choose={found} disabled={findable.nodes.length === 0} />
        <div class="map__filters">
          <label class="map__filter">
            Platform
            <select value={filters.platform} onChange={(e) => setPlatform((e.currentTarget as HTMLSelectElement).value)}>
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
        Click a screen, or Tab to it, to select it and highlight its links; arrow keys move to the nearest screen; Enter opens it in the
        screen editor; Escape clears the selection; type in Find a screen to jump to it.
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
        <p class="view__note">There are no screens to show{filters.platform || !showProposed ? " with these filters" : ": add one in Screens"}.</p>
      ) : layout ? (
        // Escape clears the selection from the map or its panel, not from the filters.
        <div class="map__body" onKeyDown={onKeyDown}>
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

export function AppMap() {
  const model = app.model.value;
  if (!model) {
    return (
      <main id="main" class="view">
        <h1>App map</h1>
        <p class="view__note">Reading the project…</p>
      </main>
    );
  }
  return <MapView model={model} />;
}
