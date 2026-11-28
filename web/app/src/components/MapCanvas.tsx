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
// (src/map/draw.ts), each batch with its own style and layout. Each screen
// and each batch of edges is a Batch, rendered again only when its own
// props change, so a frame renders only what it adds (#22).
//
// Some screens are drawn whatever the batch has reached: the selected one
// (with its edges), the one last focused, and one asked to take focus (by
// the keyboard, or the panel's links); so a focus never lands on a screen
// not yet drawn. A new layout keeps every screen already drawn that is
// still in it, so the screens are moved, not made again, and a focused
// screen keeps its focus.

import type { TargetedKeyboardEvent, TargetedMouseEvent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import type { MapEdge } from "../map/graph.ts";
import { chunks, complete, EDGE_BATCH, firstDraw, redraw, step } from "../map/draw.ts";
import type { Drawn } from "../map/draw.ts";
import type { MapLayout, PlacedEdge, PlacedNode } from "../map/layout.ts";
import { nodeMeta } from "../map/layout.ts";
import { neighbour } from "../map/nav.ts";
import { hrefFor } from "../router.ts";
import { Batch } from "./Batch.ts";

export interface FocusRequest {
  id: string;
  centre?: boolean;
}

interface Props {
  layout: MapLayout;
  selected: string | null;
  onlySelected: boolean;
  errors: Map<string, number>;
  select(id: string): void;
  /** A screen to move focus to, drawn first if it is not yet: a new object for each request. With centre, it is scrolled to the middle of the map's box. */
  focus?: FocusRequest | null;
  /** Called once focus has gone to the screen focus asked for, so the parent can clear it: a canvas made again would otherwise take focus again. */
  onFocused?(): void;
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

/** What a screen's link calls on the map; the same object for the canvas's whole life. */
interface Handlers {
  onFocus(id: string): void;
  onClick(e: TargetedMouseEvent<HTMLAnchorElement>, id: string): void;
  onKeyDown(e: TargetedKeyboardEvent<HTMLAnchorElement>, id: string): void;
}

interface NodeProps {
  placed: PlacedNode;
  selected: boolean;
  linked: boolean;
  tabStop: boolean;
  errors: number;
  on: Handlers;
}

/** One screen. */
class MapNodeView extends Batch<NodeProps> {
  readonly kind = "node";
  render() {
    const { placed, selected, linked, tabStop, errors, on } = this.props;
    const { node, x, y, width, height } = placed;
    const meta = [nodeMeta(node), errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
    return (
      <a
        class="map-node"
        href={hrefFor({ name: "screens", screen: node.id })}
        data-id={node.id}
        tabIndex={tabStop ? 0 : -1}
        aria-current={selected ? "true" : undefined}
        data-selected={selected ? "true" : "false"}
        data-linked={linked ? "true" : "false"}
        data-proposed={node.proposed ? "true" : "false"}
        data-errors={errors > 0 ? "true" : "false"}
        style={{ left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` }}
        onFocus={() => on.onFocus(node.id)}
        onClick={(e) => on.onClick(e, node.id)}
        onKeyDown={(e) => on.onKeyDown(e, node.id)}
      >
        <span class="map-node__id">{node.id}</span>
        <span class="map-node__meta">{meta}</span>
      </a>
    );
  }
}

/** One batch of edges, less those of the selected screen (drawn last, over the others); none while only the selected screen's links are shown. */
class EdgeBatch extends Batch<{ placed: PlacedEdge[]; selected: string | null; hidden: boolean }> {
  readonly kind = "edges";
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

export function MapCanvas({ layout, selected, onlySelected, errors, select, focus = null, onFocused }: Props) {
  const canvas = useRef<HTMLDivElement>(null);
  // The node Tab reaches: the last one focused while it is on the map, else the selected one, else the first drawn.
  const [active, setActive] = useState<string | null>(null);
  // A screen to focus once it is drawn: from the keyboard, or the focus prop.
  const [pending, setPending] = useState<FocusRequest | null>(null);
  const handled = useRef<FocusRequest | null>(null);
  // A focus request whose screen the layout it arrived with lacks, and that layout.
  const waiting = useRef<{ request: FocusRequest; layout: MapLayout } | null>(null);
  const target = pending ?? (focus && focus !== handled.current ? focus : null);

  const order = useMemo(() => layout.nodes.map((p) => p.node.id), [layout]);
  // What is drawn: from the first batch for a first layout, and from what was drawn for a new one.
  const [progress, setProgress] = useState<{ layout: MapLayout; drawn: Drawn }>(() => ({ layout, drawn: firstDraw(order) }));
  const base = useMemo(() => (progress.layout === layout ? progress.drawn : redraw(progress.drawn, order)), [progress, layout, order]);
  const must = [selected, active, target?.id ?? null].filter((id): id is string => id !== null);
  const shown = new Set(base.nodes);
  for (const id of must) if (layout.nodes.some((p) => p.node.id === id)) shown.add(id);
  const done = complete(base, order, layout.edges.length);
  const mustNow = useRef(must);
  mustNow.current = must;
  useEffect(() => {
    if (done) {
      if (progress.layout !== layout) setProgress({ layout, drawn: base });
      return;
    }
    const id = requestAnimationFrame(() => setProgress({ layout, drawn: step(base, order, layout.edges.length, mustNow.current) }));
    return () => cancelAnimationFrame(id);
  }, [layout, order, base, done, progress]);

  const has = (id: string | null) => id !== null && shown.has(id);
  const tabStop = has(active) ? active : has(selected) ? selected : (order.find((id) => shown.has(id)) ?? null);
  const linked = useMemo(() => {
    const out = new Set<string>();
    for (const e of layout.graph.edges) if (incident(e, selected)) out.add(e.from === selected ? e.to : e.from);
    return out;
  }, [layout, selected]);
  const edgeBatches = useMemo(() => chunks(layout.edges, EDGE_BATCH), [layout]);
  const highlighted = selected === null ? [] : layout.edges.filter((p) => incident(p.edge, selected));

  const nodeEl = (id: string) => canvas.current?.querySelector<HTMLAnchorElement>(`a[data-id="${CSS.escape(id)}"]`) ?? null;
  // The asked-for screen is drawn in this commit (it is in must): focus it now.
  // Centring is here, not with the request, so it also runs for a screen that
  // had to be drawn first. It sets the map box's own scroll: scrollIntoView
  // would scroll the page too, taking the header and Find out of view. It
  // jumps: a smooth scroll would move under prefers-reduced-motion, and a
  // jump is as clear.
  useLayoutEffect(() => {
    if (!target) return;
    const el = nodeEl(target.id);
    if (!el && target !== pending) {
      // Not in this layout: Find lists a new filter's screens before the
      // worker lays them out, so the request waits for the next layout. If
      // that one lacks it too, the filters moved on and the request goes,
      // so it cannot take focus from whatever the person does later.
      if (waiting.current?.request !== target) waiting.current = { request: target, layout };
      else if (waiting.current.layout !== layout) {
        handled.current = target;
        onFocused?.();
      }
      return;
    }
    const box = canvas.current?.parentElement;
    if (el && box && target.centre) {
      el.focus({ preventScroll: true });
      // The node's left and top are its place on the canvas, which fills the box's scrolled area from its origin.
      box.scrollLeft = el.offsetLeft + el.offsetWidth / 2 - box.clientWidth / 2;
      box.scrollTop = el.offsetTop + el.offsetHeight / 2 - box.clientHeight / 2;
    } else el?.focus();
    if (target === pending) setPending(null);
    else {
      handled.current = target;
      onFocused?.();
    }
  });

  // What the screens' links call; it reads the current layout and select through a ref, so it never changes.
  const now = useRef({ layout, select });
  now.current = { layout, select };
  const on = useMemo<Handlers>(
    () => ({
      onFocus(id) {
        setActive(id);
        now.current.select(id);
      },
      onClick(e, id) {
        // A click from the keyboard (Enter: detail 0), or one meant to open the
        // screen elsewhere, follows the link; a plain click selects.
        if (e.detail === 0 || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        now.current.select(id);
        e.currentTarget.focus();
      },
      onKeyDown(e, id) {
        const nodes = now.current.layout.nodes;
        const ends = { Home: nodes[0], End: nodes[nodes.length - 1] } as const;
        const next = e.key === "Home" || e.key === "End" ? ends[e.key]?.node.id : neighbour(nodes, id, e.key);
        if (!next) return;
        e.preventDefault();
        const el = nodeEl(next);
        if (el) el.focus();
        else setPending({ id: next }); // drawn, then focused (the layout effect above)
      },
    }),
    // nodeEl reads only the canvas ref, which never changes.
    [],
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
          {edgeBatches.slice(0, Math.ceil(base.edges / EDGE_BATCH)).map((b, i) => (
            <EdgeBatch key={i} placed={b} selected={selected} hidden={onlySelected && selected !== null} />
          ))}
          {highlighted.map((p) => (
            <Edge key={p.edge.id} placed={p} on={true} />
          ))}
        </svg>
        {layout.nodes
          .filter((p) => shown.has(p.node.id))
          .map((p) => (
            <MapNodeView
              key={p.node.id}
              placed={p}
              selected={p.node.id === selected}
              linked={linked.has(p.node.id)}
              tabStop={p.node.id === tabStop}
              errors={errors.get(p.node.id) ?? 0}
              on={on}
            />
          ))}
      </div>
    </div>
  );
}
