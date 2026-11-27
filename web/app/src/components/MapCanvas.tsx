// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app map's drawing: edges in an SVG (decoration, hidden from
// assistive technology: the table in MapTable says the same), and each
// screen an HTML link placed over it. A click or focus selects a screen;
// Enter, or a click with a modifier, follows its link to the screen
// editor. Arrow keys move to the nearest screen in that direction
// (src/map/nav.ts). Every text node is project content set as text.

import type { TargetedKeyboardEvent, TargetedMouseEvent } from "preact";
import { useRef } from "preact/hooks";

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
  const linked = new Set<string>();
  for (const e of layout.graph.edges) if (incident(e, selected)) linked.add(e.from === selected ? e.to : e.from);
  const shown = layout.edges.filter((p) => !onlySelected || selected === null || incident(p.edge, selected));
  // Highlighted edges are drawn last, over the others.
  const ordered = [...shown.filter((p) => !incident(p.edge, selected)), ...shown.filter((p) => incident(p.edge, selected))];

  const focusNode = (id: string) => {
    const el = canvas.current?.querySelector<HTMLAnchorElement>(`a[data-id="${CSS.escape(id)}"]`);
    el?.focus();
  };

  const onKeyDown = (e: TargetedKeyboardEvent<HTMLAnchorElement>, id: string) => {
    const next = neighbour(layout.nodes, id, e.key);
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
          <span key={l.area} class="map-lane" style={{ left: `${l.x}px`, width: `${l.width}px` }}>
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
              data-selected={node.id === selected ? "true" : "false"}
              data-linked={linked.has(node.id) ? "true" : "false"}
              data-proposed={node.proposed ? "true" : "false"}
              data-errors={n > 0 ? "true" : "false"}
              style={{ left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` }}
              onFocus={() => select(node.id)}
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
