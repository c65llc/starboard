// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app map's drawing: edges in an SVG (decoration, hidden from
// assistive technology: the table in MapTable says the same), and each
// screen an HTML link placed over it. A click or focus selects a screen;
// Enter, or a click with a modifier, follows its link to the screen
// editor. The map is one Tab stop (a roving tabindex): arrow keys move to
// the nearest screen in that direction (src/map/nav.ts), Home and End to
// the first and last. The selected screen carries aria-current. Every
// text node is project content set as text.
//
// A large project's map is thousands of elements, most of them edges (a
// group, a path, a label's box and text each). Made in one commit they
// would hold the main thread past 100 ms (Review Focus 4), so the screens
// come first and the edges follow a batch per animation frame, each batch
// with its own style and layout; a selected screen's edges are drawn at
// once whatever the batch has reached.

import type { TargetedKeyboardEvent, TargetedMouseEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { MapEdge } from "../map/graph.ts";
import type { MapLayout, PlacedEdge } from "../map/layout.ts";
import { nodeMeta } from "../map/layout.ts";
import { neighbour } from "../map/nav.ts";
import { hrefFor } from "../router.ts";

interface Props {
  layout: MapLayout;
  selected: string | null;
  onlySelected: boolean;
  errors: Map<string, number>;
  select(id: string): void;
}

/** Edges drawn per animation frame. */
export const EDGE_BATCH = 150;

export const incident = (e: MapEdge, id: string | null) => id !== null && (e.from === id || e.to === id);

const d = (points: [number, number][]) => points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");

function Edge({ placed, on }: { placed: PlacedEdge; on: boolean }) {
  const { edge, points, label } = placed;
  const marker = `url(#${on ? "map-arrow-on" : "map-arrow-idle"})`;
  const line = `map-edge__line${on ? " map-edge__line--on" : ""}${edge.proposed ? " map-edge__line--proposed" : ""}`;
  return (
    <g
      class="map-edge"
      data-edge={edge.id}
      data-from={edge.from}
      data-to={edge.to}
      data-on={on ? "true" : "false"}
      data-two-way={edge.twoWay ? "true" : "false"}
      data-proposed={edge.proposed ? "true" : "false"}
    >
      <path class={line} d={d(points)} marker-end={marker} marker-start={edge.twoWay ? marker : undefined} />
      {label ? (
        <>
          <rect class="map-edge__label-bg" x={label.x} y={label.y} width={label.width} height={label.height} rx={2} />
          <text class={`map-edge__label${on ? " map-edge__label--on" : ""}`} x={label.x + 3} y={label.y + label.height - 3}>
            {edge.label}
          </text>
        </>
      ) : null}
    </g>
  );
}

function Arrow({ id }: { id: string }) {
  return (
    <marker id={id} class={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 Z" />
    </marker>
  );
}

export function MapCanvas({ layout, selected, onlySelected, errors, select }: Props) {
  const canvas = useRef<HTMLDivElement>(null);
  // The node Tab reaches: the last one focused while it is on the map, else the selected one, else the first.
  const [active, setActive] = useState<string | null>(null);
  const has = (id: string | null) => id !== null && layout.nodes.some((p) => p.node.id === id);
  const tabStop = has(active) ? active : has(selected) ? selected : (layout.nodes[0]?.node.id ?? null);
  const linked = new Set<string>();
  for (const e of layout.graph.edges) if (incident(e, selected)) linked.add(e.from === selected ? e.to : e.from);
  // How many edges, in layout order, are drawn so far: a batch more each frame, from the first for each new layout.
  const [progress, setProgress] = useState({ layout, drawn: EDGE_BATCH });
  const drawn = progress.layout === layout ? progress.drawn : EDGE_BATCH;
  useEffect(() => {
    if (drawn >= layout.edges.length) return;
    const frame = requestAnimationFrame(() => setProgress({ layout, drawn: drawn + EDGE_BATCH }));
    return () => cancelAnimationFrame(frame);
  }, [layout, drawn]);
  const shown = layout.edges.filter(
    (p, i) => (i < drawn || incident(p.edge, selected)) && (!onlySelected || selected === null || incident(p.edge, selected)),
  );
  // Highlighted edges are drawn last, over the others.
  const ordered = [...shown.filter((p) => !incident(p.edge, selected)), ...shown.filter((p) => incident(p.edge, selected))];

  const focusNode = (id: string) => {
    const el = canvas.current?.querySelector<HTMLAnchorElement>(`a[data-id="${CSS.escape(id)}"]`);
    el?.focus();
  };

  const onKeyDown = (e: TargetedKeyboardEvent<HTMLAnchorElement>, id: string) => {
    const ends = { Home: layout.nodes[0], End: layout.nodes[layout.nodes.length - 1] } as const;
    const next = e.key === "Home" || e.key === "End" ? ends[e.key]?.node.id : neighbour(layout.nodes, id, e.key);
    if (!next) return;
    e.preventDefault();
    focusNode(next);
  };

  const onClick = (e: TargetedMouseEvent<HTMLAnchorElement>, id: string) => {
    // A click from the keyboard (Enter: detail 0), or one meant to open the
    // screen elsewhere, follows the link; a plain click selects.
    if (e.detail === 0 || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    select(id);
    e.currentTarget.focus();
  };

  return (
    <div class="map__scroll">
      <div ref={canvas} class="map__canvas" role="group" aria-label="App map" aria-describedby="map-help" style={{ width: `${layout.width}px`, height: `${layout.height}px` }}>
        {layout.lanes.map((l) => (
          <span key={l.key} class="map-lane" style={{ left: `${l.x}px`, width: `${l.width}px` }}>
            {l.area}
          </span>
        ))}
        <svg class="map__edges" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
          <defs>
            <Arrow id="map-arrow-idle" />
            <Arrow id="map-arrow-on" />
          </defs>
          {ordered.map((p) => (
            <Edge key={p.edge.id} placed={p} on={incident(p.edge, selected)} />
          ))}
        </svg>
        {layout.nodes.map(({ node, x, y, width, height }) => {
          const n = errors.get(node.id) ?? 0;
          const meta = [nodeMeta(node), n > 0 ? `${n} error${n === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
          return (
            <a
              key={node.id}
              class="map-node"
              href={hrefFor({ name: "screens", screen: node.id })}
              data-id={node.id}
              tabIndex={node.id === tabStop ? 0 : -1}
              aria-current={node.id === selected ? "true" : undefined}
              data-selected={node.id === selected ? "true" : "false"}
              data-linked={linked.has(node.id) ? "true" : "false"}
              data-proposed={node.proposed ? "true" : "false"}
              data-errors={n > 0 ? "true" : "false"}
              style={{ left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` }}
              onFocus={() => {
                setActive(node.id);
                select(node.id);
              }}
              onClick={(e) => onClick(e, node.id)}
              onKeyDown={(e) => onKeyDown(e, node.id)}
            >
              <span class="map-node__id">{node.id}</span>
              <span class="map-node__meta">{meta}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
