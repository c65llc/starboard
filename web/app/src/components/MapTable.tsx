// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The map as text (WCAG 1.1.1, 1.3.1): every to: the drawing stands for,
// under the same platform and proposed filters, including the self links
// and unregistered targets the drawing leaves out. Closed until asked for.
//
// A large project has hundreds of links, and a row is nine elements, so
// the rows are made only once the table is opened, and then a batch at a
// time, yielding to the browser between batches: the table never costs the
// map's first render anything, and opening it never holds the main thread
// for long (Review Focus 4). Every row is there once the batches are done.

import { useEffect, useState } from "preact/hooks";

import type { MapGraph } from "../map/graph.ts";

/** Rows made per batch once the table is open. */
export const TABLE_BATCH = 100;

export function MapTable({ graph }: { graph: MapGraph }) {
  const [open, setOpen] = useState(false);
  // How many rows are made: none while closed, then a batch more each turn.
  const [made, setMade] = useState(0);
  const total = graph.links.length;
  useEffect(() => {
    if (!open || made >= total) return;
    const step = () => setMade((m) => Math.min(total, m + TABLE_BATCH));
    if (made === 0) {
      step();
      return;
    }
    const t = setTimeout(step, 0);
    return () => clearTimeout(t);
  }, [open, made, total]);

  return (
    <details class="map-table" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Every link as a table</summary>
      {open ? (
        <div class="map-table__scroll">
          <table aria-busy={made < total ? "true" : undefined}>
            <caption>Every link ({total}): from a screen, through one of its regions, to another</caption>
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">Region</th>
                <th scope="col">To</th>
                <th scope="col">Kind</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {graph.links.slice(0, made).map((l) => (
                <tr key={`${l.from}>${l.path}`}>
                  <td>
                    <code>{l.from}</code>
                  </td>
                  <td>
                    <code>{l.region || "(unnamed)"}</code>
                  </td>
                  <td>
                    <code>{l.to}</code>
                    {l.registered ? "" : " (not registered)"}
                  </td>
                  <td>{l.twoWay ? "tabs (two-way)" : l.kind}</td>
                  <td>{l.proposed ? "proposed" : "shipped"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </details>
  );
}
