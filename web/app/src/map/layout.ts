// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Where the app map draws each screen and link: ELK's layered algorithm,
// left to right, with orthogonal edges and one partition per area in
// config order, so areas read as columns. ELK is given an acyclic graph
// (backEdges), whatever cycles the registry has. The graph is sorted by ID
// (graph.ts) and ELK's seed is fixed, so the same model always gives the
// same coordinates. ELK is given to layoutMap; the app's runs in a worker
// (engine.ts), the unit tests' on their own thread.

import type { Model } from "@c65llc/starboard-core";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";

import { buildMap } from "./graph.ts";
import type { MapEdge, MapFilters, MapGraph, MapNode } from "./graph.ts";

/** The part of ELK layoutMap uses. */
export interface Elk {
  layout(graph: ElkNode): Promise<ElkNode>;
}

export interface PlacedNode {
  node: MapNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedEdge {
  edge: MapEdge;
  /** The route, start to end, as [x, y] pairs. */
  points: [number, number][];
  /** Where the label's box starts, when the edge has one. */
  label?: { x: number; y: number; width: number; height: number };
}

/**
 * An area's column: from its leftmost node to the right edge of its
 * rightmost. key is the screens' area as written, "" for none, so a lane
 * for screens with no area never merges with a real area; area is the
 * name shown.
 */
export interface Lane {
  key: string;
  area: string;
  x: number;
  width: number;
}

export interface MapLayout {
  graph: MapGraph;
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  lanes: Lane[];
}

export const NODE_HEIGHT = 56;
/** Room above the drawing for the area names. */
export const LANE_HEAD = 32;
const PAD = 16;
const LABEL_HEIGHT = 14;

/**
 * layoutFailure is what the map says when ELK could not lay it out: what
 * happened, where the links still are, and what to do about it.
 */
export function layoutFailure(error: string): string {
  return (
    `Starboard could not draw the map (the layout engine failed: ${error}). ` +
    "Every link is still listed in “Every link as a table” below, and each screen opens from Screens. " +
    "Please report this as a Starboard bug and attach your screens.yaml, which reproduces it."
  );
}

/** nodeMeta is the line under a node's ID: its presentation, and proposed when it is. */
export function nodeMeta(n: MapNode): string {
  return [n.presentation || "screen", n.proposed ? "proposed" : ""].filter(Boolean).join(" · ");
}

// Widths are estimated from character counts (the ID in 12px mono, the
// meta line in 11px sans; labels in 10.5px mono), so layout needs no DOM.
const nodeWidth = (n: MapNode) => Math.min(280, Math.max(150, Math.ceil(Math.max(n.id.length * 7.3, nodeMeta(n).length * 6.2 + 40)) + 26));
const labelWidth = (text: string) => Math.ceil(text.length * 6.4) + 6;

const OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.partitioning.activate": "true",
  "elk.randomSeed": "1",
  "elk.spacing.nodeNode": "28",
  "elk.layered.spacing.nodeNodeBetweenLayers": "56",
  "elk.spacing.edgeLabel": "4",
  "elk.layered.spacing.edgeNodeBetweenLayers": "20",
  // A label sits at the edge's source end, beside the region that navigates.
  "elk.edgeLabels.placement": "TAIL",
};

/**
 * Crossing minimisation's effort: ELK's default for an ordinary app, less
 * for a large one, where the default would take seconds (a 300-screen,
 * 600-link app: about 2.4 s at 7, 0.6 s at 2, measured in Node).
 */
const thoroughness = (nodes: number) => (nodes > 100 ? "2" : "7");

/**
 * backEdges is the IDs of the edges ELK must be given reversed so that what
 * it lays out has no cycle: every edge into an earlier area, and, inside an
 * area, every edge back to a screen still on the path of a depth-first
 * search. The search starts from an area's entrances, so a screen reads
 * left of the screens it leads to: first the screens reached from an
 * earlier area, then those no screen in their own area leads to, then the
 * rest; each group, and each screen's edges, in ID order, so the choice is
 * deterministic.
 *
 * ELK cannot be left to break cycles itself. Its cycle breaker ignores
 * partitions: on a graph with cycles inside areas it can reverse an edge
 * between two areas, even one on no cycle, and that edge then runs into an
 * earlier partition, which ELK fails on ("Cannot read properties of null").
 * An acyclic graph whose edges never point to an earlier area gives the
 * cycle breaker nothing to do.
 */
