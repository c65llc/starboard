// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app map's graph, from core.model: navigation structure only. Every
// to: in a screen's default layout is a link; a link between two drawn
// screens is an edge. A tabs region's links are two-way, so a pair of
// screens joined by tabs is one edge with arrowheads at both ends. There is
// no order and no action wording: an edge is labelled with the region that
// navigates. Everything is sorted by ID, so the same model always gives the
// same graph (layout.ts relies on it).

import type { Flow, Model, NavItem, Region, Screen } from "@c65llc/starboard-core";

import { findRefs, refSyntax } from "../flows/refs.ts";

/** What the map shows: one platform or all ("") and whether proposed screens and links are drawn. */
export interface MapFilters {
  platform: string;
  showProposed: boolean;
}

export const ALL_LINKS: MapFilters = { platform: "", showProposed: true };

export interface MapNode {
  id: string;
  title: string;
  area: string;
  /** The area's place in model.areas; an area the config lacks comes after them all. */
  areaIndex: number;
  presentation: string;
  proposed: boolean;
}

/** One to: as written, for the text alternative and the selected screen's panel. */
export interface MapLink {
  from: string;
  to: string;
  region: string;
  path: string;
  /** "tabs" for a tabs region's link, else the target's presentation, or "link" when it has none. */
  kind: string;
  twoWay: boolean;
  proposed: boolean;
  /** The target is a registered screen. */
  registered: boolean;
}

/** One drawn edge. A two-way edge stands for the tabs links either way between from and to. */
export interface MapEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: string;
  twoWay: boolean;
  proposed: boolean;
}

export interface MapGraph {
  nodes: MapNode[];
  edges: MapEdge[];
  /** Every to: from a drawn screen, to a drawn or unregistered one, self links included; by from, to, path. */
  links: MapLink[];
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** mapPlatforms is the platforms the screens are on, in config order (each screen lists its own in that order). */
export function mapPlatforms(model: Model): string[] {
  const out: string[] = [];
  for (const s of model.screens) {
    let at = 0;
    for (const p of s.platforms) {
      const i = out.indexOf(p);
      if (i < 0) out.splice(at++, 0, p);
      else at = i + 1;
    }
  }
  return out;
}

/** screenProposed: proposed on the platform, or with "" on every platform it is on. */
export function screenProposed(s: Screen, platform: string): boolean {
  if (platform) return s.status[platform] === "proposed";
  return s.platforms.length > 0 && s.platforms.every((p) => s.status[p] === "proposed");
}

interface Via {
  kind: string;
  proposed: boolean;
}

/** vias maps each region and nav item path of s's default layout to its kind and whether it, or a region around it, is proposed. */
function vias(s: Screen): Map<string, Via> {
  const out = new Map<string, Via>();
  const walk = (regions: Region[], inherited: boolean) => {
    for (const r of regions) visit(r, inherited);
  };
  const visit = (r: Region, inherited: boolean) => {
    const proposed = r.status ? r.status === "proposed" : inherited;
    out.set(r.path, { kind: r.kind, proposed });
    r.items.forEach((it: NavItem) => {
      out.set(it.path, { kind: r.kind, proposed: it.status ? it.status === "proposed" : proposed });
    });
    walk(r.children, proposed);
    if (r.item) visit(r.item, proposed);
  };
  walk(s.layout, false);
  return out;
}

/** buildMap is the map of model under filters. */
export function buildMap(model: Model, filters: MapFilters): MapGraph {
  const areaIndex = (area: string) => {
    const i = model.areas.indexOf(area);
    return i < 0 ? model.areas.length : i;
  };
  const all = new Map(model.screens.map((s) => [s.id, s]));
  const shown = new Map<string, MapNode>();
  for (const s of model.screens) {
    if (filters.platform && !s.platforms.includes(filters.platform)) continue;
    const proposed = screenProposed(s, filters.platform);
    if (proposed && !filters.showProposed) continue;
    shown.set(s.id, {
      id: s.id,
      title: s.title,
      area: s.area,
      areaIndex: areaIndex(s.area),
      presentation: s.presentation,
      proposed,
    });
  }

  const links: MapLink[] = [];
  for (const s of model.screens) {
    const from = shown.get(s.id);
    if (!from) continue;
    const at = vias(s);
    for (const e of s.edges) {
      const target = all.get(e.to);
      const to = shown.get(e.to);
      if (target && !to) continue; // registered, but filtered out
      const via = at.get(e.path) ?? { kind: "", proposed: false };
      const twoWay = via.kind === "tabs";
      const proposed = via.proposed || from.proposed || (to?.proposed ?? false);
      if (proposed && !filters.showProposed) continue;
      links.push({
        from: s.id,
        to: e.to,
        region: e.region,
        path: e.path,
        kind: twoWay ? "tabs" : target?.presentation || "link",
        twoWay,
        proposed,
        registered: target !== undefined,
      });
    }
  }
  links.sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.path, b.path));

  // A drawn edge joins two different drawn screens. Tabs links between the
  // same pair, either way, become one two-way edge; it is proposed only
  // when every link it stands for is.
  const edges = new Map<string, MapEdge & { labels: Set<string> }>();
  for (const l of links) {
    if (!l.registered || l.from === l.to) continue;
    if (l.twoWay) {
      const [a, b] = l.from < l.to ? [l.from, l.to] : [l.to, l.from];
      const id = `${a}<->${b}`;
      const had = edges.get(id);
      if (had) {
        had.labels.add(l.region);
        had.proposed &&= l.proposed;
      } else {
        edges.set(id, { id, from: a, to: b, label: "", kind: l.kind, twoWay: true, proposed: l.proposed, labels: new Set([l.region]) });
      }
    } else {
      const id = `${l.from}->${l.to}@${l.path}`;
      edges.set(id, { id, from: l.from, to: l.to, label: l.region, kind: l.kind, twoWay: false, proposed: l.proposed, labels: new Set() });
    }
  }
  const drawn = [...edges.values()]
    .map(({ labels, ...e }) => (e.twoWay ? { ...e, label: [...labels].filter(Boolean).sort().join(" / ") } : e))
    .sort(byId);

  return { nodes: [...shown.values()].sort((a, b) => a.areaIndex - b.areaIndex || byId(a, b)), edges: drawn, links };
}

/** A flow passing through a screen, and the first step that references it. */
export interface FlowThrough {
  flow: Flow;
  step: number;
}

/** flowsThrough lists, in file order, the flows with a step that references screen id, each at the first such step. */
export function flowsThrough(model: Model, id: string): FlowThrough[] {
  const syntax = refSyntax(model.refPattern);
  const out: FlowThrough[] = [];
  for (const flow of model.flows) {
    const step = flow.steps.find((s) => s.screen === id || findRefs(s.text, syntax).some((r) => r.screen === id));
    if (step) out.push({ flow, step: step.number });
  }
  return out;
}
