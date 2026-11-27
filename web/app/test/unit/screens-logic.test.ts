// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import type { Diagnostic, Flow, Region, Screen } from "@c65llc/starboard-core";
import { describe, expect, it } from "vitest";

import {
  findRegion,
  fixable,
  flowsUsing,
  layoutValue,
  listRows,
  matches,
  moveTarget,
  newScreenProblem,
  navigatesTo,
  regionName,
  siblingPath,
  targetOf,
  treeRows,
  uniqueName,
  visibleRange,
} from "../../src/screens/logic.ts";

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

function screen(id: string, more: Partial<Screen> = {}): Screen {
  return {
    id,
    title: id,
    area: id.split(".")[0] ?? "",
    purpose: "",
    presentation: "push",
    status: { ios: "shipped" },
    platforms: ["ios"],
    formFactors: ["phone"],
    layout: [],
    layouts: {},
    edges: [],
    files: {},
    line: 1,
    ...more,
  };
}

const timelineLayout: Region[] = [
  region("app-bar", "layout[0]", {
    kind: "bar",
    children: [region("title", "layout[0].children[0]"), region("members", "layout[0].children[1]")],
  }),
  region("days", "layout[1]", {
    kind: "list",
    item: region("", "layout[1].item", { kind: "card", label: "Activity", to: "activity.detail" }),
    empty: { label: "No activities yet" },
  }),
  region("add-activity", "layout[2]", { kind: "primary-action", label: "Add", to: "activity.add" }),
  region("tabs", "layout[3]", {
    kind: "tabs",
    items: [{ label: "Timeline", to: "trip.timeline", requires: "", status: "", path: "layout[3].items[0]", line: 1 }],
  }),
];

/** at is xs[i], which the test expects to exist. */
function at<T>(xs: T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`no element ${i}`);
  return x;
}

describe("the screen list", () => {
  const screens = [
    screen("trip.timeline", { title: "Timeline" }),
    screen("activity.add", { status: { ios: "shipped", android: "proposed" } }),
    screen("trip.map"),
  ];

  it("matches words in the ID or title, ignoring case, and status:<value> on any platform", () => {
    expect(matches(at(screens, 0), "TIMEline")).toBe(true);
    expect(matches(at(screens, 0), "trip. line")).toBe(true);
    expect(matches(at(screens, 0), "trip. map")).toBe(false);
    expect(matches(at(screens, 1), "status:proposed")).toBe(true);
    expect(matches(at(screens, 0), "status:proposed")).toBe(false);
    expect(matches(at(screens, 0), "  ")).toBe(true);
  });

  it("groups by area in first-seen order", () => {
    const rows = listRows(screens, "");
    expect(rows.map((r) => (r.kind === "area" ? `#${r.area}` : r.screen.id))).toEqual([
      "#trip",
      "trip.timeline",
      "trip.map",
      "#activity",
      "activity.add",
    ]);
    expect(listRows(screens, "nothing")).toEqual([]);
  });

  it("windows the rows in view, with overscan, clamped to the list", () => {
    expect(visibleRange(0, 300, 30, 1000, 5)).toEqual({ first: 0, last: 15 });
    expect(visibleRange(3000, 300, 30, 1000, 5)).toEqual({ first: 95, last: 115 });
    expect(visibleRange(29_900, 300, 30, 1000, 5)).toEqual({ first: 991, last: 1000 });
    expect(visibleRange(0, 300, 30, 0)).toEqual({ first: 0, last: 0 });
  });
});

describe("the region tree", () => {
  it("flattens depth first, children then a list's item", () => {
    const rows = treeRows(timelineLayout);
    expect(rows.map((r) => `${r.depth}:${regionName(r.region)}`)).toEqual([
      "0:app-bar",
      "1:title",
      "1:members",
      "0:days",
      "1:item",
      "0:add-activity",
      "0:tabs",
    ]);
    expect(rows[2]).toMatchObject({ parent: 0, index: 1, count: 2, movable: true });
    expect(rows[4]).toMatchObject({ parent: 3, movable: false });
  });

  it("moves within its list, never past either end, and never a list's item", () => {
    const rows = treeRows(timelineLayout);
    expect(moveTarget(at(rows, 5), -1)).toEqual({ index: 1, path: "layout[1]" });
    expect(moveTarget(at(rows, 5), 1)).toEqual({ index: 3, path: "layout[3]" });
    expect(moveTarget(at(rows, 0), -1)).toBeNull();
    expect(moveTarget(at(rows, 6), 1)).toBeNull();
    expect(moveTarget(at(rows, 2), -1)).toEqual({ index: 0, path: "layout[0].children[0]" });
    expect(moveTarget(at(rows, 4), -1)).toBeNull();
    expect(siblingPath("layouts.web-wide[0].children[3]", 1)).toBe("layouts.web-wide[0].children[1]");
  });

  it("finds a region by path, and names new regions uniquely", () => {
    expect(findRegion(timelineLayout, "layout[1].item")?.label).toBe("Activity");
    expect(findRegion(timelineLayout, "layout[9]")).toBeNull();
    expect(uniqueName([timelineLayout], "region")).toBe("region");
    expect(uniqueName([timelineLayout, [region("title-2", "x")]], "title")).toBe("title-3");
  });

  it("writes a layout back as the mappings screens.yaml holds", () => {
    const wide = [region("side", "layouts.w[0]", { kind: "nav", width: "240" }), region("main", "layouts.w[1]", { width: "1/3" })];
    expect(layoutValue(timelineLayout)).toEqual([
      {
        region: "app-bar",
        kind: "bar",
        children: [
          { region: "title", kind: "text" },
          { region: "members", kind: "text" },
        ],
      },
      { region: "days", kind: "list", item: { kind: "card", label: "Activity", to: "activity.detail" }, empty: { label: "No activities yet" } },
      { region: "add-activity", kind: "primary-action", label: "Add", to: "activity.add" },
      { region: "tabs", kind: "tabs", items: [{ label: "Timeline", to: "trip.timeline" }] },
    ]);
    expect(layoutValue(wide)).toEqual([
      { region: "side", kind: "nav", width: 240 },
      { region: "main", kind: "text", width: "1/3" },
    ]);
  });
});

