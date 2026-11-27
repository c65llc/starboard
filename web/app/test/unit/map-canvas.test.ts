// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
// @vitest-environment jsdom

// MapCanvas draws a large map a batch per animation frame (src/map/draw.ts).
// These tests drive its frames by hand: requestAnimationFrame is a queue the
// test runs, one frame at a time.

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MapCanvas } from "../../src/components/MapCanvas.tsx";
import { EDGE_BATCH, NODE_BATCH } from "../../src/map/draw.ts";
import type { MapEdge, MapNode } from "../../src/map/graph.ts";
import type { MapLayout } from "../../src/map/layout.ts";

const id = (i: number) => `s${String(i).padStart(3, "0")}`;

/** layoutOf is a map of the screens numbered in ids, each with an edge to the next three, placed on a grid; shift moves every screen. */
function layoutOf(ids: number[], shift = 0): MapLayout {
  const nodes: MapNode[] = ids.map((i) => ({ id: id(i), title: `Screen ${i}`, area: "a", areaIndex: 0, presentation: "push", proposed: false }));
  const edges: MapEdge[] = [];
  for (const [k, i] of ids.entries()) {
    for (const d of [1, 2, 3]) {
      const to = ids[(k + d) % ids.length] as number;
      edges.push({ id: `${id(i)}>${id(to)}`, from: id(i), to: id(to), label: "go", kind: "push", twoWay: false, proposed: false });
    }
  }
  return {
    graph: { nodes, edges, links: [] },
    width: 4000,
    height: 4000,
    nodes: nodes.map((node, k) => ({ node, x: shift + (k % 20) * 180, y: Math.floor(k / 20) * 80, width: 150, height: 56 })),
    edges: edges.map((edge) => ({ edge, points: [[0, 0], [10, 10]] })),
    lanes: [{ key: "a", area: "a", named: true, x: 0, width: 4000 }],
  };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const all = layoutOf(range(300));

let frames: Map<number, FrameRequestCallback>;
let next = 0;
let renders: Record<string, number>;

beforeEach(() => {
  frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.set(++next, cb);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (n: number) => frames.delete(n));
  renders = {};
  (globalThis as unknown as { __starboardRenders?: Record<string, number> }).__starboardRenders = renders;
});

afterEach(() => {
  act(() => render(null, document.body));
  vi.unstubAllGlobals();
  delete (globalThis as unknown as { __starboardRenders?: Record<string, number> }).__starboardRenders;
});

interface Shown {
  layout: MapLayout;
  selected?: string | null;
  onlySelected?: boolean;
  focus?: { id: string } | null;
}

const selects: string[] = [];

function show({ layout, selected = null, onlySelected = false, focus = null }: Shown): void {
  act(() => {
    render(h(MapCanvas, { layout, selected, onlySelected, errors: new Map(), select: (s: string) => void selects.push(s), focus }), document.body);
  });
}

/** frame runs the animation frames queued now. */
function frame(): void {
  const now = [...frames.values()];
  frames.clear();
  act(() => {
    for (const cb of now) cb(performance.now());
  });
}

function finish(): number {
  let n = 0;
  while (frames.size > 0 && n < 100) {
    frame();
    n++;
  }
  return n;
}

const nodes = () => [...document.querySelectorAll<HTMLAnchorElement>("a.map-node")];
const node = (i: number) => document.querySelector<HTMLAnchorElement>(`a[data-id="${id(i)}"]`);
const edges = () => document.querySelectorAll("[data-edge]").length;

describe("MapCanvas's batches", () => {
  it("draws a batch of screens a frame, then the edges, and renders each screen and each batch of edges once", () => {
    show({ layout: all });
    expect(nodes()).toHaveLength(NODE_BATCH);
    expect(edges()).toBe(0);
    expect(finish()).toBe(2 + 900 / EDGE_BATCH);
    expect(nodes()).toHaveLength(300);
    expect(edges()).toBe(900);
    // Memoised: adding a batch renders that batch alone.
    expect(renders).toEqual({ node: 300, edges: 900 / EDGE_BATCH });
  });

  it("keeps exactly one screen in the tab order while it draws", () => {
    show({ layout: all });
    for (let f = 0; f < 4; f++) {
      expect(nodes().filter((a) => a.tabIndex === 0)).toHaveLength(1);
      frame();
    }
  });

  it("a new layout mid-draw keeps every screen drawn so far, the same element, and the focus in it", () => {
    show({ layout: all });
    frame();
    const el = node(150) as HTMLAnchorElement;
    act(() => el.focus());
    // Every seventh screen leaves the map; the rest move.
    const fewer = layoutOf(
      range(300).filter((i) => i % 7 !== 0),
      40,
    );
    show({ layout: fewer });
    expect(node(150)).toBe(el);
    expect(document.activeElement).toBe(el);
    expect(el.style.left).not.toBe("");
    expect(nodes().length).toBeGreaterThanOrEqual(200 - 29);
    expect(edges()).toBe(0);
    finish();
    expect(nodes()).toHaveLength(fewer.nodes.length);
    expect(edges()).toBe(fewer.edges.length);
    expect(document.activeElement).toBe(el);
  });

  it("a new layout of a drawn map keeps a late screen's focus", () => {
    show({ layout: all });
    finish();
    const el = node(250) as HTMLAnchorElement;
    act(() => el.focus());
    show({ layout: layoutOf(range(300).filter((i) => i % 7 !== 0), 40) });
    expect(document.activeElement).toBe(el);
    expect(nodes()).toHaveLength(257);
  });

  it("stops drawing when it is unmounted mid-draw", () => {
    show({ layout: all });
    frame();
    expect(frames.size).toBe(1);
    act(() => render(null, document.body));
    expect(frames.size).toBe(0);
    expect(nodes()).toHaveLength(0);
  });

  it("draws a screen selected while batches are pending at once, with its edges, and draws the rest on", () => {
    show({ layout: all });
    expect(node(250)).toBeNull();
    show({ layout: all, selected: id(250) });
    expect(node(250)).not.toBeNull();
    expect(node(250)?.getAttribute("aria-current")).toBe("true");
    expect(document.querySelectorAll('[data-edge][data-on="true"]')).toHaveLength(6);
    finish();
    expect(nodes()).toHaveLength(300);
    expect(document.querySelectorAll(`a[data-id="${id(250)}"]`)).toHaveLength(1);
    expect(edges()).toBe(900);
    expect(document.querySelectorAll('[data-edge][data-on="true"]')).toHaveLength(6);
  });

  it("focuses a screen it is asked to before that screen's batch", () => {
    show({ layout: all });
    expect(node(299)).toBeNull();
    show({ layout: all, focus: { id: id(299) } });
    expect(document.activeElement).toBe(node(299));
  });

  it("moves focus with End to the last screen before its batch is drawn", () => {
    show({ layout: all });
    const first = node(0) as HTMLAnchorElement;
    act(() => first.focus());
    act(() => {
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(node(299));
  });
});
