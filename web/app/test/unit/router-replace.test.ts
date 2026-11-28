// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { navigate, replaceRoute, route } from "../../src/router.ts";

describe("replaceRoute", () => {
  it("changes the address and the route without a new history entry", () => {
    location.hash = "#/flows/a/walk";
    const before = history.length;
    replaceRoute({ name: "flowWalk", flow: "a", step: 3 });
    expect(location.hash).toBe("#/flows/a/walk/3");
    expect(history.length).toBe(before);
    expect(route.value).toEqual({ name: "flowWalk", flow: "a", step: 3 });
  });
});

describe("navigate", () => {
  it("adds a history entry and sets the route at once, before any hashchange", () => {
    location.hash = "#/map";
    route.value = { name: "map" };
    const before = history.length;
    let changes = 0;
    const count = () => changes++;
    addEventListener("hashchange", count);
    try {
      navigate({ name: "map", screen: "trip.timeline", steps: 1 });
      // hashchange is a later task: the route is already the new one without it.
      expect(changes).toBe(0);
      expect(route.value).toEqual({ name: "map", screen: "trip.timeline", steps: 1 });
      expect(location.hash).toBe("#/map/trip.timeline?steps=1");
      expect(history.length).toBe(before + 1);
    } finally {
      removeEventListener("hashchange", count);
    }
  });
});
