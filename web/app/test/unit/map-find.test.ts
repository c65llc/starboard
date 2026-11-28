// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { describe, expect, it } from "vitest";

import { countScreens, findScreens, said } from "../../src/map/find.ts";
import type { MapNode } from "../../src/map/graph.ts";

const node = (id: string, title: string): MapNode => ({
  id,
  title,
  area: "",
  areaIndex: 0,
  presentation: "",
  proposed: false,
});

const nodes = [
  node("home.dashboard", "Home"),
  node("trip.list", "Trips"),
  node("trip.timeline", "Timeline"),
  node("activity.editor", "Edit trip activity"),
];

const ids = (found: MapNode[]) => found.map((n) => n.id);

describe("findScreens", () => {
  it("ranks an ID prefix before a title match, each in map order", () => {
    expect(ids(findScreens(nodes, "trip"))).toEqual(["trip.list", "trip.timeline", "activity.editor"]);
  });

  it("is case-insensitive and ranks an ID match before a title match", () => {
    expect(ids(findScreens(nodes, "TIME"))).toEqual(["trip.timeline"]);
  });

  it("ranks ID-contains between ID prefix and title", () => {
    const more = [node("a.b", "tim"), node("x.timer", "Z"), node("time.a", "Y")];
    expect(ids(findScreens(more, "tim"))).toEqual(["time.a", "x.timer", "a.b"]);
  });

  it("returns nothing for an empty or whitespace query", () => {
    expect(findScreens(nodes, "")).toEqual([]);
    expect(findScreens(nodes, "  ")).toEqual([]);
  });

  it("trims the query", () => {
    expect(ids(findScreens(nodes, "  home "))).toEqual(["home.dashboard"]);
  });

  it("caps at 20 by default, in node order", () => {
    const many = Array.from({ length: 30 }, (_, i) => node(`s.n${String(i).padStart(2, "0")}`, "Screen"));
    const found = findScreens(many, "s");
    expect(found).toHaveLength(20);
    expect(ids(found)).toEqual(ids(many.slice(0, 20)));
  });
});

describe("countScreens", () => {
  const many = Array.from({ length: 312 }, (_, i) => node(`s.n${i}`, "Screen"));

  it("counts every match, past the list's cap", () => {
    expect(countScreens(many, "s")).toBe(312);
    expect(findScreens(many, "s")).toHaveLength(20);
  });

  it("equals the listed count when the matches fit", () => {
    expect(countScreens(nodes, "trip")).toBe(findScreens(nodes, "trip").length);
    expect(countScreens(nodes, "trip")).toBe(3);
  });

  it("is 0 for an empty, whitespace or unmatched query", () => {
    expect(countScreens(nodes, "")).toBe(0);
    expect(countScreens(nodes, "  ")).toBe(0);
    expect(countScreens(nodes, "zzz")).toBe(0);
  });
});

describe("said", () => {
  it("says nothing for an empty query, and that nothing matched", () => {
    expect(said(" ", 0)).toBe("");
    expect(said("x", 0)).toBe("No screens match");
  });

  it("says the count, singular or plural, when all are listed", () => {
    expect(said("x", 1)).toBe("1 screen");
    expect(said("x", 20)).toBe("20 screens");
  });

  it("says the true count and the cap when the list is cut off", () => {
    expect(said("x", 312)).toBe("312 screens, showing 20");
    expect(said("x", 21)).toBe("21 screens, showing 20");
  });
});
