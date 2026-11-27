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
// would hold the main thread past 100 ms (Review Focus 4), so they are
// drawn a batch per animation frame, the screens first and then the edges
// (src/map/draw.ts), each batch with its own style and layout; a selected
// screen's edges are drawn at once whatever the batch has reached. Each
// batch is a memoised component whose props stay the same while later
// batches are added, so a frame renders only its own batch, not every
// element drawn before it.

import type { TargetedKeyboardEvent, TargetedMouseEvent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { MapEdge } from "../map/graph.ts";
import { chunks, drawnAfter, EDGE_BATCH, NODE_BATCH } from "../map/draw.ts";
import type { MapLayout, PlacedEdge, PlacedNode } from "../map/layout.ts";
import { nodeMeta } from "../map/layout.ts";
import { neighbour } from "../map/nav.ts";
import { hrefFor } from "../router.ts";
import { Batch } from "./Batch.ts";

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

/** What every screen's node needs besides its own place; the same object for every frame of one layout's batches. */
interface NodeContext {
  layout: MapLayout;
  selected: string | null;
  tabStop: string | null;
  linked: Set<string>;
  errors: Map<string, number>;
  onFocus(id: string): void;
  onClick(e: TargetedMouseEvent<HTMLAnchorElement>, id: string): void;
  onKeyDown(e: TargetedKeyboardEvent<HTMLAnchorElement>, id: string): void;
}

/** One batch of screens. */
class NodeBatch extends Batch<{ placed: PlacedNode[]; ctx: NodeContext }> {
  render() {
    const { placed, ctx } = this.props;
    return (
      <>
        {placed.map(({ node, x, y, width, height }) => {
          const n = ctx.errors.get(node.id) ?? 0;
          const meta = [nodeMeta(node), n > 0 ? `${n} error${n === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
          return (
            <a
              key={node.id}
              class="map-node"
              href={hrefFor({ name: "screens", screen: node.id })}
              data-id={node.id}
              tabIndex={node.id === ctx.tabStop ? 0 : -1}
              aria-current={node.id === ctx.selected ? "true" : undefined}
              data-selected={node.id === ctx.selected ? "true" : "false"}
              data-linked={ctx.linked.has(node.id) ? "true" : "false"}
              data-proposed={node.proposed ? "true" : "false"}
              data-errors={n > 0 ? "true" : "false"}
              style={{ left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` }}
              onFocus={() => ctx.onFocus(node.id)}
              onClick={(e) => ctx.onClick(e, node.id)}
              onKeyDown={(e) => ctx.onKeyDown(e, node.id)}
            >
              <span class="map-node__id">{node.id}</span>
              <span class="map-node__meta">{meta}</span>
            </a>
          );
        })}
      </>
    );
  }
}

/** One batch of edges, less those of the selected screen (drawn last, over the others); none while only the selected screen's links are shown. */
class EdgeBatch extends Batch<{ placed: PlacedEdge[]; selected: string | null; hidden: boolean }> {
  render() {
    const { placed, selected, hidden } = this.props;
    if (hidden) return null;
    return (
      <>
        {placed
          .filter((p) => !incident(p.edge, selected))
          .map((p) => (
            <Edge key={p.edge.id} placed={p} on={false} />
          ))}
      </>
    );
  }
}

export function MapCanvas({ layout, selected, onlySelected, errors, select }: Props) {
  const canvas = useRef<HTMLDivElement>(null);
  // The node Tab reaches: the last one focused while it is on the map, else the selected one, else the first.
  const [active, setActive] = useState<string | null>(null);
  const has = (id: string | null) => id !== null && layout.nodes.some((p) => p.node.id === id);
  const tabStop = has(active) ? active : has(selected) ? selected : (layout.nodes[0]?.node.id ?? null);
  const linked = useMemo(() => {
    const out = new Set<string>();
    for (const e of layout.graph.edges) if (incident(e, selected)) out.add(e.from === selected ? e.to : e.from);
    return out;
  }, [layout, selected]);
  // How many frames of this layout are drawn: a batch more each frame, from the first for each new layout.
  const [progress, setProgress] = useState({ layout, frame: 0 });
  const frame = progress.layout === layout ? progress.frame : 0;
  const drawn = drawnAfter(frame, layout.nodes.length, layout.edges.length);
  const complete = drawn.nodes >= layout.nodes.length && drawn.edges >= layout.edges.length;
  useEffect(() => {
    if (complete) return;
    const id = requestAnimationFrame(() => setProgress({ layout, frame: frame + 1 }));
    return () => cancelAnimationFrame(id);
  }, [layout, frame, complete]);
  const nodeBatches = useMemo(() => chunks(layout.nodes, NODE_BATCH), [layout]);
  const edgeBatches = useMemo(() => chunks(layout.edges, EDGE_BATCH), [layout]);
  const highlighted = selected === null ? [] : layout.edges.filter((p) => incident(p.edge, selected));

  const focusNode = (id: string) => {
    const el = canvas.current?.querySelector<HTMLAnchorElement>(`a[data-id="${CSS.escape(id)}"]`);
    el?.focus();
  };

  const ctx = useMemo<NodeContext>(
    () => ({
      layout,
      selected,
      tabStop,
      linked,
      errors,
      onFocus(id) {
        setActive(id);
        select(id);
      },
      onClick(e, id) {
        // A click from the keyboard (Enter: detail 0), or one meant to open the
        // screen elsewhere, follows the link; a plain click selects.
        if (e.detail === 0 || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        select(id);
        e.currentTarget.focus();
      },
      onKeyDown(e, id) {
        const ends = { Home: layout.nodes[0], End: layout.nodes[layout.nodes.length - 1] } as const;
        const next = e.key === "Home" || e.key === "End" ? ends[e.key]?.node.id : neighbour(layout.nodes, id, e.key);
        if (!next) return;
        e.preventDefault();
        focusNode(next);
      },
    }),
    // focusNode reads only the canvas ref, which never changes.
    [layout, selected, tabStop, linked, errors, select],
  );

  return (
    <div class="map__scroll">
      <div ref={canvas} class="map__canvas" role="group" aria-label="App map" aria-describedby="map-help" style={{ width: `${layout.width}px`, height: `${layout.height}px` }}>
        {layout.lanes.map((l) => (
          <span key={l.key} class={l.named ? "map-lane" : "map-lane map-lane--none"} style={{ left: `${l.x}px`, width: `${l.width}px` }}>
            {l.area}
          </span>
        ))}
        <svg class="map__edges" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
          <defs>
            <Arrow id="map-arrow-idle" />
            <Arrow id="map-arrow-on" />
          </defs>
          {edgeBatches.slice(0, Math.ceil(drawn.edges / EDGE_BATCH)).map((b, i) => (
            <EdgeBatch key={i} placed={b} selected={selected} hidden={onlySelected && selected !== null} />
          ))}
          {highlighted.map((p) => (
            <Edge key={p.edge.id} placed={p} on={true} />
          ))}
        </svg>
        {nodeBatches.slice(0, Math.ceil(drawn.nodes / NODE_BATCH)).map((b, i) => (
          <NodeBatch key={i} placed={b} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}
