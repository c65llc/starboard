// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import type { Edge, Flow, Model, NavItem, Region, Screen } from "@c65llc/starboard-core";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, it } from "vitest";

import { buildMap, flowsThrough, mapPlatforms } from "../../src/map/graph.ts";
import { backEdges, layoutFailure, layoutMap } from "../../src/map/layout.ts";
import { neighbour } from "../../src/map/nav.ts";
import { REF_PATTERN } from "./ref-pattern.ts";

const elk = new ELK();

function region(name: string, path: string, more: Partial<Region> = {}): Region {
  return {
    name,
    kind: "text",
    label: "",
    to: "",
    requires: "",
    status: "",
    platformNote: "",
    width: "",
    children: [],
    item: null,
    empty: null,
    items: [],
    path,
    line: 1,
    ...more,
  };
}

const item = (to: string, path: string, status = ""): NavItem => ({ label: to, to, requires: "", status, path, line: 1 });
const edge = (from: string, to: string, regionName: string, path: string): Edge => ({ from, to, region: regionName, path, line: 1 });

function screen(id: string, area: string, more: Partial<Screen> = {}): Screen {
  return {
    id,
    title: id,
    area,
    purpose: "",
    presentation: "push",
    status: { ios: "shipped", web: "shipped" },
    platforms: ["ios", "web"],
    formFactors: ["phone"],
    layout: [],
    layouts: {},
    edges: [],
    files: {},
    line: 1,
    ...more,
  };
}

function model(screens: Screen[], flows: Flow[] = []): Model {
  return {
    screens,
    flows,
    areas: ["home", "trip"],
    idPattern: "",
    refPattern: REF_PATTERN,
    flowIdPattern: "",
    flowKeys: [],
    kinds: [],
    presentations: [],
  };
}

/** A small app: home.list → trip.a (card), trip.a ⇄ trip.b (tabs), trip.b → trip.new (proposed, web only). */
function app(): Model {
  return model([
    screen("home.list", "home", {
      presentation: "root",
      layout: [region("trips", "layout[0]", { kind: "list", item: region("", "layout[0].item", { kind: "card", to: "trip.a" }) })],
      edges: [edge("home.list", "trip.a", "trips", "layout[0].item")],
    }),
    screen("trip.a", "trip", {
      presentation: "push",
      layout: [region("tabs", "layout[0]", { kind: "tabs", items: [item("trip.a", "layout[0].items[0]"), item("trip.b", "layout[0].items[1]")] })],
      edges: [edge("trip.a", "trip.a", "tabs", "layout[0].items[0]"), edge("trip.a", "trip.b", "tabs", "layout[0].items[1]")],
    }),
    screen("trip.b", "trip", {
      presentation: "push",
      layout: [
        region("tabs", "layout[0]", { kind: "tabs", items: [item("trip.a", "layout[0].items[0]")] }),
        region("add", "layout[1]", { kind: "primary-action", to: "trip.new", status: "proposed" }),
        region("help", "layout[2]", { kind: "action", to: "nowhere.at-all" }),
      ],
      edges: [
        edge("trip.b", "nowhere.at-all", "help", "layout[2]"),
        edge("trip.b", "trip.a", "tabs", "layout[0].items[0]"),
        edge("trip.b", "trip.new", "add", "layout[1]"),
      ],
    }),
    screen("trip.new", "trip", { presentation: "sheet", status: { web: "proposed" }, platforms: ["web"] }),
  ]);
}

const ALL = { platform: "", showProposed: true };

