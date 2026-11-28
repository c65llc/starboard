// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { describe, expect, it } from "vitest";

import { historyFor, recentres } from "../../src/map/centre.ts";

describe("recentres", () => {
  it.each([
    ["pick", "picks", true],
    ["pick", "every", true],
    ["move", "picks", false],
    ["move", "every", true],
    ["tab", "picks", false],
    ["tab", "every", false],
  ] as const)("%s under %s is %s", (by, mode, want) => {
    expect(recentres(by, mode)).toBe(want);
  });
});

describe("historyFor", () => {
  it.each([
    ["pick", "picks", "push"],
    ["pick", "every", "push"],
    ["move", "picks", "none"],
    ["move", "every", "replace"],
    ["tab", "picks", "none"],
    ["tab", "every", "none"],
  ] as const)("%s under %s is %s", (by, mode, want) => {
    expect(historyFor(by, mode)).toBe(want);
  });
});
