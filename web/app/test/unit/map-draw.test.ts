// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { describe, expect, it } from "vitest";

import { chunks, drawnAfter, EDGE_BATCH, NODE_BATCH } from "../../src/map/draw.ts";

describe("drawnAfter", () => {
  it("draws the screens a batch per frame first, then the edges a batch per frame", () => {
    // 300 screens, 900 edges: three frames of screens, then six of edges.
    expect(drawnAfter(0, 300, 900)).toEqual({ nodes: NODE_BATCH, edges: 0 });
    expect(drawnAfter(1, 300, 900)).toEqual({ nodes: 2 * NODE_BATCH, edges: 0 });
    expect(drawnAfter(2, 300, 900)).toEqual({ nodes: 300, edges: 0 });
    expect(drawnAfter(3, 300, 900)).toEqual({ nodes: 300, edges: EDGE_BATCH });
    expect(drawnAfter(8, 300, 900)).toEqual({ nodes: 300, edges: 900 });
    expect(drawnAfter(20, 300, 900)).toEqual({ nodes: 300, edges: 900 });
  });

  it("adds no more than a batch of screens or of edges in any one frame", () => {
    for (const [nodes, edges] of [
      [300, 900],
      [301, 1],
      [7, 39],
      [1, 0],
      [0, 0],
    ] as const) {
      let last = { nodes: 0, edges: 0 };
      for (let f = 0; f < 40; f++) {
        const now = drawnAfter(f, nodes, edges);
        expect(now.nodes - last.nodes).toBeLessThanOrEqual(NODE_BATCH);
        expect(now.edges - last.edges).toBeLessThanOrEqual(EDGE_BATCH);
        // No frame both adds screens and edges: each is its own commit.
        expect(now.nodes > last.nodes && now.edges > last.edges).toBe(false);
        last = now;
      }
      expect(last).toEqual({ nodes, edges });
    }
  });

  it("draws a small map's screens at once and its edges the frame after", () => {
    expect(drawnAfter(0, 7, 39)).toEqual({ nodes: 7, edges: 0 });
    expect(drawnAfter(1, 7, 39)).toEqual({ nodes: 7, edges: 39 });
  });
});

describe("chunks", () => {
  it("splits in order into runs of size, the last one shorter", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 2)).toEqual([]);
  });
});
