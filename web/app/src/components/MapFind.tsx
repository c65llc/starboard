// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Find a screen, in the app map's header: the WAI-ARIA combobox pattern,
// an input with a listbox popup. Keyboard focus stays in the input; the
// active option is aria-activedescendant, so a screen reader follows the
// arrow keys without the input losing the caret. The first match is
// active as soon as there is one, so typing then Enter jumps to the best
// match. It lives outside map__body, so its Escape never reaches the
// map's Escape-clears-selection; it stops the key anyway, in case the
// header ever moves inside.

import type { MapNode } from "../map/graph.ts";
import { findScreens } from "../map/find.ts";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { TargetedKeyboardEvent } from "preact";

interface Props {
  nodes: MapNode[];
  choose(id: string): void;
  /** When no screen passes the map's filters there is nothing to find. */
  disabled?: boolean;
}

const LIST = "map-find-list";
const optionId = (i: number) => `map-find-option-${i}`;
const said = (query: string, n: number) => (query.trim() === "" ? "" : n === 0 ? "No screens match" : `${n} screen${n === 1 ? "" : "s"}`);

export function MapFind({ nodes, choose, disabled = false }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => findScreens(nodes, query), [nodes, query]);
  const shown = open && results.length > 0;
  const at = Math.min(active, results.length - 1);
  const list = useRef<HTMLUListElement>(null);
  // The list scrolls when it holds more than fits: keep the active option in sight.
  useLayoutEffect(() => {
    if (shown) list.current?.querySelector(`[id="${optionId(at)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [shown, at]);

  const pick = (id: string) => {
    setQuery("");
    setOpen(false);
    setActive(0);
    choose(id);
  };
  const onKeyDown = (e: TargetedKeyboardEvent<HTMLInputElement>) => {
    // Read from the input, not state: a key can follow its input event before a render.
    const now = findScreens(nodes, e.currentTarget.value);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (now.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      // Opening, Down starts at the first option and Up at the last, as the pattern has it.
      setActive(open ? (Math.min(active, now.length - 1) + step + now.length) % now.length : step === 1 ? 0 : now.length - 1);
      setOpen(true);
    } else if (e.key === "Enter") {
      // An IME's Enter commits the composition; it is not a choice.
      if (e.isComposing) return;
      const hit = now[Math.max(0, Math.min(active, now.length - 1))];
      if (!hit) return;
      e.preventDefault();
      pick(hit.id);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      if (query === "" && !open && e.currentTarget.value === "") return;
      e.preventDefault();
      setQuery("");
      setOpen(false);
      setActive(0);
    }
  };

  return (
    <div class="map-find">
      <label class="map__filter" for="map-find">
        Find a screen
      </label>
      <div class="map-find__box">
        <input
          id="map-find"
          class="map-find__input"
          type="text"
          role="combobox"
          autocomplete="off"
          spellcheck={false}
          aria-autocomplete="list"
          aria-expanded={shown ? "true" : "false"}
          aria-controls={LIST}
          aria-activedescendant={shown ? optionId(at) : undefined}
          value={query}
          disabled={disabled}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setActive(0);
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {/* Always in the page, so aria-controls always names an element; hidden while closed. */}
        <ul ref={list} id={LIST} class="map-find__list" role="listbox" aria-label="Find a screen" hidden={!shown}>
          {(shown ? results : []).map((n, i) => (
            <li
              key={n.id}
              id={optionId(i)}
              class="map-find__option"
              role="option"
              aria-selected={i === at ? "true" : "false"}
              // The input keeps focus, so the choice moves it to the screen once, from here.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(n.id)}
            >
              <span class="map-find__title">{n.title}</span> <code class="map-find__id">{n.id}</code>
            </li>
          ))}
        </ul>
      </div>
      {/* Says how many matched, for a screen reader, which hears only the active option otherwise. */}
      <p class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {said(query, results.length)}
      </p>
    </div>
  );
}