export function backEdges(graph: MapGraph): Set<string> {
  const area = new Map(graph.nodes.map((n) => [n.id, n.areaIndex]));
  const back = new Set<string>();
  const within = new Map<string, MapEdge[]>();
  const entered = new Set<string>();
  const led = new Set<string>();
  for (const e of graph.edges) {
    const [from, to] = [area.get(e.from) ?? 0, area.get(e.to) ?? 0];
    if (from > to) back.add(e.id);
    else if (from < to) entered.add(e.to);
    else {
      within.set(e.from, [...(within.get(e.from) ?? []), e]);
      led.add(e.to);
    }
  }
  const rank = (id: string) => (entered.has(id) ? 0 : led.has(id) ? 2 : 1);
  const roots = [...area.keys()].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
  for (const es of within.values()) es.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : a.id < b.id ? -1 : 1));
  // 0 unvisited, 1 on the search's path, 2 done.
  const state = new Map<string, number>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of within.get(id) ?? []) {
      const s = state.get(e.to) ?? 0;
      if (s === 1) back.add(e.id);
      else if (s === 0) visit(e.to);
    }
    state.set(id, 2);
  };
  for (const id of roots) if (!state.get(id)) visit(id);
  return back;
}

/** layoutMap lays model's map out under filters (all screens and links by default). */
export async function layoutMap(model: Model, filters: MapFilters = { platform: "", showProposed: true }, elk?: Elk): Promise<MapLayout> {
  const graph = buildMap(model, filters);
  const engine = elk ?? (await import("./engine.ts")).workerElk();
  const children: ElkNode[] = [...graph.nodes]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((n) => ({
      id: n.id,
      width: nodeWidth(n),
      height: NODE_HEIGHT,
      layoutOptions: { "elk.partitioning.partition": String(n.areaIndex) },
    }));
  const backward = backEdges(graph);
  const edges: ElkExtendedEdge[] = graph.edges.map((e) => {
    // A back edge is given to ELK the other way round; its route is
    // reversed afterwards.
    const back = backward.has(e.id);
    return {
      id: e.id,
      sources: [back ? e.to : e.from],
      targets: [back ? e.from : e.to],
      labels: e.label ? [{ text: e.label, width: labelWidth(e.label), height: LABEL_HEIGHT }] : [],
    };
  });
  const out = await engine.layout({ id: "map", layoutOptions: { ...OPTIONS, "elk.layered.thoroughness": thoroughness(children.length) }, children, edges });

  const placed = new Map<string, PlacedNode>();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const c of out.children ?? []) {
    const node = byId.get(c.id);
    if (node) placed.set(c.id, { node, x: PAD + (c.x ?? 0), y: LANE_HEAD + (c.y ?? 0), width: c.width ?? 0, height: c.height ?? 0 });
  }
  const routed = new Map((out.edges ?? []).map((e) => [e.id, e]));
  const placedEdges: PlacedEdge[] = [];
  for (const e of graph.edges) {
    const r = routed.get(e.id);
    const section = r?.sections?.[0];
    if (!r || !section) continue;
    const shift = ({ x, y }: { x: number; y: number }): [number, number] => [PAD + x, LANE_HEAD + y];
    let points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(shift);
    if (r.sources[0] !== e.from) points = points.reverse();
    const pe: PlacedEdge = { edge: e, points };
    const l = r.labels?.[0];
    if (l) pe.label = { x: PAD + (l.x ?? 0), y: LANE_HEAD + (l.y ?? 0), width: l.width ?? 0, height: l.height ?? 0 };
    placedEdges.push(pe);
  }

  const nodes = graph.nodes.flatMap((n) => placed.get(n.id) ?? []);
  const lanes: Lane[] = [];
  for (const n of nodes) {
    const key = n.node.area;
    const lane = lanes.find((l) => l.key === key);
    if (!lane) lanes.push({ key, area: key || "(no area)", x: n.x, width: n.width });
    else {
      const right = Math.max(lane.x + lane.width, n.x + n.width);
      lane.x = Math.min(lane.x, n.x);
      lane.width = right - lane.x;
    }
  }
  return {
    graph,
    width: Math.ceil(PAD * 2 + (out.width ?? 0)),
    height: Math.ceil(LANE_HEAD + PAD + (out.height ?? 0)),
    nodes,
    edges: placedEdges,
    lanes,
  };
}
