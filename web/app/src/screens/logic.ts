// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The screen editor's pure logic, kept out of the components so it is
// unit-tested: filtering and grouping the screen list, flattening a layout
// into the region tree's rows, where a keyboard move sends a region, which
// screen and region a lint finding is about, and a layout as the value of
// an Override layout edit. None of it decides anything about the project:
// core does that, and these only shape what core returned for the view.

import type { Diagnostic, Flow, Region, Screen } from "@c65llc/starboard-core";

// --- the screen list ------------------------------------------------------

/** A row of the screen list: an area's heading, or one of its screens. */
export type ListRow = { kind: "area"; area: string } | { kind: "screen"; screen: Screen };

/** proposedAnywhere reports whether s is proposed on any of its platforms. */
export function proposedAnywhere(s: Screen): boolean {
  return Object.values(s.status).includes("proposed");
}

/**
 * matches reports whether s passes query: each word must match, where
 * status:<value> matches the screen's status on any platform and any
 * other word is found in its ID or title, ignoring case.
 */
export function matches(s: Screen, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => {
    if (w.startsWith("status:")) return Object.values(s.status).includes(w.slice("status:".length));
    return s.id.toLowerCase().includes(w) || s.title.toLowerCase().includes(w);
  });
}

/** listRows is the screens passing query, grouped by area in the order areas first appear. */
export function listRows(screens: Screen[], query: string): ListRow[] {
  const byArea = new Map<string, Screen[]>();
  for (const s of screens) {
    if (!matches(s, query)) continue;
    const group = byArea.get(s.area);
    if (group) group.push(s);
    else byArea.set(s.area, [s]);
  }
  const rows: ListRow[] = [];
  for (const [area, group] of byArea) {
    rows.push({ kind: "area", area });
    for (const screen of group) rows.push({ kind: "screen", screen });
  }
  return rows;
}

/** The rows a windowed list draws: first..last, end exclusive, with overscan rows either side. */
export function visibleRange(
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  count: number,
  overscan = 8,
): { first: number; last: number } {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return { first, last: Math.max(first, last) };
}

// --- the region tree ------------------------------------------------------

/** A row of the region tree. siblings is the path of the list the region sits in, or null for a list's item. */
export interface TreeRow {
  region: Region;
  depth: number;
  /** The row of the region holding this one, or -1 at the top level. */
  parent: number;
  /** The position among its siblings, and how many there are; a list's item is 0 of 1. */
  index: number;
  count: number;
  /** Whether moveRegion may move it: every region but a list's item. */
  movable: boolean;
}

/** treeRows flattens a layout depth first: each region, then its children, then its item. */
export function treeRows(layout: Region[]): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (regions: Region[], depth: number, parent: number) => {
    regions.forEach((region, index) => {
      const at = rows.length;
      rows.push({ region, depth, parent, index, count: regions.length, movable: true });
      walk(region.children, depth + 1, at);
      if (region.item) {
        rows.push({ region: region.item, depth: depth + 1, parent: at, index: 0, count: 1, movable: false });
        walk(region.item.children, depth + 2, rows.length - 1);
      }
    });
  };
  walk(layout, 0, -1);
  return rows;
}

/** siblingPath is the path of the region at index among the same list as path's region. */
export function siblingPath(path: string, index: number): string {
  return path.replace(/\[\d+\]$/, `[${index}]`);
}

/**
 * moveTarget is where Alt+Up (-1) or Alt+Down (+1) sends row: the
 * moveRegion op and the region's path afterwards, or null at either end of
 * its list or for a list's item.
 */
export function moveTarget(row: TreeRow, by: -1 | 1): { index: number; path: string } | null {
  if (!row.movable) return null;
  const index = row.index + by;
  if (index < 0 || index >= row.count) return null;
  return { index, path: siblingPath(row.region.path, index) };
}

/** findRegion is the region at path in layout, or null. */
export function findRegion(layout: Region[], path: string): Region | null {
  return treeRows(layout).find((r) => r.region.path === path)?.region ?? null;
}

/** The name the tree and the inspector show: a list's item has none of its own. */
export function regionName(r: Region): string {
  return r.name || "item";
}

