// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { describe, expect, it } from "vitest";

import { hrefFor, parseRoute } from "../../src/router.ts";
import type { Route } from "../../src/router.ts";

describe("parseRoute", () => {
  it.each<[string, Route]>([
    ["", { name: "open" }],
    ["#", { name: "open" }],
    ["#/", { name: "open" }],
    ["#/screens", { name: "screens" }],
    ["#/screens/trip.timeline", { name: "screens", screen: "trip.timeline" }],
    ["#/flows", { name: "flows" }],
    ["#/flows/add-activity/edit", { name: "flowEdit", flow: "add-activity" }],
    ["#/flows/add-activity/walk", { name: "flowWalk", flow: "add-activity" }],
    ["#/flows/add-activity", { name: "flowEdit", flow: "add-activity" }],
    ["#/map", { name: "map" }],
    ["#/screens/a%20b", { name: "screens", screen: "a b" }],
  ])("%s", (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });

  it("an unknown or malformed route is not found", () => {
    expect(parseRoute("#/nope")).toEqual({ name: "notFound" });
    expect(parseRoute("#/flows/x/fly")).toEqual({ name: "notFound" });
    expect(parseRoute("#/screens/%E0%A4%A")).toEqual({ name: "notFound" });
  });
});

describe("hrefFor", () => {
  it("is the inverse of parseRoute", () => {
    const routes: Route[] = [
      { name: "open" },
      { name: "screens" },
      { name: "screens", screen: "trip.timeline" },
      { name: "flows" },
      { name: "flowEdit", flow: "add-activity" },
      { name: "flowWalk", flow: "add-activity" },
      { name: "map" },
    ];
    for (const r of routes) expect(parseRoute(hrefFor(r))).toEqual(r);
    expect(hrefFor({ name: "screens", screen: "a b" })).toBe("#/screens/a%20b");
  });
});
