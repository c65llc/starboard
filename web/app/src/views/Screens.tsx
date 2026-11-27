// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The screen editor (#/screens/<id>): the screen list, the screen's
// header, a tab per form factor with its wireframe and references, the
// Source tab, the lint panel, and beside them the region tree and the
// inspector. Every change is an edit through core (src/screens/editor.ts),
// so what lands on disk is core's formatted output. When screens.yaml does
// not parse, the view says where and opens the Source tab to mend it.

import { useMemo } from "preact/hooks";
import type { Diagnostic, Model, Screen } from "@c65llc/starboard-core";

import { Inspector } from "../components/Inspector.tsx";
import { RegionTree } from "../components/RegionTree.tsx";
import { ScreenList } from "../components/ScreenList.tsx";
import { ScreenRefs } from "../components/ScreenRefs.tsx";
import { SourceEditor } from "../components/SourceEditor.tsx";
import { tabId, Toolbar } from "../components/Toolbar.tsx";
import type { TabSpec } from "../components/Toolbar.tsx";
import { Wireframe } from "../components/Wireframe.tsx";
import type { Route } from "../router.ts";
import { chosen, edit, formFactorOf, registryPath, run, saveStatus, selectRegion, tab } from "../screens/editor.ts";
import { findRegion, layoutValue, moveTarget, regionName, targetOf, treeRows, uniqueName } from "../screens/logic.ts";
import type { TreeRow } from "../screens/logic.ts";
import { app } from "../store.ts";
import { LintPanel } from "./LintPanel.tsx";
import "./screens.css";
import "./inspector.css";

const PANEL = "screen-panel";

/** brokenRegistry is the error that keeps screens.yaml from loading, if one does. */
function brokenRegistry(model: Model | null, diagnostics: Diagnostic[], path: string): Diagnostic | undefined {
  if (model && model.screens.length > 0) return undefined;
  return diagnostics.find((d) => d.file === path && d.severity === "error");
}

function StatusPills({ screen }: { screen: Screen }) {
  const entries = Object.entries(screen.status);
  const statuses = [...new Set(entries.map(([, st]) => st))];
  // One status everywhere is said once; otherwise each platform's is.
  const chips = statuses.length === 1 ? statuses : entries.map(([platform, st]) => `${platform}: ${st}`);
  return (
    <>
      {chips.map((c) => (
        <span key={c} class={`chip chip--${c.endsWith("proposed") ? "proposed" : "shipped"}`}>
          {c}
        </span>
      ))}
      <span class="chip">{screen.presentation}</span>
    </>
  );
}

/** The region tree, its buttons and the inspector, for one screen on one form factor. */
function Aside({ screen, formFactor, model }: { screen: Screen; formFactor: string; model: Model }) {
  const override = formFactor in screen.layouts;
  const layout = override ? (screen.layouts[formFactor] ?? []) : screen.layout;
  const root = override ? `layouts.${formFactor}` : "";
  const rows = useMemo(() => treeRows(layout), [layout]);
  const sel = app.selection.value;
  const selectedPath = sel.screen === screen.id ? sel.region : undefined;
  const region = selectedPath ? findRegion(layout, selectedPath) : null;
  const selectedRow = rows.find((r) => r.region.path === selectedPath);

  const move = (row: TreeRow, by: -1 | 1) => {
    const to = moveTarget(row, by);
    if (!to) return;
    selectRegion(screen.id, to.path);
    void edit([{ op: "moveRegion", screen: screen.id, path: row.region.path, index: to.index }]);
  };
  const add = () => {
    const name = uniqueName([screen.layout, ...Object.values(screen.layouts)], "region");
    const parent = selectedRow && selectedRow.movable ? rows[selectedRow.parent] : undefined;
    const into = selectedRow && selectedRow.movable ? (parent ? parent.region.path : root) : root;
    const index = selectedRow && selectedRow.movable ? selectedRow.index + 1 : layout.length;
    const base = into === root ? `${root || "layout"}` : `${into}.children`;
    selectRegion(screen.id, `${base}[${index}]`);
    void edit([{ op: "insertRegion", screen: screen.id, path: into, index, value: { region: name, kind: "text" } }]);
  };
  const remove = () => {
    if (!region || !selectedRow?.movable) return;
    selectRegion(screen.id);
    void edit([{ op: "removeRegion", screen: screen.id, path: region.path }]);
  };
  const label = `Layout · ${formFactor}${override ? "" : " (default layout)"}`;
  return (
    <aside class="screens__aside" aria-label="Inspector">
      <h2 class="screens__aside-title">{label}</h2>
      <RegionTree
        label={label}
        rows={rows}
        selected={selectedPath}
        onSelect={(path) => selectRegion(screen.id, path)}
        onMove={move}
      />
      <div class="screens__tree-actions">
        <button type="button" class="button button--small" onClick={add}>
          <span aria-hidden="true">+</span> Region
        </button>
        <button
          type="button"
          class="button button--small"
          disabled={!selectedRow || !moveTarget(selectedRow, -1)}
          onClick={() => selectedRow && move(selectedRow, -1)}
        >
          Move up
        </button>
        <button
          type="button"
          class="button button--small"
          disabled={!selectedRow || !moveTarget(selectedRow, 1)}
          onClick={() => selectedRow && move(selectedRow, 1)}
        >
          Move down
        </button>
        <button type="button" class="button button--small" disabled={!selectedRow?.movable} onClick={remove}>
          Remove{region ? ` ${regionName(region)}` : ""}
        </button>
      </div>
      <Inspector
        screen={screen}
        region={region}
        kinds={model.kinds}
        presentations={model.presentations}
        screenIds={model.screens.map((s) => s.id)}
        set={(path, key, value) => void edit([{ op: "set", screen: screen.id, path, key, value }])}
      />
    </aside>
  );
}

