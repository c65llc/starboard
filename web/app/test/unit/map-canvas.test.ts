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
  selects = [];
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
  onFocused?: () => void;
}

let selects: [string, string][] = [];

function show({ layout, selected = null, onlySelected = false, focus = null, onFocused = () => {} }: Shown): void {
  act(() => {
    render(
      h(MapCanvas, { layout, selected, onlySelected, errors: new Map(), select: (s: string, by: string) => void selects.push([s, by]), focus, onFocused }),
      document.body,
    );
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

  it("renders again only the screens a new selection changes", () => {
    show({ layout: all });
    finish();
    renders = {};
    (globalThis as unknown as { __starboardRenders?: Record<string, number> }).__starboardRenders = renders;
    show({ layout: all, selected: id(150) });
    // s150 (selected, now the tab stop), the three each way it links to, and s000, no longer the tab stop.
    expect(renders["node"]).toBe(8);
    // Every batch of edges leaves out the selected screen's own, drawn over the rest.
    expect(renders["edges"]).toBe(900 / EDGE_BATCH);
  });

  it("says when it has focused the screen asked for, and a new canvas does not take focus again", () => {
    let told = 0;
    const request = { id: id(299) };
    show({ layout: all, focus: request, onFocused: () => told++ });
    expect(document.activeElement).toBe(node(299));
    expect(told).toBe(1);
    // The parent clears the request once told (AppMap); a canvas made again, as when a filter empties the map and then fills it, leaves focus alone.
    act(() => render(null, document.body));
    const outside = document.createElement("button");
    document.body.after(outside);
    outside.focus();
    show({ layout: all, focus: null, onFocused: () => told++ });
    expect(document.activeElement).toBe(outside);
    expect(told).toBe(1);
    outside.remove();
  });
});

describe("MapCanvas's selection reasons", () => {
  const key = (el: Element, k: string) => {
    const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
    act(() => {
      el.dispatchEvent(e);
    });
    return e;
  };

  it("selects a screen focus arrives on by Tab as a tab", () => {
    show({ layout: all });
    act(() => (node(0) as HTMLAnchorElement).focus());
    expect(selects).toEqual([[id(0), "tab"]]);
  });

  it("selects the screen an arrow key reaches as a move", () => {
    show({ layout: all });
    act(() => (node(0) as HTMLAnchorElement).focus());
    selects = [];
    key(node(0) as HTMLAnchorElement, "ArrowRight");
    expect(document.activeElement).toBe(node(1));
    expect(selects).toEqual([[id(1), "move"]]);
  });

  it("selects the last screen End reaches before its batch as a move", () => {
    show({ layout: all });
    act(() => (node(0) as HTMLAnchorElement).focus());
    selects = [];
    key(node(0) as HTMLAnchorElement, "End");
    expect(document.activeElement).toBe(node(299));
    expect(selects).toEqual([[id(299), "move"]]);
  });

  it("picks the focused screen with Space, and keeps the page from scrolling", () => {
    show({ layout: all });
    act(() => (node(3) as HTMLAnchorElement).focus());
    selects = [];
    const e = key(node(3) as HTMLAnchorElement, " ");
    expect(e.defaultPrevented).toBe(true);
    expect(selects).toEqual([[id(3), "pick"]]);
  });

  it("picks a screen with a plain click", () => {
    show({ layout: all });
    act(() => {
      (node(4) as HTMLAnchorElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, button: 0 }));
    });
    expect(selects).toContainEqual([id(4), "pick"]);
  });
});