describe("buildMap", () => {
  it("draws every to: between registered screens once, with tabs as one two-way edge labelled by region", () => {
    const g = buildMap(app(), ALL);
    expect(g.nodes.map((n) => n.id)).toEqual(["home.list", "trip.a", "trip.b", "trip.new"]);
    expect(g.edges.map((e) => [e.from, e.to, e.label, e.kind, e.twoWay, e.proposed])).toEqual([
      ["home.list", "trip.a", "trips", "push", false, false],
      ["trip.a", "trip.b", "tabs", "tabs", true, false],
      ["trip.b", "trip.new", "add", "sheet", false, true],
    ]);
  });

  it("lists every to: in the text alternative, self links and unregistered targets included", () => {
    const g = buildMap(app(), ALL);
    expect(g.links.map((l) => `${l.from} ${l.region} ${l.to} ${l.kind} ${l.registered ? "" : "unregistered"}`.trim())).toEqual([
      "home.list trips trip.a push",
      "trip.a tabs trip.a tabs",
      "trip.a tabs trip.b tabs",
      "trip.b help nowhere.at-all link unregistered",
      "trip.b tabs trip.a tabs",
      "trip.b add trip.new sheet",
    ]);
  });

  it("marks proposed screens per platform, and hides them and their links when proposed are not shown", () => {
    expect(buildMap(app(), ALL).nodes.find((n) => n.id === "trip.new")?.proposed).toBe(true);
    const shipped = buildMap(app(), { platform: "", showProposed: false });
    expect(shipped.nodes.map((n) => n.id)).toEqual(["home.list", "trip.a", "trip.b"]);
    expect(shipped.edges.some((e) => e.proposed)).toBe(false);
    expect(shipped.links.some((l) => l.to === "trip.new")).toBe(false);
  });

  it("limits nodes and links to the chosen platform", () => {
    const ios = buildMap(app(), { platform: "ios", showProposed: true });
    expect(ios.nodes.map((n) => n.id)).toEqual(["home.list", "trip.a", "trip.b"]);
    expect(ios.edges.map((e) => e.to)).toEqual(["trip.a", "trip.b"]);
    const m = app();
    const a = m.screens[1];
    if (a) a.status = { ios: "proposed", web: "shipped" };
    expect(buildMap(m, { platform: "ios", showProposed: true }).nodes.find((n) => n.id === "trip.a")?.proposed).toBe(true);
    expect(buildMap(m, ALL).nodes.find((n) => n.id === "trip.a")?.proposed).toBe(false);
  });

  it("orders nodes by area in config order, then ID", () => {
    const m = app();
    m.areas = ["trip", "home"];
    expect(buildMap(m, ALL).nodes.map((n) => `${n.areaIndex}:${n.id}`)).toEqual(["0:trip.a", "0:trip.b", "0:trip.new", "1:home.list"]);
  });

  it("offers the platforms the screens are on, in config order", () => {
    expect(mapPlatforms(app())).toEqual(["ios", "web"]);
  });
});

describe("flowsThrough", () => {
  it("lists the flows whose steps reference the screen, at the first such step", () => {
    const step = (number: number, text: string, screenId: string) => ({ number, text, screen: screenId, region: "", branches: [], line: 1 });
    const flows = [
      { id: "f1", title: "One", steps: [step(1, "Open @home.list.", "home.list"), step(2, "Tap @trip.a#tabs to see @trip.b.", "trip.a")] },
      { id: "f2", title: "Two", steps: [step(1, "Open @trip.b.", "trip.b")] },
    ] as unknown as Flow[];
    const m = model(app().screens, flows);
    expect(flowsThrough(m, "trip.b").map((f) => [f.flow.id, f.step])).toEqual([
      ["f1", 2],
      ["f2", 1],
    ]);
    expect(flowsThrough(m, "trip.new")).toEqual([]);
  });
});

