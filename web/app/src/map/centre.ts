// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The map keeps two ideas apart: the selection (highlighted, in the panel,
// aria-current) and the centre (what a focused neighbourhood is built
// around, and what the address holds). Whether a selection also moves the
// centre depends on how it was made and on the viewer's Re-centre setting.

import type { Recentre } from "./prefs.ts";

/**
 * SelectBy is how a screen came to be selected: pick (a plain click, Space,
 * a panel link, a Find result), move (arrow keys, Home, End) or tab (focus
 * arriving by Tab).
 */
export type SelectBy = "pick" | "move" | "tab";

/** recentres is whether a selection made by `by` moves the centre under mode. */
export function recentres(by: SelectBy, mode: Recentre): boolean {
  if (by === "pick") return true;
  if (by === "move") return mode === "every";
  return false;
}

/**
 * historyFor is what a selection does to history. The address holds only
 * the centre, so a selection that does not re-centre leaves it alone; a
 * pick pushes, so Back retraces the walk; a re-centre by arrow keys
 * replaces, so moving around does not flood history.
 */
export function historyFor(by: SelectBy, mode: Recentre): "push" | "replace" | "none" {
  if (!recentres(by, mode)) return "none";
  return by === "pick" ? "push" : "replace";
}
