// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import type { MapNode } from "./graph.ts";

/**
 * findScreens is the screens the map's Find box offers for a query: ID prefix, then ID contains,
 * then title contains. Each group keeps the nodes' order and a screen appears once, in the first
 * group that matches it, so the best match leads without a score to tune.
 */
export function findScreens(nodes: MapNode[], query: string, limit = 20): MapNode[] {
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
  return [...prefix, ...inId, ...inTitle].slice(0, limit);
}
