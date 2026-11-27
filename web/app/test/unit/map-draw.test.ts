// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { describe, expect, it } from "vitest";

import { chunks, complete, EDGE_BATCH, firstDraw, NODE_BATCH, redraw, step } from "../../src/map/draw.ts";
import type { Drawn } from "../../src/map/draw.ts";

const ids = (n: number, prefix = "s") => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, "0")}`);

/** frames steps d to completion, returning every frame's state, the first included. */
function frames(d: Drawn, order: string[], edges: number): Drawn[] {
  const out = [d];
  while (!complete(out[out.length - 1] as Drawn, order, edges) && out.length < 100) out.push(step(out[out.length - 1] as Drawn, order, edges));
  return out;
}

describe("firstDraw and step", () => {
  it("draw the screens a batch per frame first, in order, then the edges a batch per frame", () => {
    const order = ids(300);
    const all = frames(firstDraw(order), order, 900);
    expect(all.map((d) => [d.nodes.size, d.edges])).toEqual([
      [100, 0],
      [200, 0],
      [300, 0],
      [300, 150],
      [300, 300],
      [300, 450],
      [300, 600],
      [300, 750],
      [300, 900],
    ]);
    expect([...(all[0] as Drawn).nodes]).toEqual(order.slice(0, NODE_BATCH));
  });

  it("add no more than a batch of screens or of edges in any one frame, never both", () => {
    for (const [n, e] of [
      [300, 900],
      [301, 1],
      [7, 39],
      [1, 0],
      [0, 0],
    ] as const) {
      const order = ids(n);
      const all = frames(firstDraw(order), order, e);
      for (let i = 1; i < all.length; i++) {
        const [was, now] = [all[i - 1] as Drawn, all[i] as Drawn];
        expect(now.nodes.size - was.nodes.size).toBeLessThanOrEqual(NODE_BATCH);
        expect(now.edges - was.edges).toBeLessThanOrEqual(EDGE_BATCH);
        expect(now.nodes.size > was.nodes.size && now.edges > was.edges).toBe(false);
      }
      const last = all[all.length - 1] as Drawn;
      expect([last.nodes.size, Math.min(last.edges, e)]).toEqual([n, e]);
    }
  });

  it("draw a small map's screens at once and its edges the frame after", () => {
    const order = ids(7);
    expect(firstDraw(order).nodes.size).toBe(7);
    expect(complete(firstDraw(order), order, 39)).toBe(false);
    expect(step(firstDraw(order), order, 39).edges).toBeGreaterThanOrEqual(39);
  });

  it("keep the screens a step is told to draw, ahead of their batch", () => {
    const order = ids(300);
    const d = step(firstDraw(order), order, 900, ["s299", "not-in-the-map"]);
    expect(d.nodes.has("s299")).toBe(true);
    expect(d.nodes.has("not-in-the-map")).toBe(false);
    expect(d.nodes.size).toBe(201);
  });
});

describe("redraw", () => {
  it("keeps every screen drawn before that is still in the map, adds a batch of the new ones, and starts the edges again", () => {
    const before = frames(firstDraw(ids(300)), ids(300), 900).at(-1) as Drawn;
    // A filter leaves out every seventh screen and adds 150 that were never drawn.
    const order = [...ids(300).filter((_, i) => i % 7 !== 0), ...ids(150, "n")];
    const d = redraw(before, order);
    expect(d.edges).toBe(0);
    expect(d.nodes.size).toBe(257 + NODE_BATCH);
    for (const id of ids(300).filter((_, i) => i % 7 !== 0)) expect(d.nodes.has(id)).toBe(true);
    expect(d.nodes.has("s000")).toBe(false);
    expect(d.nodes.has("n099")).toBe(true);
    expect(d.nodes.has("n100")).toBe(false);
  });

  it("mid-draw keeps only what was drawn, and draws on from there", () => {
    const order = ids(300);
    const d = redraw(firstDraw(order), order);
    expect(d.nodes.size).toBe(200);
    expect(frames(d, order, 900).at(-1)?.nodes.size).toBe(300);
  });
});

describe("chunks", () => {
  it("splits in order into runs of size, the last one shorter", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 2)).toEqual([]);
  });
});