/** uniqueName is base, or base-2, base-3…, whichever no region of layouts uses. */
export function uniqueName(layouts: Region[][], base: string): string {
  const used = new Set(layouts.flatMap((l) => treeRows(l).map((r) => r.region.name)));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// --- layouts as edit values -----------------------------------------------

type Mapping = Record<string, unknown>;

/** widthValue is a width as written in YAML: pixels as a number, a fraction as text. */
function widthValue(width: string): number | string {
  return /^\d+$/.test(width) ? Number(width) : width;
}

/** regionValue is r as the mapping screens.yaml holds, with only the fields it sets. */
export function regionValue(r: Region): Mapping {
  const out: Mapping = {};
  if (r.name) out["region"] = r.name;
  out["kind"] = r.kind;
  for (const key of ["label", "to", "requires", "status", "platformNote"] as const) {
    if (r[key]) out[key] = r[key];
  }
  if (r.width) out["width"] = widthValue(r.width);
  if (r.children.length > 0) out["children"] = r.children.map(regionValue);
  if (r.item) out["item"] = regionValue(r.item);
  if (r.empty) out["empty"] = { label: r.empty.label };
  if (r.items.length > 0) {
    out["items"] = r.items.map((it) => {
      const item: Mapping = { label: it.label };
      if (it.to) item["to"] = it.to;
      if (it.requires) item["requires"] = it.requires;
      if (it.status) item["status"] = it.status;
      return item;
    });
  }
  return out;
}

/** layoutValue is a layout as the value of a set of layouts.<form factor>. */
export function layoutValue(layout: Region[]): Mapping[] {
  return layout.map(regionValue);
}

// --- references -----------------------------------------------------------

/**
 * flowsUsing is the flows that name screen id, in file order: by entry or
 * any reference (core's flow.screens), the CLI catalog's "Used in flows".
 */
export function flowsUsing(flows: Flow[], id: string): Flow[] {
  return flows.filter((f) => f.screens.includes(id));
}

/** navigatesTo is the screens s's default layout leads to, each once, in order. */
export function navigatesTo(s: Screen): string[] {
  return [...new Set(s.edges.map((e) => e.to))];
}

// --- lint findings --------------------------------------------------------

/** Where a finding points: a screen and maybe a region path below it, a flow, the registry's source, or nowhere in particular. */
export type Target =
  | { kind: "screen"; screen: string; region?: string; formFactor?: string }
  | { kind: "flow"; flow: string }
  | { kind: "source"; line?: number }
  | { kind: "none" };

/**
 * targetOf is what clicking d selects. A finding on screens.yaml whose path
 * is screens.<id>[.<region path>[.<field>]] selects that screen, and the
 * deepest region its path names; one on a flow file opens that flow. Any
 * other finding on registry, the path of screens.yaml (a syntax error, a
 * screen no longer there), opens its source.
 */
export function targetOf(d: Diagnostic, screens: Screen[], flows: Flow[], registry?: string): Target {
  const flow = flows.find((f) => f.file === d.file);
  if (flow) return { kind: "flow", flow: flow.id };
  const found = screenTarget(d, screens);
  if (found) return found;
  if (registry !== undefined && d.file === registry) return d.line ? { kind: "source", line: d.line } : { kind: "source" };
  return { kind: "none" };
}

function screenTarget(d: Diagnostic, screens: Screen[]): Target | undefined {
  if (!d.path.startsWith("screens.")) return undefined;
  const rest = d.path.slice("screens.".length);
  // IDs hold dots, so take the longest ID the path starts with.
  const screen = screens
    .filter((s) => rest === s.id || rest.startsWith(`${s.id}.`))
    .sort((a, b) => b.id.length - a.id.length)[0];
  if (!screen) return undefined;
  const below = rest.slice(screen.id.length + 1);
  const trees: [string | undefined, Region[]][] = [
    [undefined, screen.layout],
    ...Object.entries(screen.layouts).map(([ff, l]): [string, Region[]] => [ff, l]),
  ];
  let best: { path: string; formFactor: string | undefined } | undefined;
  for (const [formFactor, layout] of trees) {
    for (const row of treeRows(layout)) {
      const p = row.region.path;
      const covers = below === p || below.startsWith(`${p}.`) || below.startsWith(`${p}[`);
      if (covers && (!best || p.length > best.path.length)) best = { path: p, formFactor };
    }
  }
  if (!best) return { kind: "screen", screen: screen.id };
  const target: Target = { kind: "screen", screen: screen.id, region: best.path };
  if (best.formFactor) target.formFactor = best.formFactor;
  return target;
}

/** fixable counts the findings core.fix clears: those that carry a fix. */
export function fixable(diagnostics: Diagnostic[]): number {
  return diagnostics.filter((d) => d.fix).length;
}

// --- a new screen -----------------------------------------------------------

/**
 * newScreenProblem says what is wrong with a new screen's ID and title, or
 * null when nothing is. pattern is core.model's idPattern, the registry's
 * own rule, so the form is not restated here.
 */
export function newScreenProblem(s: { id: string; title: string }, screens: Screen[], pattern: string): string | null {
  const id = s.id.trim();
  if (id === "") return "Enter an ID, such as trip.timeline.";
  if (!new RegExp(pattern).test(id)) {
    return "An ID is area.name: two or more parts joined by dots, each starting with a lower-case letter and using a–z, 0–9 and -.";
  }
  if (screens.some((x) => x.id === id)) return `A screen ${id} already exists; choose another ID.`;
  if (s.title.trim() === "") return "Enter a title.";
  return null;
}
