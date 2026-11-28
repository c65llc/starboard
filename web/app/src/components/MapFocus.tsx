// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app map's Focus controls: how many steps from the centre the map
// keeps (All, 1 step, 2 steps), what re-centres it (Picks, or Every
// selection; src/map/centre.ts), and, while a screen is centred, a link
// back to all screens. Native radios, a select and a link, so each is its
// own Tab stop with the browser's own keys.

import type { TargetedMouseEvent } from "preact";

import type { Recentre } from "../map/prefs.ts";
import type { FocusLevel } from "../router.ts";
import { hrefFor } from "../router.ts";

interface Props {
  level: FocusLevel;
  recentre: Recentre;
  onLevel(level: FocusLevel): void;
  onRecentre(mode: Recentre): void;
  /** A screen is centred, so the map may be showing only part of itself. */
  centred: boolean;
  /** Shows all screens: called in place of following the All screens link. */
  onAll(): void;
}

const LEVELS: [FocusLevel, string][] = [
  [0, "All"],
  [1, "1 step"],
  [2, "2 steps"],
];

export function MapFocus({ level, recentre, onLevel, onRecentre, centred, onAll }: Props) {
  const all = (e: TargetedMouseEvent<HTMLAnchorElement>) => {
    // A link opened elsewhere (a modifier, the middle button) is the browser's to follow.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onAll();
  };
  return (
    <div class="map-focus">
      <fieldset class="map-focus__levels">
        <legend class="map-focus__legend">Focus</legend>
        {LEVELS.map(([n, label]) => (
          <label key={n} class="map-focus__level">
            <input type="radio" name="map-focus-level" value={n} checked={level === n} onChange={() => onLevel(n)} />
            {label}
          </label>
        ))}
      </fieldset>
      <label class="map__filter">
        Re-centre on
        <select value={recentre} onChange={(e) => onRecentre((e.currentTarget as HTMLSelectElement).value === "every" ? "every" : "picks")}>
          <option value="picks">Picks</option>
          <option value="every">Every selection</option>
        </select>
      </label>
      {centred ? (
        <a class="map-focus__all" href={hrefFor({ name: "map" })} onClick={all}>
          All screens
        </a>
      ) : level > 0 ? (
        <p class="map-focus__note">Select a screen to focus on it</p>
      ) : null}
    </div>
  );
}