describe("layoutMap", () => {
  it("deterministic layout: the same model gives the same coordinates, whatever order it lists screens in", async () => {
    const first = await layoutMap(app(), ALL, elk);
    const again = await layoutMap(app(), ALL, elk);
    const shuffled = app();
    shuffled.screens.reverse();
    for (const s of shuffled.screens) s.edges.reverse();
    const third = await layoutMap(shuffled, ALL, elk);
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
    expect(JSON.stringify(third)).toBe(JSON.stringify(first));
  });

  it("places every node, routes every edge and puts areas left to right in config order", async () => {
    const l = await layoutMap(app(), ALL, elk);
    expect(l.nodes.map((n) => n.node.id)).toEqual(["home.list", "trip.a", "trip.b", "trip.new"]);
    expect(l.edges).toHaveLength(3);
    for (const e of l.edges) expect(e.points.length).toBeGreaterThanOrEqual(2);
    expect(l.lanes.map((x) => x.area)).toEqual(["home", "trip"]);
    const [home, trip] = l.lanes;
    expect(home && trip && home.x + home.width <= trip.x).toBe(true);
    for (const n of l.nodes) {
      expect(n.x + n.width).toBeLessThanOrEqual(l.width);
      expect(n.y + n.height).toBeLessThanOrEqual(l.height);
    }
  });

  it("gives screens with no area their own lane, apart from an area named like it", async () => {
    const m = model([screen("a.one", ""), screen("b.two", "no area"), screen("c.three", "(no area)")]);
    m.areas = ["no area", "(no area)"];
    const l = await layoutMap(m, ALL, elk);
    expect(l.lanes.map((x) => [x.key, x.area])).toEqual([
      ["no area", "no area"],
      ["(no area)", "(no area)"],
      ["", "(no area)"],
    ]);
  });

  /**
   * The smallest graph from the example that crashed ELK ("Cannot read
   * properties of null (reading 'a')"): two-way links inside the auth,
   * activity and sharing areas, joined by one-way links across areas.
   */
  function cycles(): Model {
    const links: [string, string][] = [
      ["activity.detail", "activity.invite"],
      ["activity.invite", "activity.detail"],
      ["auth.sign-in", "auth.sign-up"],
      ["auth.sign-up", "auth.sign-in"],
      ["auth.sign-up", "home.trips"],
      ["home.trips", "trip.timeline"],
      ["sharing.invite", "sharing.roster"],
      ["sharing.roster", "sharing.invite"],
      ["trip.day", "activity.detail"],
      ["trip.info", "sharing.roster"],
      ["trip.timeline", "activity.detail"],
      ["trip.timeline", "trip.day"],
      ["trip.timeline", "trip.info"],
    ];
    const ids = [...new Set(links.flat())].sort();
    const m = model(
      ids.map((id) =>
        screen(id, id.split(".")[0] ?? "", {
          edges: links.filter(([from]) => from === id).map(([from, to], i) => edge(from, to, `r${i}`, `layout[${i}]`)),
        }),
      ),
    );
    m.areas = ["auth", "home", "trip", "activity", "sharing"];
    return m;
  }

  it("reverses for ELK only edges into an earlier area and, inside one, the edge that closes a cycle, reading from the area's entrance", () => {
    // home.list enters trip at trip.z; trip.z → trip.a → trip.z is a cycle,
    // so the edge back to the entrance is the one reversed, not trip.z → trip.a.
    const m = model([
      screen("home.list", "home", { edges: [edge("home.list", "trip.z", "go", "layout[0]")] }),
      screen("trip.a", "trip", { edges: [edge("trip.a", "trip.z", "back", "layout[0]"), edge("trip.a", "home.list", "home", "layout[1]")] }),
      screen("trip.z", "trip", { edges: [edge("trip.z", "trip.a", "on", "layout[0]")] }),
    ]);
    expect([...backEdges(buildMap(m, ALL))].sort()).toEqual(["trip.a->home.list@layout[1]", "trip.a->trip.z@layout[0]"]);
  });

  it("lays out screens in one area that link to each other both ways", async () => {
    const l = await layoutMap(cycles(), ALL, elk);
    expect(l.nodes).toHaveLength(10);
    expect(l.edges).toHaveLength(13);
    expect(l.lanes.map((x) => x.area)).toEqual(["auth", "home", "trip", "activity", "sharing"]);
  });

  /** A cycle-heavy registry: cycles inside and across areas, self links, tabs, an area the config lacks. */
  function tangled(): Model {
    const areas = ["a", "b", "c", "d"];
    const screens: Screen[] = [];
    for (let i = 0; i < 40; i++) {
      const area = i === 13 ? "zz" : (areas[i % 4] ?? "");
      const id = `${area}.s${String(i).padStart(2, "0")}`;
      const targets = [(i + 1) % 40, (i + 4) % 40, (i + 39) % 40, (i * 7 + 3) % 40, i].map((j) => `${j === 13 ? "zz" : (areas[j % 4] ?? "")}.s${String(j).padStart(2, "0")}`);
      screens.push(
        screen(id, area, {
          layout: [region("tabs", "layout[0]", { kind: "tabs", items: [item(targets[0] ?? "", "layout[0].items[0]"), item(targets[2] ?? "", "layout[0].items[1]")] })],
          edges: [
            edge(id, targets[0] ?? "", "tabs", "layout[0].items[0]"),
            edge(id, targets[2] ?? "", "tabs", "layout[0].items[1]"),
            ...targets.slice(1).map((t, k) => edge(id, t, `r${k}`, `layout[${k + 1}]`)),
          ],
        }),
      );
    }
    const m = model(screens);
    m.areas = areas;
    return m;
  }

  it("lays out any registry: cycles within and across areas, self links and tabs, the same way every time", async () => {
    const first = await layoutMap(tangled(), ALL, elk);
    expect(first.nodes).toHaveLength(40);
    expect(first.edges).toHaveLength(first.graph.edges.length);
    const again = await layoutMap(tangled(), ALL, elk);
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
  });

  it("gives ELK no cycle to break, and no edge into an earlier area", async () => {
    for (const m of [cycles(), tangled(), app()]) {
      let given: ElkNode | undefined;
      await layoutMap(m, ALL, { layout: async (g) => ((given = structuredClone(g)), elk.layout(g)) });
      const part = new Map((given?.children ?? []).map((c) => [c.id, Number(c.layoutOptions?.["elk.partitioning.partition"])]));
      const out = new Map<string, string[]>();
      for (const e of given?.edges ?? []) {
        const [s, t] = [e.sources[0] ?? "", e.targets[0] ?? ""];
        expect(part.get(s) ?? 0).toBeLessThanOrEqual(part.get(t) ?? 0);
        out.set(s, [...(out.get(s) ?? []), t]);
      }
      // Kahn's algorithm consumes every node only when there is no cycle.
      const indegree = new Map([...part.keys()].map((id) => [id, 0]));
      for (const ts of out.values()) for (const t of ts) indegree.set(t, (indegree.get(t) ?? 0) + 1);
      const ready = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);
      let seen = 0;
      while (ready.length) {
        const id = ready.pop() ?? "";
        seen++;
        for (const t of out.get(id) ?? []) {
          const d = (indegree.get(t) ?? 0) - 1;
          indegree.set(t, d);
          if (d === 0) ready.push(t);
        }
      }
      expect(seen).toBe(part.size);
    }
  });

  it("says what to do when ELK still fails: the table has the links, report it with screens.yaml", () => {
    const note = layoutFailure("Cannot read properties of null (reading 'a')");
    expect(note).toContain("Cannot read properties of null (reading 'a')");
    expect(note).toContain("Every link as a table");
    expect(note).toMatch(/report this as a Starboard bug.*screens\.yaml/);
  });

  it("lays out a 300-screen app", async () => {
    const screens: Screen[] = [];
    for (let i = 0; i < 300; i++) {
      const id = `${i % 2 ? "trip" : "home"}.s${String(i).padStart(3, "0")}`;
      const to = [(i * 7 + 3) % 300, (i * 13 + 5) % 300].map((j) => `${j % 2 ? "trip" : "home"}.s${String(j).padStart(3, "0")}`);
      screens.push(screen(id, i % 2 ? "trip" : "home", { edges: to.map((t, k) => edge(id, t, `r${k}`, `layout[${k}]`)) }));
    }
    const start = performance.now();
    const l = await layoutMap(model(screens), ALL, elk);
    const ms = performance.now() - start;
    console.log(`layoutMap: 300 screens, ${l.edges.length} edges in ${Math.round(ms)} ms`);
    expect(l.nodes).toHaveLength(300);
  }, 60_000);
});

describe("neighbour", () => {
  const at = (id: string, x: number, y: number) => ({ node: { id }, x, y, width: 100, height: 50 });
  const nodes = [at("a", 0, 0), at("b", 200, 0), at("c", 0, 100), at("d", 200, 120), at("e", 400, 300)];
  it("moves to the nearest node in the arrow's direction", () => {
    expect(neighbour(nodes, "a", "ArrowRight")).toBe("b");
    expect(neighbour(nodes, "a", "ArrowDown")).toBe("c");
    expect(neighbour(nodes, "d", "ArrowUp")).toBe("b");
    expect(neighbour(nodes, "d", "ArrowLeft")).toBe("c");
    expect(neighbour(nodes, "d", "ArrowRight")).toBe("e");
  });
  it("stays put at an edge of the map, and ignores other keys", () => {
    expect(neighbour(nodes, "a", "ArrowLeft")).toBeUndefined();
    expect(neighbour(nodes, "a", "ArrowUp")).toBeUndefined();
    expect(neighbour(nodes, "a", "Enter")).toBeUndefined();
  });
});
