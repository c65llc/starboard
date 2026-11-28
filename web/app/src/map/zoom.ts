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
  return Math.min(1, Math.max(floor, ratio));
}

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
