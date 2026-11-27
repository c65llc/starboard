// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
// @vitest-environment jsdom

import { h, render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import type { Screen } from "@c65llc/starboard-core";

import { Inspector } from "../../src/components/Inspector.tsx";

const screen: Screen = {
  id: "trip.timeline",
  title: "Timeline",
  area: "trip",
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
};

afterEach(() => render(null, document.body));

function mount(): { sets: [string, string, string | null][]; input: HTMLInputElement } {
  const sets: [string, string, string | null][] = [];
  render(
    h(Inspector, {
      screen,
      region: null,
      kinds: [],
      presentations: ["push"],
      screenIds: [],
      set: (path: string, key: string, value: string | null) => void sets.push([path, key, value]),
    }),
    document.body,
  );
  const label = [...document.querySelectorAll("label")].find((l) => l.textContent?.startsWith("Title"));
  const input = label?.querySelector("input");
  if (!input) throw new Error("no Title field");
  return { sets, input };
}

describe("the inspector's text fields", () => {
  it("commit once on Enter, not again when the field then loses focus", () => {
    const { sets, input } = mount();
    input.value = "Days";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    // Leaving the field: the browser's change event, the value still not the prop's.
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(sets).toEqual([["", "title", "Days"]]);
  });

  it("commit again when the value is typed again after a commit", () => {
    const { sets, input } = mount();
    input.value = "Days";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    input.value = "Days";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(sets).toEqual([
      ["", "title", "Days"],
      ["", "title", "Days"],
    ]);
  });

  it("commit again on a second Enter when the first edit was refused (the value came back unchanged)", () => {
    const { sets, input } = mount();
    input.value = "Days";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(sets).toEqual([
      ["", "title", "Days"],
      ["", "title", "Days"],
    ]);
  });
});
