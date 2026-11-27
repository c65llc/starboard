// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// How much of a laid-out map is drawn, frame by frame (MapCanvas). A
// 300-screen map is about 1,500 elements of screens and 3,600 of edges.
// Made in one commit, or even the 300 screens alone, the commit and the
// style and layout that follow it each held the main thread for 60 to 90
// ms at the CI runner's speed (#22). So the screens come a batch per
// frame, then the edges a batch per frame, never both in one frame, and
// each batch is its own commit with its own style and layout.
//
// A new layout of the map on screen (a filter, an edit) keeps every
// screen already drawn that is still in it: those are moved, not made
// again, so a focused screen keeps its focus; only the screens new to the
// map come in batches. The edges are drawn again from the first batch.

/** Screens drawn per animation frame. */
export const NODE_BATCH = 100;
/** Edges drawn per animation frame, once every screen is drawn. */
export const EDGE_BATCH = 150;

/** What is drawn: the screens by ID, and how many of the edges, in layout order. */
export interface Drawn {
  nodes: ReadonlySet<string>;
  edges: number;
}

/** more is drawn plus up to a batch of the screens in order it lacks. */
function more(order: readonly string[], drawn: Set<string>): Set<string> {
  let added = 0;
  for (const id of order) {
    if (added === NODE_BATCH) break;
    if (drawn.has(id)) continue;
    drawn.add(id);
    added++;
  }
  return drawn;
}

/** firstDraw is a layout's first commit, with nothing drawn before: a batch of screens. */
export function firstDraw(order: readonly string[]): Drawn {
  return { nodes: more(order, new Set()), edges: 0 };
}

/** redraw is a new layout's first commit over prev: every screen of prev still in order, a batch of the rest, and no edges yet. */
export function redraw(prev: Drawn, order: readonly string[]): Drawn {
  return { nodes: more(order, new Set(order.filter((id) => prev.nodes.has(id)))), edges: 0 };
}

/**
 * step is the next frame after d: the screens in also (those that must be
 * there now, such as the selected or focused one) and a batch more screens
 * until every one is drawn, then a batch more edges.
 */
export function step(d: Drawn, order: readonly string[], edges: number, also: Iterable<string> = []): Drawn {
  const inMap = new Set(order);
  const nodes = new Set(d.nodes);
  for (const id of also) if (inMap.has(id)) nodes.add(id);
  if (order.some((id) => !nodes.has(id))) return { nodes: more(order, nodes), edges: d.edges };
  return { nodes, edges: Math.min(edges, d.edges + EDGE_BATCH) };
}

/** complete is whether every screen in order and every one of edges is drawn. */
export function complete(d: Drawn, order: readonly string[], edges: number): boolean {
  return d.edges >= edges && order.every((id) => d.nodes.has(id));
}

/** chunks splits items, in order, into runs of size. */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
