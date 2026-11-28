// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The map's zoom arithmetic, kept free of the DOM so the zoom controls and the
// scroll box can share one set of rules. Steps are fixed rather than
// continuous so a button press always lands on a value a person can name.

export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2] as const;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
// A freshly opened view never starts below half size, even when Fit would
// pick a smaller zoom, so the first screen stays legible.
export const NEW_VIEW_FLOOR = 0.5;

// Steps are compared with an epsilon because 0.33 and 0.67 are rounded values:
// without it, a zoom that already sits on a step would step to the next one.
const EPSILON = 1e-9;

export function stepZoom(z: number, dir: 1 | -1): number {
  if (dir === 1) {
    for (const step of ZOOM_STEPS) {
      if (step > z + EPSILON) return step;
    }
    return MAX_ZOOM;
  }
  for (const step of [...ZOOM_STEPS].reverse()) {
    if (step < z - EPSILON) return step;
  }
  return MIN_ZOOM;
}

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

// Fit never enlarges past 100 percent: a small map sits at its natural size
// rather than being blown up to fill the panel.
export function fitZoom(
  panel: { width: number; height: number },
  layout: { width: number; height: number },
  floor: number = MIN_ZOOM,
): number {
  if (layout.width <= 0 || layout.height <= 0) return 1;
  const ratio = Math.min(panel.width / layout.width, panel.height / layout.height);
  if (!Number.isFinite(ratio)) return 1;
  // A zero or negative panel (the map box before it is measured) lands on the
  // floor, not on 1: fitting into nothing should still show the smallest map.
  return Math.min(1, Math.max(floor, ratio));
}

// `from` and `to` must be clamped zooms (> 0). Scroll is not clamped here: the
// browser clamps scrollLeft/scrollTop on assignment.
// The scroll box holds the map at `from` zoom; `point` is where the pointer or
// focus sits inside the viewport. Work out which unzoomed content point is
// under it, then scroll so that same point is under `point` at `to` zoom.
export function zoomAround(
  scroll: { left: number; top: number },
  point: { x: number; y: number },
  from: number,
  to: number,
): { left: number; top: number } {
  const contentX = (scroll.left + point.x) / from;
  const contentY = (scroll.top + point.y) / from;
  return {
    left: contentX * to - point.x,
    top: contentY * to - point.y,
  };
}

/** A rectangle in the canvas's own (unscaled) coordinates: a placed screen. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The canvas is drawn at its layout size and scaled, so a screen's place in
// the scroll box is its layout place times the zoom; offsetLeft and its kin
// stay unscaled under a transform, which is why these take the layout's rect.

/** The scroll that puts rect's middle in the middle of a viewport of size view, at zoom z (unclamped). */
export function centredScroll(view: { width: number; height: number }, rect: Rect, z: number): { left: number; top: number } {
  return {
    left: (rect.x + rect.width / 2) * z - view.width / 2,
    top: (rect.y + rect.height / 2) * z - view.height / 2,
  };
}

/**
 * The least scroll that brings rect wholly into a viewport of size view, at
 * zoom z, with margin to spare where it fits (scrollIntoView's "nearest", in
 * the box only): unchanged when it is in view already.
 */
export function revealScroll(
  scroll: { left: number; top: number },
  view: { width: number; height: number },
  rect: Rect,
  z: number,
  margin = 0,
): { left: number; top: number } {
  const axis = (at: number, size: number, start: number, length: number) => {
    const lo = start * z;
    const hi = (start + length) * z;
    const pad = Math.max(0, Math.min(margin, (size - (hi - lo)) / 2));
    if (lo - pad < at) return lo - pad;
    if (hi + pad > at + size) return Math.min(lo - pad, hi + pad - size);
    return at;
  };
  return { left: axis(scroll.left, view.width, rect.x, rect.width), top: axis(scroll.top, view.height, rect.y, rect.height) };
}

/**
 * The zoom after a Ctrl/⌘+wheel of deltaY (pixels; lines are taken as 16
 * px): multiplicative, so a trackpad pinch's many small deltas and a mouse
 * wheel's few large ones zoom alike, one notch at most a step's worth.
 */
export function wheelZoom(z: number, deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const notch = Math.max(-100, Math.min(100, px));
  return clampZoom(z * 2 ** (-notch / 300));
}
