// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { describe, expect, it } from "vitest";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  NEW_VIEW_FLOOR,
  ZOOM_STEPS,
  clampZoom,
  fitZoom,
  stepZoom,
  zoomAround,
} from "../../src/map/zoom.ts";

describe("zoom steps", () => {
  it("publishes the step table and its bounds", () => {
    expect(ZOOM_STEPS).toEqual([0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2]);
    expect(MIN_ZOOM).toBe(0.25);
    expect(MAX_ZOOM).toBe(2);
    expect(NEW_VIEW_FLOOR).toBe(0.5);
  });

  it("steps to the next value strictly beyond the current zoom", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1.1, -1)).toBe(1);
  });

  it("holds at the end steps", () => {
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.25, -1)).toBe(0.25);
  });

  it("treats values within an epsilon as already on a step", () => {
    expect(stepZoom(0.33, 1)).toBe(0.5);
    expect(stepZoom(0.67, -1)).toBe(0.5);
    expect(stepZoom(0.33 + 1e-12, -1)).toBe(0.25);
  });
});

describe("clampZoom", () => {
  it("clamps to the zoom range", () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(3)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it("returns 1 for a non-finite zoom", () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("fitZoom", () => {
  it("fits the wider dimension and clamps to the floor", () => {
    expect(fitZoom({ width: 800, height: 600 }, { width: 3200, height: 600 })).toBe(0.25);
  });

  it("respects a raised floor", () => {
    expect(fitZoom({ width: 800, height: 600 }, { width: 3200, height: 600 }, 0.5)).toBe(0.5);
  });

  it("never enlarges past 100 percent", () => {
    expect(fitZoom({ width: 800, height: 600 }, { width: 200, height: 100 })).toBe(1);
  });

  it("returns 1 for a zero-size layout", () => {
    expect(fitZoom({ width: 800, height: 600 }, { width: 0, height: 0 })).toBe(1);
  });

  it("returns 1 for a NaN panel rather than leaking NaN", () => {
    expect(fitZoom({ width: Number.NaN, height: 600 }, { width: 3200, height: 600 })).toBe(1);
    expect(fitZoom({ width: 800, height: Number.NaN }, { width: 3200, height: 600 })).toBe(1);
  });

  it.each([0.25, 0.5])("pins a zero or negative panel to the floor %s", (floor) => {
    expect(fitZoom({ width: 0, height: 0 }, { width: 3200, height: 600 }, floor)).toBe(floor);
    expect(fitZoom({ width: -40, height: -40 }, { width: 3200, height: 600 }, floor)).toBe(floor);
  });
});

describe("zoomAround", () => {
  it("keeps the content point under the viewport point", () => {
    const scroll = { left: 0, top: 0 };
    const point = { x: 100, y: 100 };
    const next = zoomAround(scroll, point, 1, 2);
    expect(next).toEqual({ left: 100, top: 100 });
    const before = { x: (scroll.left + point.x) / 1, y: (scroll.top + point.y) / 1 };
    const after = { x: (next.left + point.x) / 2, y: (next.top + point.y) / 2 };
    expect(after).toEqual(before);
  });

  it("round-trips a zoom in and back out to the same scroll", () => {
    const scroll = { left: 240, top: 180 };
    const point = { x: 64, y: 32 };
    const zoomedIn = zoomAround(scroll, point, 1, 2);
    expect(zoomAround(zoomedIn, point, 2, 1)).toEqual(scroll);
  });
});
