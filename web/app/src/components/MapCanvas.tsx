// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app map's drawing: edges in an SVG (decoration, hidden from
// assistive technology: the table in MapTable says the same), and each
// screen an HTML link placed over it. A click, Space or focus selects a
// screen, each with its reason (src/map/centre.ts); Enter, or a click with
// a modifier, follows its link to the screen editor. The map is one Tab
// stop (a roving tabindex): arrow keys move to the nearest screen in that
// direction (src/map/nav.ts), Home and End to the first and last. The
// selected screen carries aria-current. Every text node is project content
// set as text.
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
//
// Zoom scales the canvas, at its layout size, with a CSS transform inside a
// sizer as large as the scaled drawing, so the box's scroll range is the
// drawing's and no layout runs. Every scroll here is the box's own, never
// the page's (scrollIntoView would scroll the page too, taking the header
// and Find out of view), and is worked out from the layout's places times
// the zoom: offsetLeft and its kin are unscaled under a transform.

import type { TargetedKeyboardEvent, TargetedMouseEvent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import type { SelectBy } from "../map/centre.ts";
import type { MapEdge } from "../map/graph.ts";
import { chunks, complete, EDGE_BATCH, firstDraw, redraw, step } from "../map/draw.ts";
import type { Drawn } from "../map/draw.ts";
import type { MapLayout, PlacedEdge, PlacedNode } from "../map/layout.ts";
import { nodeMeta } from "../map/layout.ts";
import { neighbour } from "../map/nav.ts";
import { centredScroll, clampZoom, fitZoom, NEW_VIEW_FLOOR, pinchZoom, revealScroll, stepZoom, wheelZoom, zoomAround } from "../map/zoom.ts";
import { hrefFor } from "../router.ts";
import { Batch } from "./Batch.ts";

export interface FocusRequest {
  id: string;
  centre?: boolean;
}

/**
 * A new view (src/views/AppMap.tsx): its zoom and scroll start again. At
 * 100%, with id (the centre, or the selection) in the middle of the box;
 * with fit, a drawing larger than the box is fitted instead, never below
 * NEW_VIEW_FLOOR. A new object for each request.
 */
export interface ViewRequest {
  id: string | null;
  fit: boolean;
}

/** How long a zoom step eases; none under prefers-reduced-motion. */
export const ZOOM_EASE_MS = 120;
/** The room a screen brought into view by the keyboard keeps from the box's edge. */
const REVEAL_MARGIN = 16;

/**
 * The room the map's box gives the drawing: its width, and the height it
 * may grow to, as it is only as tall as what it holds, up to its max-height.
 */
export function room(box: HTMLElement): { width: number; height: number } {
  const max = parseFloat(getComputedStyle(box).maxHeight);
  const frame = box.offsetHeight - box.clientHeight; // its borders, and a scrollbar
  return { width: box.clientWidth, height: Number.isFinite(max) ? Math.max(box.clientHeight, max - frame) : box.clientHeight };
}

/** The zoom that fits layout in box, or null while the box has no size (it is not shown): Fit then does nothing. */
export function fitIn(box: HTMLElement, layout: MapLayout, floor?: number): number | null {
  const r = room(box);
  if (!(r.width > 0 && r.height > 0)) return null;
  return fitZoom(r, layout, floor);
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Where a zoom keeps still: a point in the box's viewport (eased or not), or a screen to put in the middle afterwards (a new view). */
type Anchor = { kind: "point"; x: number; y: number; ease: boolean } | { kind: "centre"; id: string | null };

interface Props {
  layout: MapLayout;
  selected: string | null;
  onlySelected: boolean;
  errors: Map<string, number>;
  /** Selects id; by says how, so the map can tell a pick (which re-centres) from a move or a Tab (which may not). */
  select(id: string, by: SelectBy): void;
  /** A screen to move focus to, drawn first if it is not yet: a new object for each request. With centre, it is scrolled to the middle of the map's box. */
  focus?: FocusRequest | null;
  /** Called once focus has gone to the screen focus asked for, so the parent can clear it: a canvas made again would otherwise take focus again. */
  onFocused?(): void;
  /** The scale the drawing is shown at. */
  zoom: number;
  /** Asks for another zoom: the keys, Ctrl/⌘+wheel or a pinch (continuous), a new view. The canvas keeps what stays still as it changes. */
  onZoom(z: number, continuous?: boolean): void;
  /** A new view to show, once: AppMap passes one only with the layout it is for. */
  view?: ViewRequest | null;
  /** Called once view is shown, so the parent can clear it. */
  onViewed?(): void;
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

export function MapCanvas({ layout, selected, onlySelected, errors, select, focus = null, onFocused, zoom, onZoom, view = null, onViewed }: Props) {
  const canvas = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const sizer = useRef<HTMLDivElement>(null);
  // The node Tab reaches: the last one focused while it is on the map, else the selected one, else the first drawn.
  const [active, setActive] = useState<string | null>(null);
  // A screen to focus once it is drawn: from the keyboard, or the focus prop.
  const [pending, setPending] = useState<FocusRequest | null>(null);
  const handled = useRef<FocusRequest | null>(null);
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
  // The zoom the DOM shows: the prop's, or one between while a step eases.
  const shownZoom = useRef(zoom);
  // The zoom last asked for, so a second wheel notch before the next render goes on from the first.
  const zoomNow = useRef(zoom);
  zoomNow.current = zoom;
  const anchor = useRef<Anchor | null>(null);
  // The zoom being shown or eased to.
  const towards = useRef(zoom);
  const easing = useRef(0);
  // Ends a step that is easing at once, at its zoom and scroll, so a scroll
  // made now (a Find result centred, a screen brought into view, a drag) is
  // not overwritten by the step's next frame.
  const finishEase = useRef<(() => void) | null>(null);
  const settle = () => {
    cancelAnimationFrame(easing.current);
    const end = finishEase.current;
    finishEase.current = null;
    end?.();
  };
  useEffect(() => () => cancelAnimationFrame(easing.current), []);

  // What the handlers read, through a ref, so they never change.
  const now = useRef({ layout, select, onZoom });
  now.current = { layout, select, onZoom };
  const placed = (id: string | null) => (id === null ? undefined : now.current.layout.nodes.find((p) => p.node.id === id));
  const scrollTo = (to: { left: number; top: number }) => {
    const el = box.current;
    if (!el) return;
    el.scrollLeft = to.left;
    el.scrollTop = to.top;
  };
  const viewport = (el: HTMLElement) => ({ width: el.clientWidth, height: el.clientHeight });
  /** Puts screen id in the middle of the box, at the zoom shown. */
  const centreOn = (id: string | null) => {
    settle();
    const p = placed(id);
    if (p && box.current) scrollTo(centredScroll(viewport(box.current), p, shownZoom.current));
  };
  /** Brings screen id wholly into the box, at the zoom shown, by the least scroll. */
  const reveal = (id: string | null) => {
    settle();
    const p = placed(id);
    const el = box.current;
    if (p && el) scrollTo(revealScroll({ left: el.scrollLeft, top: el.scrollTop }, viewport(el), p, shownZoom.current, REVEAL_MARGIN));
  };
  /** Asks for zoom z, keeping a still; false if z is the zoom already. */
  const ask = (z: number, a: Anchor, continuous = false) => {
    const to = clampZoom(z);
    if (to === zoomNow.current) return false;
    anchor.current = a;
    zoomNow.current = to;
    now.current.onZoom(to, continuous);
    return true;
  };

  // The asked-for screen is drawn in this commit (it is in must): focus it now.
  // Centring is here, not with the request, so it also runs for a screen that
  // had to be drawn first. Focus never scrolls (preventScroll): the box is
  // scrolled instead, so the page stays put. It jumps: a smooth scroll would
  // move under prefers-reduced-motion, and a jump is as clear.
  useLayoutEffect(() => {
    if (!target) return;
    // AppMap passes a request only with the layout of the current model and
    // filters, so a screen missing from it is one they exclude: the request
    // goes now, and cannot take focus when a later filter shows the screen.
    const el = nodeEl(target.id);
    if (el) {
      el.focus({ preventScroll: true });
      if (target.centre) centreOn(target.id);
      else reveal(target.id);
    }
    if (target === pending) setPending(null);
    else {
      handled.current = target;
      onFocused?.();
    }
  });

  // A new view, then the zoom. A new view asks for its zoom and, if that is
  // another, waits for it to be rendered (the sizer at its size) to scroll.
  // A new layout that is no new view (a filter, a level, an arrow's
  // re-centre under Every selection) keeps the zoom and brings the selection
  // into view, as it may have moved.
  const viewed = useRef<ViewRequest | null>(null);
  const laidOut = useRef<MapLayout | null>(null);
  const size = useRef(layout);
  size.current = layout;
  useLayoutEffect(() => {
    const el = box.current;
    const inner = canvas.current;
    const outer = sizer.current;
    if (!el || !inner || !outer) return;
    const relaid = laidOut.current !== null && laidOut.current !== layout;
    laidOut.current = layout;
    if (view && view !== viewed.current) {
      viewed.current = view;
      onViewed?.();
      const r = room(el);
      const large = layout.width > r.width || layout.height > r.height;
      const z = view.fit && r.width > 0 && r.height > 0 && large ? fitZoom(r, layout, NEW_VIEW_FLOOR) : 1;
      anchor.current = { kind: "centre", id: view.id };
      // Another zoom waits for its render to centre. A Ctrl+wheel or a key
      // in between replaces this anchor, so the newer input wins over the
      // new view's centring: the viewer has already moved on.
      if (ask(z, anchor.current)) return;
    } else if (relaid && !anchor.current) {
      reveal(selected);
    }

    const from = shownZoom.current;
    const a = anchor.current;
    // A render while a step eases (a batch drawn) leaves it to finish.
    if (!a && zoom === towards.current) return;
    towards.current = zoom;
    anchor.current = null;
    cancelAnimationFrame(easing.current);
    finishEase.current = null;
    const origin = { left: el.scrollLeft, top: el.scrollTop };
    const still = a?.kind === "point" ? a : { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    // Set here, not left to the render, as a step eases through the zooms between.
    const show = (z: number) => {
      shownZoom.current = z;
      outer.style.width = `${size.current.width * z}px`;
      outer.style.height = `${size.current.height * z}px`;
      inner.style.transform = `scale(${z})`;
      if (a?.kind !== "centre") scrollTo(zoomAround(origin, still, from, z));
    };
    if (a?.kind === "centre" || (a?.kind === "point" && !a.ease) || from === zoom || reducedMotion()) {
      show(zoom);
      if (a?.kind === "centre") centreOn(a.id);
      return;
    }
    const start = performance.now();
    finishEase.current = () => show(zoom);
    const tick = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - start) / ZOOM_EASE_MS));
      show(k === 1 ? zoom : from + (zoom - from) * (1 - (1 - k) ** 3));
      if (k < 1) easing.current = requestAnimationFrame(tick);
      else finishEase.current = null;
    };
    easing.current = requestAnimationFrame(tick);
  });

  // A Safari pinch under way (gesturestart to gestureend): a Ctrl+wheel then
  // may be the same pinch sent twice, so it is stopped and does not zoom.
  const gesturing = useRef(false);

  // Ctrl/⌘+wheel (a trackpad pinch comes as one) zooms around the pointer;
  // a plain wheel is left to scroll the box. Not passive, so it can stop
  // the browser zooming the page.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (gesturing.current) return;
      const r = el.getBoundingClientRect();
      ask(wheelZoom(zoomNow.current, e.deltaY, e.deltaMode), { kind: "point", x: e.clientX - r.left - el.clientLeft, y: e.clientY - r.top - el.clientTop, ease: false }, true);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
    // ask reads through refs only.
  }, []);

  // macOS Safari sends a trackpad pinch as gesture events, not Ctrl+wheel:
  // gesturechange's scale is from gesturestart, so the zoom is the start's
  // times it, around the gesture's point. Each is stopped, or Safari zooms
  // the page. Only where GestureEvent exists; elsewhere nothing listens.
  useEffect(() => {
    const el = box.current;
    if (!el || !("GestureEvent" in globalThis)) return;
    type Gesture = Event & { scale?: number; clientX?: number; clientY?: number };
    let start = zoomNow.current;
    const begin = (e: Event) => {
      e.preventDefault();
      gesturing.current = true;
      start = zoomNow.current;
    };
    const change = (e: Gesture) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const x = (e.clientX ?? r.left + el.clientWidth / 2) - r.left - el.clientLeft;
      const y = (e.clientY ?? r.top + el.clientHeight / 2) - r.top - el.clientTop;
      ask(pinchZoom(start, e.scale ?? 1), { kind: "point", x, y, ease: false }, true);
    };
    const end = (e: Event) => {
      e.preventDefault();
      gesturing.current = false;
    };
    // WebKit has no gesture cancel event; a pinch that never sends gestureend (the window losing focus) must not leave the wheel off.
    const lost = () => {
      gesturing.current = false;
    };
    const opts = { passive: false } as const;
    el.addEventListener("gesturestart", begin, opts);
    el.addEventListener("gesturechange", change, opts);
    el.addEventListener("gestureend", end, opts);
    el.addEventListener("pointerleave", lost);
    addEventListener("blur", lost);
    return () => {
      el.removeEventListener("pointerleave", lost);
      removeEventListener("blur", lost);
      el.removeEventListener("gesturestart", begin);
      el.removeEventListener("gesturechange", change);
      el.removeEventListener("gestureend", end);
    };
    // ask reads through refs only.
  }, []);

  // The zoom keys, while focus is on the map's drawing (its screens): never
  // with Ctrl, ⌘ or Alt, which are the browser's zoom. The focused screen
  // keeps still, so the keyboard's place stays in view.
  const onKeys = (e: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = box.current;
    if (!el) return;
    const z = zoomNow.current;
    const key = e.key;
    const to = key === "+" || key === "=" ? stepZoom(z, 1) : key === "-" ? stepZoom(z, -1) : key === "0" ? 1 : key === "f" || key === "F" ? fitIn(el, now.current.layout) : undefined;
    if (to === undefined) return;
    e.preventDefault();
    if (to === null) return;
    const at = e.target instanceof HTMLElement ? placed(e.target.getAttribute("data-id")) : undefined;
    const point = at
      ? {
          x: Math.min(el.clientWidth, Math.max(0, (at.x + at.width / 2) * shownZoom.current - el.scrollLeft)),
          y: Math.min(el.clientHeight, Math.max(0, (at.y + at.height / 2) * shownZoom.current - el.scrollTop)),
        }
      : { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    ask(to, { kind: "point", ...point, ease: true });
  };

  // A drag on the background (not on a screen, nor a scrollbar; the primary
  // button of a mouse or pen: touch scrolls the box itself) pans the box by
  // its scroll. Under 4 px it is a click, which does nothing there.
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; moving: boolean } | null>(null);
  const onPointerDown = (e: PointerEvent) => {
    const el = box.current;
    if (!el || e.button !== 0 || e.pointerType === "touch") return;
    if (e.target instanceof Element && e.target.closest("a.map-node")) return;
    const r = el.getBoundingClientRect();
    if (e.clientX - r.left - el.clientLeft >= el.clientWidth || e.clientY - r.top - el.clientTop >= el.clientHeight) return;
    settle();
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moving: false };
  };
  // A drag lasts only while its button is held: a release the box never saw
  // (outside it, before capture) must not leave a hover that pans.
  const drop = () => {
    drag.current = null;
    box.current?.removeAttribute("data-panning");
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    const el = box.current;
    if (!d || !el || e.pointerId !== d.id) return;
    if (!(e.buttons & 1)) {
      drop();
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moving) {
      if (Math.hypot(dx, dy) < 4) return;
      d.moving = true;
      el.setPointerCapture(e.pointerId);
      el.setAttribute("data-panning", "");
      getSelection()?.removeAllRanges();
    }
    e.preventDefault();
    el.scrollLeft = d.left - dx;
    el.scrollTop = d.top - dy;
  };
  const onPointerEnd = (e: PointerEvent) => {
    const d = drag.current;
    if (d && e.pointerId === d.id) drop();
  };
  // Leaving the box before the drag has captured the pointer ends it: the release may come outside.
  const onPointerLeave = (e: PointerEvent) => {
    const d = drag.current;
    if (d && e.pointerId === d.id && !d.moving) drop();
  };

  // What the screens' links call; it reads the current layout and select through now, so it never changes.
  // The screen an arrow, Home or End just sent focus to, so its focus reads as a move, not a Tab.
  // It waits here while the screen is drawn first (pending), as focus then comes a commit later.
  const movedTo = useRef<string | null>(null);
  const on = useMemo<Handlers>(
    () => ({
      onFocus(id) {
        const by: SelectBy = movedTo.current === id ? "move" : "tab";
        movedTo.current = null;
        setActive(id);
        now.current.select(id, by);
      },
      onClick(e, id) {
        // A click from the keyboard (Enter: detail 0), or one meant to open the
        // screen elsewhere, follows the link; a plain click selects.
        if (e.detail === 0 || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        now.current.select(id, "pick");
        e.currentTarget.focus({ preventScroll: true });
      },
      onKeyDown(e, id) {
        // Space is the keyboard's pick (a link would otherwise scroll the page).
        if (e.key === " " && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          now.current.select(id, "pick");
          return;
        }
        const nodes = now.current.layout.nodes;
        const ends = { Home: nodes[0], End: nodes[nodes.length - 1] } as const;
        const next = e.key === "Home" || e.key === "End" ? ends[e.key]?.node.id : neighbour(nodes, id, e.key);
        if (!next) return;
        e.preventDefault();
        // An arrow that finds no other screen fires no focus, so it must not leave a move waiting for a later Tab.
        movedTo.current = next === id ? null : next;
        const el = nodeEl(next);
        if (el) {
          el.focus({ preventScroll: true });
          reveal(next);
        } else setPending({ id: next }); // drawn, then focused, then brought into view (the layout effect above)
      },
    }),
    // nodeEl and reveal read only refs, which never change.
    [],
  );

  return (
    <div ref={box} class="map__scroll" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onPointerLeave={onPointerLeave} onLostPointerCapture={onPointerEnd}>
      <div ref={sizer} class="map__sizer" style={{ width: `${layout.width * shownZoom.current}px`, height: `${layout.height * shownZoom.current}px` }}>
        <div
          ref={canvas}
          class="map__canvas"
          role="group"
          aria-label="App map"
          aria-describedby="map-help"
          onKeyDown={onKeys}
          style={{ width: `${layout.width}px`, height: `${layout.height}px`, transform: `scale(${shownZoom.current})` }}
        >
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
    </div>
  );
}