export function Screens({ route }: { route: Route }) {
  const model = app.model.value;
  const lint = app.lint.value;
  const files = app.files.value;
  const reg = registryPath.value;
  const diagnostics = lint?.diagnostics ?? [];
  const screens = model?.screens ?? [];
  const wanted = route.name === "screens" ? route.screen : undefined;
  const screen = wanted === undefined ? screens[0] : screens.find((s) => s.id === wanted);
  const broken = brokenRegistry(model, diagnostics, reg);

  const withErrors = useMemo(() => {
    const out = new Set<string>();
    for (const d of diagnostics) {
      if (d.severity !== "error") continue;
      const t = targetOf(d, screens, []);
      if (t.kind === "screen") out.add(t.screen);
    }
    return out;
  }, [diagnostics, screens]);

  const formFactor = screen ? formFactorOf(screen) : "";
  const showSource = tab.value === "source" || !screen;
  const tabs: TabSpec[] = [
    ...(screen?.formFactors ?? []).map((ff) => ({ id: `ff-${ff}`, label: ff in (screen?.layouts ?? {}) ? `${ff} · override` : ff })),
    { id: "source", label: "Source" },
  ];
  const current = showSource ? "source" : `ff-${formFactor}`;
  const onTab = (id: string) => {
    if (id === "source") {
      tab.value = "source";
      return;
    }
    tab.value = "layout";
    if (screen) chosen.value = { screen: screen.id, formFactor: id.slice("ff-".length) };
  };
  const override =
    screen && !showSource && formFactor && !(formFactor in screen.layouts)
      ? {
          formFactor,
          run: () =>
            void edit([{ op: "set", screen: screen.id, path: "", key: `layouts.${formFactor}`, value: layoutValue(screen.layout) }]),
        }
      : undefined;

  return (
    <div class="screens">
      <ScreenList screens={screens} current={screen?.id} withErrors={withErrors} />
      <main id="main" class="screens__main">
        <div class="screens__head">
          <div class="screens__title-row">
            <h1>{screen ? screen.title || screen.id : "Screens"}</h1>
            {screen ? (
              <>
                <code class="screens__id">{screen.id}</code>
                <StatusPills screen={screen} />
              </>
            ) : null}
          </div>
          {screen?.purpose ? <p class="screens__purpose">{screen.purpose}</p> : null}
          {broken ? (
            <p class="alert" role="alert">
              screens.yaml does not parse: {broken.message}
              {broken.line ? ` (line ${broken.line})` : ""}. Fix it in the Source tab below, then save.
            </p>
          ) : !model ? (
            <p class="screens__note">Reading the project…</p>
          ) : wanted !== undefined && !screen ? (
            <p class="screens__note">There is no screen {wanted} in screens.yaml.</p>
          ) : screens.length === 0 ? (
            <p class="screens__note">No screens yet: add one to screens.yaml in the Source tab.</p>
          ) : null}
          <Toolbar
            tabs={tabs}
            current={current}
            panel={PANEL}
            onTab={onTab}
            override={override}
            status={saveStatus.value}
          />
        </div>
        <div class="screens__panel" id={PANEL} role="tabpanel" aria-labelledby={tabId(current)}>
          {showSource ? (
            <SourceEditor
              path={reg}
              text={files[reg] ?? ""}
              editable={broken !== undefined}
              onSave={(text) => void run(app.applyChanges({ [reg]: text }))}
            />
          ) : screen ? (
            <div class="screens__canvas">
              {formFactor ? (
                <Wireframe files={files} screen={screen.id} formFactor={formFactor} />
              ) : (
                <p class="screens__note">This screen is on no platform, so it has no form factor to draw.</p>
              )}
              <ScreenRefs screen={screen} flows={model?.flows ?? []} />
            </div>
          ) : null}
        </div>
        <LintPanel />
      </main>
      {screen && model && !showSource ? <Aside screen={screen} formFactor={formFactor} model={model} /> : null}
    </div>
  );
}
