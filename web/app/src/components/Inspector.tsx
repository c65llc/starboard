// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The inspector: the screen's fields and the selected region's, each one a
// `set` edit when it changes (on Enter, on leaving a text field, or on
// choosing an option). An emptied field removes its key. kind and
// presentation are selects of core.model's vocabularies; to is a combobox
// of the project's screen IDs.

import type { TargetedEvent } from "preact";
import { useRef } from "preact/hooks";
import type { Region, Screen } from "@c65llc/starboard-core";

import { regionName } from "../screens/logic.ts";

interface Props {
  screen: Screen;
  region: Region | null;
  kinds: string[];
  presentations: string[];
  screenIds: string[];
  /** set sets key on the region at path, or on the screen when path is "". */
  set(path: string, key: string, value: string | null): void;
}

interface TextProps {
  label: string;
  value: string;
  commit(value: string): void;
  list?: string;
  required?: boolean;
  hint?: string;
}

/**
 * TextField commits on Enter or on change, and only when the value differs.
 * Enter always commits a differing value, so pressing it again retries an
 * edit that was refused or reloaded. The change event the browser fires
 * when the field then loses focus does not commit what Enter just did (the
 * prop still holds the old value until the edit lands); typing again
 * clears that.
 */
function TextField({ label, value, commit, list, required, hint }: TextProps) {
  const sent = useRef<string | null>(null);
  const done = (e: TargetedEvent<HTMLInputElement>, enter: boolean) => {
    const next = e.currentTarget.value.trim();
    if (next === value || (!enter && next === sent.current)) return;
    if (required && next === "") {
      e.currentTarget.value = value;
      return;
    }
    sent.current = next;
    commit(next);
  };
  return (
    <label class="field">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        list={list}
        required={required}
        aria-describedby={hint ? `${list ?? label}-hint` : undefined}
        onInput={() => {
          sent.current = null;
        }}
        onChange={(e) => done(e, false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            done(e, true);
          }
        }}
      />
      {hint ? (
        <small class="field__hint" id={`${list ?? label}-hint`}>
          {hint}
        </small>
      ) : null}
    </label>
  );
}

function Select({ label, value, options, commit }: { label: string; value: string; options: string[]; commit(v: string): void }) {
  const all = options.includes(value) ? options : [value, ...options];
  return (
    <label class="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => commit(e.currentTarget.value)}>
        {all.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

const orNull = (v: string) => (v === "" ? null : v);

export function Inspector({ screen, region, kinds, presentations, screenIds, set }: Props) {
  const noSubmit = (e: Event) => e.preventDefault();
  return (
    <div class="inspector">
      <form class="inspector__form" aria-label="Screen" onSubmit={noSubmit} key={`screen:${screen.id}`}>
        <h2 class="inspector__title">Screen · {screen.id}</h2>
        <TextField label="Title" value={screen.title} required commit={(v) => set("", "title", v)} />
        <Select
          label="Presentation"
          value={screen.presentation}
          options={presentations}
          commit={(v) => set("", "presentation", v)}
        />
        <TextField label="Purpose" value={screen.purpose} commit={(v) => set("", "purpose", orNull(v))} />
      </form>

      {region ? (
        <form
          class="inspector__form"
          aria-label={`Region · ${regionName(region)}`}
          onSubmit={noSubmit}
          key={`region:${screen.id}:${region.path}:${region.line}`}
        >
          <h2 class="inspector__title">Region · {regionName(region)}</h2>
          {region.name ? (
            <TextField label="Name" value={region.name} required commit={(v) => set(region.path, "region", v)} />
          ) : null}
          <Select label="Kind" value={region.kind} options={kinds} commit={(v) => set(region.path, "kind", v)} />
          <TextField label="Label" value={region.label} commit={(v) => set(region.path, "label", orNull(v))} />
          <TextField
            label="Navigates to"
            value={region.to}
            list="inspector-screen-ids"
            hint="A screen ID; leave empty for none."
            commit={(v) => set(region.path, "to", orNull(v))}
          />
          <datalist id="inspector-screen-ids">
            {screenIds.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
          <TextField
            label="Requires capability"
            value={region.requires}
            commit={(v) => set(region.path, "requires", orNull(v))}
          />
          <fieldset class="inspector__status">
            <legend>Status</legend>
            {(["shipped", "proposed"] as const).map((st) => (
              <label key={st} class="radio">
                <input
                  type="radio"
                  name={`status-${region.path}`}
                  value={st}
                  checked={(region.status || "shipped") === st}
                  onChange={() => set(region.path, "status", st)}
                />{" "}
                {st === "shipped" ? "shipped" : "proposed — drawn dashed; an agent pass builds it"}
              </label>
            ))}
          </fieldset>
        </form>
      ) : (
        <p class="inspector__hint">Select a region in the layout to edit it.</p>
      )}
    </div>
  );
}
