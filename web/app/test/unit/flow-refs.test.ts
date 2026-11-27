// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import type { Region, Screen } from "@c65llc/starboard-core";
import { describe, expect, it } from "vitest";

import { findRefs, leadingRef, parseRefLabel, refContext, regionNames, uniqueRefs } from "../../src/flows/refs.ts";
import { REF_PATTERN, syntax } from "./ref-pattern.ts";

describe("the pattern", () => {
  it("is core's, compiled as given and global, never restated", () => {
    expect(syntax.pattern).toBe(REF_PATTERN);
    expect(syntax.all.source).toBe(new RegExp(REF_PATTERN).source);
    expect(syntax.all.flags).toBe("g");
  });
});

describe("findRefs", () => {
  it("finds @screen and @screen#region as core's RefPattern does, with offsets", () => {
    const text = "1. Tap @trip.timeline#add-activity, then @activity.add.\nMail me@example.com or @@x.y or a.@b.c";
    expect(findRefs(text, syntax)).toEqual([
      { screen: "trip.timeline", region: "add-activity", text: "@trip.timeline#add-activity", from: 7, to: 34 },
      { screen: "activity.add", region: "", text: "@activity.add", from: 41, to: 54 },
    ]);
  });

  it("needs a dotted screen ID", () => {
    expect(findRefs("@home and @Trip.x", syntax)).toEqual([]);
  });

  it("uniqueRefs keeps the first of each, in order", () => {
    expect(uniqueRefs("@a.b @c.d#e @a.b @c.d#e @c.d", syntax).map((r) => r.text)).toEqual(["@a.b", "@c.d#e", "@c.d"]);
  });
});

describe("refContext", () => {
  it("offers screens after @, from the character after it", () => {
    expect(refContext("1. Tap @", 10, syntax)).toEqual({ kind: "screen", from: 18, typed: "" });
    expect(refContext("Tap @trip.ti", 0, syntax)).toEqual({ kind: "screen", from: 5, typed: "trip.ti" });
    expect(refContext("@trip", 0, syntax)).toEqual({ kind: "screen", from: 1, typed: "trip" });
  });

  it("offers regions after a screen and #", () => {
    expect(refContext("Tap @trip.timeline#add", 0, syntax)).toEqual({ kind: "region", screen: "trip.timeline", from: 19, typed: "add" });
    expect(refContext("Tap @trip.timeline#", 3, syntax)).toEqual({ kind: "region", screen: "trip.timeline", from: 22, typed: "" });
  });

  it("offers nothing inside an e-mail address, a word or after a finished ref", () => {
    expect(refContext("me@exam", 0, syntax)).toBeNull();
    expect(refContext("Tap @trip.timeline ", 0, syntax)).toBeNull();
    expect(refContext("no at sign", 0, syntax)).toBeNull();
    expect(refContext("@trip.x#a#", 0, syntax)).toBeNull();
  });
});

describe("leadingRef", () => {
  it("is the reference a message starts with", () => {
    expect(leadingRef("@x.y#nope: x.y has no region nope", syntax)).toBe("@x.y#nope");
    expect(leadingRef("@x.y is not a registered screen", syntax)).toBe("@x.y");
    expect(leadingRef("step has no reference @x.y", syntax)).toBeNull();
  });
});

describe("parseRefLabel", () => {
  it("reads a diagram label that is exactly one reference", () => {
    expect(parseRefLabel(" @trip.timeline ", syntax)).toEqual({ screen: "trip.timeline", region: "" });
    expect(parseRefLabel("@activity.add#title", syntax)).toEqual({ screen: "activity.add", region: "title" });
  });

  it("is null for anything else", () => {
    expect(parseRefLabel("Save", syntax)).toBeNull();
    expect(parseRefLabel("back to @trip.timeline", syntax)).toBeNull();
    expect(parseRefLabel("@trip", syntax)).toBeNull();
  });
});

const region = (name: string, more: Partial<Region> = {}): Region => ({
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
  path: "",
  line: 0,
  ...more,
});

describe("regionNames", () => {
  it("lists every named region of every layout once, nested ones too, in order", () => {
    const screen = {
      layout: [region("header"), region("list", { item: region("row", { children: [region("title")] }) }), region("")],
      layouts: { tablet: [region("header"), region("sidebar")] },
    } as unknown as Screen;
    expect(regionNames(screen)).toEqual(["header", "list", "row", "title", "sidebar"]);
  });
});
