// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import type { Model, Screen } from "@c65llc/starboard-core";
import { describe, expect, it } from "vitest";

import { buildMap, neighbourhood, type MapFilters } from "../../src/map/graph.ts";
import { REF_PATTERN } from "./ref-pattern.ts";

function screen(id: string, to: string[] = [], proposed = false): Screen {
  const state = proposed ? "proposed" : "shipped";
  return {
    id,
    title: id,
    area: "x",
    purpose: "",
    presentation: "push",
    status: { web: state },
    platforms: ["web"],
    formFactors: ["phone"],
    layout: [],
    layouts: {},
    edges: to.map((t, i) => ({ from: id, to: t, region: "r", path: `layout[${i}]`, line: 1 })),
    files: {},
    line: 1,
  };
}

/** a→b→c→d, e→b, c→a (cycle), f isolated, g proposed with b→g. */
function app(): Model {
  return {
    screens: [screen("a", ["b"]), screen("b", ["c", "g", "nowhere"]), screen("c", ["d", "a"]), screen("d", ["gone"]), screen("e", ["b"]), screen("f"), screen("g", [], true)],
    flows: [],
    areas: ["x"],
    idPattern: "",
    refPattern: REF_PATTERN,
    flowIdPattern: "",
    flowKeys: [],
    kinds: [],
    presentations: [],
  };
}

const ids = (m: Model, f: Partial<MapFilters>) =>
  buildMap(m, { platform: "", showProposed: true, ...f }).nodes.map((n) => n.id).sort();

describe("buildMap focus", () => {
  it("keeps the screens one link away, in either direction", () => {
    expect(ids(app(), { focus: { id: "b", steps: 1 } })).toEqual(["a", "b", "c", "e", "g"]);
    expect(ids(app(), { focus: { id: "b", steps: 1 }, showProposed: false })).toEqual(["a", "b", "c", "e"]);
  });

  it("two steps reaches further", () => {
    expect(ids(app(), { focus: { id: "b", steps: 2 } })).toEqual(["a", "b", "c", "d", "e", "g"]);
  });

  it("an isolated screen is alone", () => {
    expect(ids(app(), { focus: { id: "f", steps: 2 } })).toEqual(["f"]);
  });

  it("ignores a focus the filters hide", () => {
    const all = ids(app(), { showProposed: false });
    expect(all).not.toContain("g");
    expect(ids(app(), { showProposed: false, focus: { id: "g", steps: 1 } })).toEqual(all);
  });

  it("keeps exactly the edges and links between kept screens", () => {
    const g = buildMap(app(), { platform: "", showProposed: true, focus: { id: "b", steps: 1 } });
    expect(g.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(["a>b", "b>c", "b>g", "c>a", "e>b"]);
    expect(g.links.every((l) => g.nodes.some((n) => n.id === l.from))).toBe(true);
    const links = g.links.map((l) => `${l.from}>${l.to}`);
    expect(links).not.toContain("c>d");
    expect(links).toContain("b>nowhere");
    expect(links).not.toContain("d>gone");
  });
});

describe("neighbourhood", () => {
  it("returns the ids within steps, itself included, and nothing for an unknown id", () => {
    const g = buildMap(app(), { platform: "", showProposed: true });
    expect([...neighbourhood(g, "d", 1)].sort()).toEqual(["c", "d"]);
    expect([...neighbourhood(g, "d", 2)].sort()).toEqual(["a", "b", "c", "d"]);
    expect(neighbourhood(g, "zzz", 2).size).toBe(0);
  });
});
