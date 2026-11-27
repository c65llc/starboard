// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import type { Diagnostic, Flow, Screen, WalkStep } from "@c65llc/starboard-core";
import { describe, expect, it } from "vitest";

import {
  clampStep,
  keyStep,
  rememberFormFactor,
  rememberedFormFactor,
  shownWalk,
  splitRefs,
  stepWarning,
  walkFormFactors,
} from "../../src/flows/walk.ts";
import { syntax } from "./ref-pattern.ts";

const screen = (id: string, formFactors: string[]): Screen =>
  ({ id, title: id, formFactors, layout: [], layouts: {}, platforms: [], status: {}, files: {}, edges: [] }) as unknown as Screen;

const flow = (screens: string[]): Flow =>
  ({
    id: "f",
    file: "docs/flows/flows/f.md",
    steps: screens.map((s, i) => ({ number: i + 1, text: "", screen: s, region: "", branches: [], line: 10 + i })),
  }) as unknown as Flow;

describe("walkFormFactors", () => {
  it("lists the form factors of the flow's screens, each once, in the order the steps reach them", () => {
    const screens = [screen("a.b", ["phone", "web-wide"]), screen("c.d", ["web-narrow", "phone"]), screen("e.f", ["tablet"])];
    expect(walkFormFactors(flow(["a.b", "", "c.d", "a.b", "x.y"]), screens)).toEqual(["phone", "web-wide", "web-narrow"]);
  });

  it("is empty when no step names a screen that is drawn", () => {
    expect(walkFormFactors(flow(["", "x.y"]), [screen("a.b", ["phone"])])).toEqual([]);
  });
});

describe("clampStep", () => {
  it("defaults to the first step and stays within the flow", () => {
    expect(clampStep(undefined, 5)).toBe(1);
    expect(clampStep(3, 5)).toBe(3);
    expect(clampStep(9, 5)).toBe(5);
    expect(clampStep(0, 5)).toBe(1);
    expect(clampStep(2, 0)).toBe(0);
  });
});

describe("keyStep", () => {
  it("moves with the arrows, Home and End, and stops at the ends", () => {
    expect(keyStep("ArrowRight", 2, 5)).toBe(3);
    expect(keyStep("ArrowLeft", 2, 5)).toBe(1);
    expect(keyStep("ArrowLeft", 1, 5)).toBe(1);
    expect(keyStep("ArrowRight", 5, 5)).toBe(5);
    expect(keyStep("Home", 4, 5)).toBe(1);
    expect(keyStep("End", 1, 5)).toBe(5);
  });

  it("ignores every other key", () => {
    expect(keyStep("ArrowDown", 2, 5)).toBeNull();
    expect(keyStep("a", 2, 5)).toBeNull();
  });
});

describe("splitRefs", () => {
  it("splits text into plain runs and references, in order", () => {
    expect(splitRefs("Tap @trip.timeline#add-activity; then @activity.add.", syntax)).toEqual([
      { text: "Tap " },
      { ref: { screen: "trip.timeline", region: "add-activity", text: "@trip.timeline#add-activity" } },
      { text: "; then " },
      { ref: { screen: "activity.add", region: "", text: "@activity.add" } },
      { text: "." },
    ]);
  });

  it("keeps text without references, markup and all, as one plain run", () => {
    expect(splitRefs("<b>me@example.com</b>", syntax)).toEqual([{ text: "<b>me@example.com</b>" }]);
    expect(splitRefs("", syntax)).toEqual([]);
  });
});

describe("stepWarning", () => {
  const d = (over: Partial<Diagnostic>): Diagnostic => ({
    rule: "step-without-ref",
    severity: "warn",
    file: "docs/flows/flows/f.md",
    path: "",
    line: 11,
    message: "step 2 has no @screen reference to say where it happens",
    ...over,
  });

  it("finds lint's step-without-ref finding on the step's line", () => {
    const f = flow(["a.b", ""]);
    const hit = d({});
    expect(stepWarning([d({ line: 10 }), d({ rule: "other" }), d({ file: "x.md" }), hit], f, 2)).toBe(hit);
  });

  it("is undefined when lint reported none", () => {
    expect(stepWarning([], flow(["a.b", ""]), 2)).toBeUndefined();
    expect(stepWarning([d({})], flow(["a.b", ""]), 7)).toBeUndefined();
  });
});

describe("the remembered form factor", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it("is the one chosen, when the flow offers it, else the first offered", () => {
    const s = store();
    expect(rememberedFormFactor(["phone", "web-wide"], s)).toBe("phone");
    rememberFormFactor("web-wide", s);
    expect(rememberedFormFactor(["phone", "web-wide"], s)).toBe("web-wide");
    expect(rememberedFormFactor(["phone"], s)).toBe("phone");
    expect(rememberedFormFactor([], s)).toBe("");
  });

  it("survives storage that throws, keeping the choice for this page", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    rememberFormFactor("web-narrow", broken);
    expect(rememberedFormFactor(["phone", "web-narrow"], broken)).toBe("web-narrow");
  });
});

describe("shownWalk", () => {
  const step = (svg: string): WalkStep => ({ number: 1, text: "t", screen: "a.b", region: "r", presentation: "", next: "", branches: [], svg });
  const files = { "a.yaml": "x" };
  const asked = (formFactor: string, f: Record<string, string> = files) => ({ flow: "f", formFactor, files: f });
  const stand = [step("")];

  it("is the stand-in, labelled with the form factor asked, until core answers", () => {
    expect(shownWalk(null, asked("phone"), stand)).toEqual({ steps: stand, formFactor: "phone", stale: false, drawn: false, error: "" });
  });

  it("is the answer, labelled with the form factor it was drawn on", () => {
    const walk = { steps: [step("<svg/>")] };
    expect(shownWalk({ asked: asked("phone"), walk }, asked("phone"), stand)).toEqual({
      steps: walk.steps,
      formFactor: "phone",
      stale: false,
      drawn: true,
      error: "",
    });
  });

  it("keeps an older answer, still labelled with its own form factor and marked stale, while a new one is drawn", () => {
    const walk = { steps: [step("<svg/>")] };
    const afterPick = shownWalk({ asked: asked("phone"), walk }, asked("web-wide"), stand);
    expect(afterPick).toMatchObject({ steps: walk.steps, formFactor: "phone", stale: true, drawn: false });
    const afterEdit = shownWalk({ asked: asked("phone"), walk }, asked("phone", { ...files }), stand);
    expect(afterEdit).toMatchObject({ formFactor: "phone", stale: true, drawn: false });
  });

  it("reports core's error for the walk asked", () => {
    expect(shownWalk({ asked: asked("phone"), error: "boom" }, asked("phone"), stand)).toMatchObject({ steps: stand, drawn: true, error: "boom" });
    expect(shownWalk({ asked: asked("phone"), error: "boom" }, asked("web-wide"), stand)).toMatchObject({ drawn: false, error: "" });
  });
});
