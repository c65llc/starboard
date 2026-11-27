// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// How much of a laid-out map is drawn, frame by frame (MapCanvas). A
// 300-screen map is about 1,500 elements of screens and 3,600 of edges.
// Made in one commit, or even the 300 screens alone, the commit and the
// style and layout that follow it each held the main thread for 60 to 90
// ms at the CI runner's speed (#22). So the screens come a batch per
// frame, then the edges a batch per frame, never both in one frame, and
// each batch is its own commit with its own style and layout.

/** Screens drawn per animation frame. */
export const NODE_BATCH = 100;
/** Edges drawn per animation frame, once every screen is drawn. */
export const EDGE_BATCH = 150;

export interface Drawn {
  nodes: number;
  edges: number;
}

/** drawnAfter is how many of a map's nodes and edges are drawn in frame (0 is the layout's first commit). */
export function drawnAfter(frame: number, nodes: number, edges: number): Drawn {
  const nodeFrames = Math.ceil(nodes / NODE_BATCH);
  return {
    nodes: Math.min(nodes, (frame + 1) * NODE_BATCH),
    edges: Math.min(edges, Math.max(0, frame + 1 - nodeFrames) * EDGE_BATCH),
  };
}

/** chunks splits items, in order, into runs of size. */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
