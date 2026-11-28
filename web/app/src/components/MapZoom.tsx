// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app map's zoom controls: out, the zoom as a percentage, in, Fit and
// 100%. Native buttons, each its own Tab stop. The shown percentage follows
// every change; a separate, hidden polite status says the zoom (announced),
// which AppMap sets at once for a key or a button and only once a wheel or
// a pinch has settled, so a pinch is not read out notch by notch. The
// buttons are never disabled at an end of the range: a disabled button
// drops the focus of someone pressing it again.

import { stepZoom } from "../map/zoom.ts";

interface Props {
  zoom: number;
  /** The zoom the live status says. */
  announced: number;
  onZoom(z: number): void;
  /** Fits the whole drawing into the map's box. */
  onFit(): void;
}

export const zoomPercent = (z: number) => `${Math.round(z * 100)}%`;

export function MapZoom({ zoom, announced, onZoom, onFit }: Props) {
  return (
    <div class="map-zoom" role="group" aria-label="Zoom">
      <button type="button" class="button button--small map-zoom__button" aria-label="Zoom out" onClick={() => onZoom(stepZoom(zoom, -1))}>
        −
      </button>
      <span class="map-zoom__level" aria-hidden="true">
        {zoomPercent(zoom)}
      </span>
      <span class="visually-hidden" role="status" aria-live="polite">
        {zoomPercent(announced)}
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