describe("references", () => {
  it("lists the flows on a screen and where it navigates", () => {
    const flows: Flow[] = [
      { id: "a", file: "f/a.md", title: "A", status: "shipped", entry: "trip.timeline", frontMatterId: "a", actors: [], platforms: [], steps: [] },
      {
        id: "b",
        file: "f/b.md",
        title: "B",
        status: "shipped",
        entry: "x.y",
        frontMatterId: "b",
        actors: [],
        platforms: [],
        steps: [{ number: 1, text: "", screen: "trip.timeline", region: "", branches: [], line: 1 }],
      },
      { id: "c", file: "f/c.md", title: "C", status: "shipped", entry: "x.y", frontMatterId: "c", actors: [], platforms: [], steps: [] },
    ];
    expect(flowsUsing(flows, "trip.timeline").map((f) => f.id)).toEqual(["a", "b"]);
    const edge = (to: string) => ({ from: "s.a", to, region: "r", path: "layout[0]", line: 1 });
    expect(navigatesTo(screen("s.a", { edges: [edge("x.b"), edge("x.c"), edge("x.b")] }))).toEqual(["x.b", "x.c"]);
  });
});

describe("lint findings", () => {
  const screens = [
    screen("trip", { layout: [] }),
    screen("trip.timeline", {
      layout: timelineLayout,
      layouts: { "web-wide": [region("shell", "layouts.web-wide[0]", { children: [region("side", "layouts.web-wide[0].children[0]")] })] },
    }),
  ];
  const flows: Flow[] = [
    { id: "add", file: "docs/flows/flows/add.md", title: "Add", status: "shipped", entry: "", frontMatterId: "add", actors: [], platforms: [], steps: [] },
  ];
  const d = (path: string, file = "docs/flows/screens.yaml", fix = false): Diagnostic => ({
    rule: "r",
    severity: "warn",
    file,
    path,
    message: "m",
    ...(fix ? { fix: { description: "run starboard fmt" } } : {}),
  });

  it("selects the deepest region a registry path names, under the longest matching ID", () => {
    expect(targetOf(d("screens.trip.timeline.layout[2].label"), screens, flows)).toEqual({
      kind: "screen",
      screen: "trip.timeline",
      region: "layout[2]",
    });
    expect(targetOf(d("screens.trip.timeline.layout[0].children[1]"), screens, flows)).toEqual({
      kind: "screen",
      screen: "trip.timeline",
      region: "layout[0].children[1]",
    });
    expect(targetOf(d("screens.trip.timeline.layout[3].items[0].to"), screens, flows)).toMatchObject({ region: "layout[3]" });
    expect(targetOf(d("screens.trip.timeline.layouts.web-wide[0].children[0].width"), screens, flows)).toEqual({
      kind: "screen",
      screen: "trip.timeline",
      region: "layouts.web-wide[0].children[0]",
      formFactor: "web-wide",
    });
    expect(targetOf(d("screens.trip.timeline.purpose"), screens, flows)).toEqual({ kind: "screen", screen: "trip.timeline" });
    expect(targetOf(d("screens.trip"), screens, flows)).toEqual({ kind: "screen", screen: "trip" });
  });

  it("opens a flow file's flow, and points nowhere otherwise", () => {
    expect(targetOf(d("", "docs/flows/flows/add.md"), screens, flows)).toEqual({ kind: "flow", flow: "add" });
    expect(targetOf(d("", "docs/flows/generated/screens.md"), screens, flows)).toEqual({ kind: "none" });
    expect(targetOf(d("screens.gone.layout[0]"), screens, flows)).toEqual({ kind: "none" });
  });

  it("opens the Source tab at a registry finding no screen holds, when told which file the registry is", () => {
    const reg = "docs/flows/screens.yaml";
    expect(targetOf({ ...d(""), line: 169 }, [], flows, reg)).toEqual({ kind: "source", line: 169 });
    expect(targetOf(d("screens.gone.layout[0]"), screens, flows, reg)).toEqual({ kind: "source" });
    expect(targetOf(d("screens.trip.timeline.layout[2]"), screens, flows, reg)).toMatchObject({ kind: "screen" });
    expect(targetOf(d("", "docs/flows/generated/screens.md"), screens, flows, reg)).toEqual({ kind: "none" });
  });

  it("counts what core.fix clears", () => {
    expect(fixable([d("", "a", true), d("", "b"), d("", "c", true)])).toBe(2);
  });
});

describe("a new screen", () => {
  const pattern = String.raw`^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`;
  const screens = [screen("trip.timeline")];

  it("needs an ID of the registry's form that no screen has, and a title", () => {
    expect(newScreenProblem({ id: "trip.map", title: "Map" }, screens, pattern)).toBeNull();
    expect(newScreenProblem({ id: "", title: "Map" }, screens, pattern)).toMatch(/Enter an ID/);
    expect(newScreenProblem({ id: "map", title: "Map" }, screens, pattern)).toMatch(/area\.name/);
    expect(newScreenProblem({ id: "Trip.Map", title: "Map" }, screens, pattern)).toMatch(/area\.name/);
    expect(newScreenProblem({ id: "trip.timeline", title: "T" }, screens, pattern)).toMatch(/already/);
    expect(newScreenProblem({ id: "trip.map", title: " " }, screens, pattern)).toMatch(/title/);
  });
});
