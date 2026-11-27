// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// @ references in a flow's text, read as core reads them
// (internal/flows.RefPattern): @screen.id or @screen.id#region, not inside
// an e-mail address or a run of @ or dots. The editor uses them for its
// autocomplete, its highlighting, the reference chips and the diagram's links.

import type { Region, Screen } from "@c65llc/starboard-core";

/** RefPattern, as in internal/flows: group 1 is what precedes the @, 2 the screen, 3 the region. */
const REF = /(^|[^\w@.])@([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)(?:#([a-z][a-z0-9-]*))?/g;

/** One reference; from and to are offsets into the text, around the @… itself. */
export interface Ref {
  screen: string;
  region: string;
  text: string;
  from: number;
  to: number;
}

/** findRefs lists the references in text, in order. */
export function findRefs(text: string): Ref[] {
  const out: Ref[] = [];
  for (const m of text.matchAll(REF)) {
    const from = (m.index ?? 0) + (m[1] ?? "").length;
    const ref = m[0].slice((m[1] ?? "").length);
    out.push({ screen: m[2] ?? "", region: m[3] ?? "", text: ref, from, to: from + ref.length });
  }
  return out;
}

/** uniqueRefs is findRefs with each reference once, where it first appears. */
export function uniqueRefs(text: string): Ref[] {
  const seen = new Set<string>();
  return findRefs(text).filter((r) => !seen.has(r.text) && Boolean(seen.add(r.text)));
}

/** What the autocomplete may offer at the cursor; from is where the replaced text starts. */
export type RefContext =
  | { kind: "screen"; from: number; typed: string }
  | { kind: "region"; screen: string; from: number; typed: string }
  | null;

const SCREEN_AT_END = /(?:^|[^\w@.])@([a-z0-9.-]*)$/;
const REGION_AT_END = /(?:^|[^\w@.])@([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)#([a-z0-9-]*)$/;

/**
 * refContext reads the text before the cursor on its line (before, which
 * starts at offset start in the document): after "@" it offers screens, and
 * after "@screen.id#" that screen's regions.
 */
export function refContext(before: string, start: number): RefContext {
  const region = REGION_AT_END.exec(before);
  if (region) {
    const typed = region[2] ?? "";
    return { kind: "region", screen: region[1] ?? "", from: start + before.length - typed.length, typed };
  }
  const screen = SCREEN_AT_END.exec(before);
  if (screen) {
    const typed = screen[1] ?? "";
    return { kind: "screen", from: start + before.length - typed.length, typed };
  }
  return null;
}

/** parseRefLabel reads a diagram node's label that is one reference and nothing else. */
export function parseRefLabel(label: string): { screen: string; region: string } | null {
  const text = label.trim();
  const refs = findRefs(text);
  const ref = refs[0];
  if (refs.length !== 1 || !ref || ref.from !== 0 || ref.to !== text.length) return null;
  return { screen: ref.screen, region: ref.region };
}

/** regionNames lists the names of a screen's regions across its layouts, each once, in order. */
export function regionNames(screen: Screen): string[] {
  const names = new Set<string>();
  const walk = (regions: Region[]) => {
    for (const r of regions) {
      if (r.name) names.add(r.name);
      walk(r.children);
      if (r.item) walk([r.item]);
    }
  };
  walk(screen.layout);
  for (const layout of Object.values(screen.layouts)) walk(layout);
  return [...names];
}
