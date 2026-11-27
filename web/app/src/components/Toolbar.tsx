// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The screen's toolbar: a tab per form factor (marked when it has its own
// layout) and the Source tab, Override layout for a form factor drawn from
// the default layout, and the status line saying what the last change
// came to. Left and Right move between the tabs, as the APG tabs pattern
// has it.

import type { TargetedKeyboardEvent } from "preact";

export interface TabSpec {
  id: string;
  label: string;
}

interface Props {
  tabs: TabSpec[];
  current: string;
  panel: string;
  onTab(id: string): void;
  /** Shown when the current form factor uses the default layout. */
  override?: { formFactor: string; run(): void } | undefined;
  status: string | null;
}

export const tabId = (id: string) => `screen-tab-${id}`;

export function Toolbar({ tabs, current, panel, onTab, override, status }: Props) {
  const onKeyDown = (e: TargetedKeyboardEvent<HTMLButtonElement>, at: number) => {
    const by = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (at + by + tabs.length) % tabs.length;
    if (by === 0 && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = tabs[to];
    if (!next) return;
    onTab(next.id);
    document.getElementById(tabId(next.id))?.focus();
  };
  return (
    <div class="toolbar">
      <div class="toolbar__tabs" role="tablist" aria-label="View">
        {tabs.map((t, at) => (
          <button
            key={t.id}
            id={tabId(t.id)}
            type="button"
            role="tab"
            class="tab"
            aria-selected={t.id === current ? "true" : "false"}
            aria-controls={panel}
            tabIndex={t.id === current ? 0 : -1}
            onClick={() => onTab(t.id)}
            onKeyDown={(e) => onKeyDown(e, at)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {override ? (
        <button type="button" class="button button--small button--dashed" onClick={override.run}>
          <span aria-hidden="true">+</span> Override layout for {override.formFactor}
        </button>
      ) : null}
      <p class="toolbar__status" role="status">
        {status ?? ""}
      </p>
    </div>
  );
}
