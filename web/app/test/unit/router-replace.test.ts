// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { replaceRoute, route } from "../../src/router.ts";

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
