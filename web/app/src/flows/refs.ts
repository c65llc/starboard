// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// @ references in a flow's text, read with core's own pattern
// (model.refPattern, internal/flows.RefPattern): @screen.id or
// @screen.id#region, not inside an e-mail address or a run of @ or dots.
// Every regular expression here is derived from it, never restated, so the
// editor's autocomplete, highlighting, chips and diagram links read
// references exactly as lint does.

import type { Region, Screen } from "@c65llc/starboard-core";

/** A compiled reference pattern: group 1 precedes the @, 2 is the screen, 3 the region. */
export interface RefSyntax {
  readonly pattern: string;
  /** The pattern, global, for matchAll and CodeMirror's MatchDecorator. */
  readonly all: RegExp;
}

const compiled = new Map<string, RefSyntax>();

/** refSyntax compiles core's refPattern, once per pattern. */
export function refSyntax(pattern: string): RefSyntax {
  let s = compiled.get(pattern);
  if (!s) {
    // An empty pattern (no model yet) must match nothing, not everywhere.
    s = { pattern, all: new RegExp(pattern === "" ? "(?!)" : pattern, "g") };
    compiled.set(pattern, s);
  }
  return s;
}

/** One reference; from and to are offsets into the text, around the @… itself. */
export interface Ref {
  screen: string;
  region: string;
  text: string;
  from: number;
  to: number;
}

/** findRefs lists the references in text, in order. */
export function findRefs(text: string, syntax: RefSyntax): Ref[] {
  const out: Ref[] = [];
  for (const m of text.matchAll(syntax.all)) {
    const lead = (m[1] ?? "").length;
    const from = (m.index ?? 0) + lead;
    const ref = m[0].slice(lead);
    out.push({ screen: m[2] ?? "", region: m[3] ?? "", text: ref, from, to: from + ref.length });
  }
  return out;
}

/** uniqueRefs is findRefs with each reference once, where it first appears. */
export function uniqueRefs(text: string, syntax: RefSyntax): Ref[] {
  const seen = new Set<string>();
  return findRefs(text, syntax).filter((r) => !seen.has(r.text) && Boolean(seen.add(r.text)));
}

/** leadingRef is the reference text starts with, such as a lint message's "@x.y#z: …", or null. */
export function leadingRef(text: string, syntax: RefSyntax): string | null {
  const first = findRefs(text, syntax)[0];
  return first && first.from === 0 ? first.text : null;
}

/** What the autocomplete may offer at the cursor; from is where the replaced text starts. */
export type RefContext =
  | { kind: "screen"; from: number; typed: string }
  | { kind: "region"; screen: string; from: number; typed: string }
  | null;

/**
 * refContext reads the text before the cursor on its line (before, which
 * starts at offset start in the document): after "@" it offers screens, and
 * after "@screen.id#" that screen's regions. Both are asked of the pattern:
 * a region is being typed when a reference ends at the cursor with a region
 * (or right before a closing "#"); a screen when the text after the last @
 * would become a reference with more typed after it.
 */
export function refContext(before: string, start: number, syntax: RefSyntax): RefContext {
  const refs = findRefs(before, syntax);
  const last = refs[refs.length - 1];
  if (last && last.region && last.to === before.length) {
    return { kind: "region", screen: last.screen, from: start + before.length - last.region.length, typed: last.region };
  }
  if (last && !last.region && last.to === before.length - 1 && before.endsWith("#")) {
    return { kind: "region", screen: last.screen, from: start + before.length, typed: "" };
  }
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const typed = before.slice(at + 1);
  const probe = `${before}a.a`;
  const grows = findRefs(probe, syntax).some((r) => r.from === at && r.to === probe.length && !r.region);
  return grows ? { kind: "screen", from: start + at + 1, typed } : null;
}

/** parseRefLabel reads a diagram node's label that is one reference and nothing else. */
export function parseRefLabel(label: string, syntax: RefSyntax): { screen: string; region: string } | null {
  const text = label.trim();
  const refs = findRefs(text, syntax);
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
