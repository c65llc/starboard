// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The map as text (WCAG 1.1.1, 1.3.1): every to: the drawing stands for,
// under the same platform and proposed filters, including the self links
// and unregistered targets the drawing leaves out. Closed until asked for.

import type { MapGraph } from "../map/graph.ts";

export function MapTable({ graph }: { graph: MapGraph }) {
  return (
    <details class="map-table">
      <summary>Every link as a table</summary>
      <div class="map-table__scroll">
        <table>
          <caption>Every link ({graph.links.length}): from a screen, through one of its regions, to another</caption>
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
            {graph.links.map((l) => (
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
    </details>
  );
}
