// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The layout as an ARIA tree, one tab stop: Up and Down move focus, Home
// and End go to either end, Left goes to the parent and Right to the first
// child, Enter or Space selects, and Alt+Up or Alt+Down moves the region
// within its list. Rows are keyed by path, so after a move the row at the
// region's new path keeps focus.

import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { TargetedKeyboardEvent } from "preact";

import { moveTarget, regionName } from "../screens/logic.ts";
import type { TreeRow } from "../screens/logic.ts";

interface Props {
  label: string;
  rows: TreeRow[];
  selected: string | undefined;
  onSelect(path: string): void;
  onMove(row: TreeRow, by: -1 | 1): void;
}

export function RegionTree({ label, rows, selected, onSelect, onMove }: Props) {
  const [focused, setFocused] = useState<string | undefined>(undefined);
  const wantFocus = useRef(false);
  const tree = useRef<HTMLUListElement>(null);
  const active = rows.some((r) => r.region.path === focused) ? focused : (selected ?? rows[0]?.region.path);

  useLayoutEffect(() => {
    if (!wantFocus.current || !active) return;
    wantFocus.current = false;
    const el = tree.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(active)}"]`);
    el?.focus();
  });

  const focusRow = (at: number) => {
    const row = rows[at];
    if (!row) return;
    wantFocus.current = true;
    setFocused(row.region.path);
  };

  const onKeyDown = (e: TargetedKeyboardEvent<HTMLElement>, at: number) => {
    const row = rows[at];
    if (!row) return;
    let handled = true;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const by = e.key === "ArrowUp" ? -1 : 1;
      const to = moveTarget(row, by);
      if (to) {
        // Focus follows the region to its new path, where its row is keyed once the model catches up.
        wantFocus.current = true;
        setFocused(to.path);
        onMove(row, by);
      }
    } else if (e.key === "ArrowDown") focusRow(at + 1);
    else if (e.key === "ArrowUp") focusRow(at - 1);
    else if (e.key === "Home") focusRow(0);
    else if (e.key === "End") focusRow(rows.length - 1);
    else if (e.key === "ArrowLeft") focusRow(row.parent);
    else if (e.key === "ArrowRight") {
      if (rows[at + 1]?.parent === at) focusRow(at + 1);
    } else if (e.key === "Enter" || e.key === " ") onSelect(row.region.path);
    else handled = false;
    if (handled) e.preventDefault();
  };

  if (rows.length === 0) return <p class="region-tree__empty">This layout has no regions yet.</p>;
  return (
    <ul class="region-tree" role="tree" aria-label={label} ref={tree}>
      {rows.map((row, at) => {
        const path = row.region.path;
        return (
          <li
            key={path}
            role="treeitem"
            class={`region-tree__row region-tree__row--depth-${Math.min(row.depth, 6)}`}
            data-path={path}
            aria-level={row.depth + 1}
            aria-setsize={row.count}
            aria-posinset={row.index + 1}
            aria-selected={path === selected ? "true" : "false"}
            tabIndex={path === active ? 0 : -1}
            onClick={() => {
              setFocused(path);
              onSelect(path);
            }}
            onFocus={() => setFocused(path)}
            onKeyDown={(e) => onKeyDown(e, at)}
          >
            <span class={row.region.name ? "region-tree__name" : "region-tree__name region-tree__name--item"}>
              {regionName(row.region)}
            </span>{" "}
            <span class="region-tree__kind">{row.region.kind}</span>
          </li>
        );
      })}
    </ul>
  );
}
