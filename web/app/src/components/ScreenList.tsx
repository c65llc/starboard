// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The screen list: every screen grouped by area, filtered by text or
// status:proposed, and windowed so a project of hundreds of screens draws
// only the rows in view. Rows are plain links in a list, one tab stop
// each; focusing one scrolls it into view, which draws the rows beyond it,
// so Tab walks the whole list.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { Screen } from "@c65llc/starboard-core";

import { hrefFor } from "../router.ts";
import { listRows, proposedAnywhere, visibleRange } from "../screens/logic.ts";

/** Each row's height in pixels; app.css's .screen-list__row matches it. */
const ROW = 32;

interface Props {
  screens: Screen[];
  current: string | undefined;
  /** IDs of the screens with lint errors. */
  withErrors: ReadonlySet<string>;
  /** Shown above the filter: New screen. */
  actions?: ComponentChildren;
}

export function ScreenList({ screens, current, withErrors, actions }: Props) {
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => listRows(screens, query), [screens, query]);
  const { first, last } = visibleRange(scrollTop, viewport, ROW, rows.length);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || 600);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Bring the current screen into view when it changes from elsewhere (a
  // lint finding, say); not on every edit, which rebuilds rows but leaves
  // the list where the user scrolled it.
  const shownFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    const el = scroller.current;
    const at = rows.findIndex((r) => r.kind === "screen" && r.screen.id === current);
    if (!el || at < 0 || shownFor.current === current) return;
    shownFor.current = current;
    const top = at * ROW;
    if (top < el.scrollTop || top + ROW > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2);
      setScrollTop(el.scrollTop);
    }
  }, [current, rows]);

  const shown = rows.slice(first, last);
  return (
    <nav class="screen-list" aria-label="Screens">
      {actions ? <div class="screen-list__actions">{actions}</div> : null}
      <label class="field screen-list__filter">
        <span>Filter screens</span>
        <input
          type="search"
          value={query}
          placeholder="trip.  or  status:proposed"
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </label>
      <p class="visually-hidden" role="status">
        {query ? `${rows.filter((r) => r.kind === "screen").length} screens match` : ""}
      </p>
      {rows.length === 0 ? (
        <p class="screen-list__empty">{screens.length === 0 ? "No screens yet." : "No screens match the filter."}</p>
      ) : null}
      <div class="screen-list__scroll" ref={scroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <ul class="screen-list__rows" style={{ height: `${rows.length * ROW}px` }}>
          {shown.map((row, i) => {
            const at = first + i;
            const style = { top: `${at * ROW}px` };
            // Only a window of the rows exists, so each says where it sits in the whole list.
            const place = { "aria-setsize": rows.length, "aria-posinset": at + 1 };
            if (row.kind === "area") {
              return (
                <li key={`area:${row.area}`} class="screen-list__row screen-list__area" style={style} {...place}>
                  {row.area}
                </li>
              );
            }
            const s = row.screen;
            const badge = withErrors.has(s.id) ? "error" : proposedAnywhere(s) ? "proposed" : "";
            return (
              <li key={s.id} class="screen-list__row" style={style} {...place}>
                <a
                  class={`screen-list__link${badge ? ` screen-list__link--${badge}` : ""}`}
                  href={hrefFor({ name: "screens", screen: s.id })}
                  aria-current={s.id === current ? "page" : undefined}
                >
                  <span class="screen-list__id">{s.id}</span>
                  {badge ? (
                    <>
                      {" "}
                      <span class="screen-list__badge">{badge}</span>
                    </>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
