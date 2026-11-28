// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import type { MapNode } from "./graph.ts";

/** The most options the Find list shows: the spec's cap, for speed and so the list stays scannable. */
export const FIND_LIMIT = 20;

/** matches is every screen the query finds, best first: ID prefix, ID contains, then title contains. */
function matches(nodes: MapNode[], query: string): MapNode[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const prefix: MapNode[] = [];
  const inId: MapNode[] = [];
  const inTitle: MapNode[] = [];
  for (const n of nodes) {
    const id = n.id.toLowerCase();
    if (id.startsWith(q)) prefix.push(n);
    else if (id.includes(q)) inId.push(n);
    else if (n.title.toLowerCase().includes(q)) inTitle.push(n);
  }
  return [...prefix, ...inId, ...inTitle];
}

/**
 * findScreens is the screens the map's Find box offers for a query: ID prefix, then ID contains,
 * then title contains. Each group keeps the nodes' order and a screen appears once, in the first
 * group that matches it, so the best match leads without a score to tune.
 */
export function findScreens(nodes: MapNode[], query: string, limit = FIND_LIMIT): MapNode[] {
  return matches(nodes, query).slice(0, limit);
}

/** countScreens is how many screens match, however many the list shows: the cap must not undercount. */
export function countScreens(nodes: MapNode[], query: string): number {
  return matches(nodes, query).length;
}

/** said is the live region's text: the true count, and the cap when the list is cut off. */
export function said(query: string, total: number): string {
  if (query.trim() === "") return "";
  if (total === 0) return "No screens match";
  const n = `${total} screen${total === 1 ? "" : "s"}`;
  return total > FIND_LIMIT ? `${n}, showing ${FIND_LIMIT}` : n;
}
