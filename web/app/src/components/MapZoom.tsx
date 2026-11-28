// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app map's zoom controls: out, the zoom as a percentage, in, Fit and
// 100%. Native buttons, each its own Tab stop; the percentage is a polite
// live status, so a change made from the keyboard or the wheel is heard
// without moving focus. The buttons are never disabled at an end of the
// range: a disabled button drops the focus of someone pressing it again.

import { stepZoom } from "../map/zoom.ts";

interface Props {
  zoom: number;
  onZoom(z: number): void;
  /** Fits the whole drawing into the map's box. */
  onFit(): void;
}

export const zoomPercent = (z: number) => `${Math.round(z * 100)}%`;

export function MapZoom({ zoom, onZoom, onFit }: Props) {
  return (
    <div class="map-zoom" role="group" aria-label="Zoom">
      <button type="button" class="button button--small map-zoom__button" aria-label="Zoom out" onClick={() => onZoom(stepZoom(zoom, -1))}>
        −
      </button>
      <span class="map-zoom__level" role="status" aria-live="polite">
        {zoomPercent(zoom)}
      </span>
      <button type="button" class="button button--small map-zoom__button" aria-label="Zoom in" onClick={() => onZoom(stepZoom(zoom, 1))}>
        +
      </button>
      <button type="button" class="button button--small map-zoom__button" onClick={onFit}>
        Fit
      </button>
      <button type="button" class="button button--small map-zoom__button" onClick={() => onZoom(1)}>
        100%
      </button>
    </div>
  );
}
