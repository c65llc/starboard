// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// What the walkthrough (src/views/FlowWalk.tsx) works out without the
// DOM: which form factors a flow can be drawn on and which one was chosen,
// the step a route or a key lands on, the text of a step split around its
// references, and lint's step-without-ref finding for a step.

import type { Diagnostic, Flow, Screen } from "@c65llc/starboard-core";

import { findRefs } from "./refs.ts";
import type { Ref, RefSyntax } from "./refs.ts";

/**
 * walkFormFactors lists the form factors of the screens flow's steps name
 * (core's generate.FormFactors, as model gives them), each once, in the
 * order the steps reach them.
 */
export function walkFormFactors(flow: Flow, screens: Screen[]): string[] {
  const byId = new Map(screens.map((s) => [s.id, s]));
  const out: string[] = [];
  for (const step of flow.steps) {
    for (const ff of byId.get(step.screen)?.formFactors ?? []) {
      if (!out.includes(ff)) out.push(ff);
    }
  }
  return out;
}

/** clampStep is the 1-based step a route asks for, within a flow of count steps (0 when it has none). */
export function clampStep(step: number | undefined, count: number): number {
  if (count === 0) return 0;
  return Math.min(Math.max(step ?? 1, 1), count);
}

/** keyStep is the step key moves the storyboard strip to from current, or null when the strip does not handle key. */
export function keyStep(key: string, current: number, count: number): number | null {
  switch (key) {
    case "ArrowLeft":
      return Math.max(current - 1, 1);
    case "ArrowRight":
      return Math.min(current + 1, count);
    case "Home":
      return 1;
    case "End":
      return count;
    default:
      return null;
  }
}

/** A run of a step's text: plain text, or a reference. */
export type Piece = { text: string } | { ref: Pick<Ref, "screen" | "region" | "text"> };

/** splitRefs cuts text around its references, with core's pattern; everything else stays text. */
export function splitRefs(text: string, syntax: RefSyntax): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  for (const r of findRefs(text, syntax)) {
    if (r.from > at) out.push({ text: text.slice(at, r.from) });
    out.push({ ref: { screen: r.screen, region: r.region, text: r.text } });
    at = r.to;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** stepWarning is lint's step-without-ref finding for step number of flow, matched by file and line. */
export function stepWarning(diagnostics: Diagnostic[], flow: Flow, number: number): Diagnostic | undefined {
  const step = flow.steps.find((s) => s.number === number);
  if (!step) return undefined;
  return diagnostics.find((d) => d.rule === "step-without-ref" && d.file === flow.file && d.line === step.line);
}

/** The part of Storage the remembered form factor uses. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "starboard.walk.formFactor";
// The choice for this page, for when storage refuses (a private window, say).
let chosen: string | null = null;

/** rememberFormFactor keeps ff as the session's choice. */
export function rememberFormFactor(ff: string, store: KeyValue | undefined = session()): void {
  chosen = ff;
  try {
    store?.setItem(KEY, ff);
  } catch {
    // Remembering is a convenience; the page keeps the choice in chosen.
  }
}

/** rememberedFormFactor is the session's choice when offered lists it, else offered's first ("" when it is empty). */
export function rememberedFormFactor(offered: string[], store: KeyValue | undefined = session()): string {
  let stored: string | null;
  try {
    stored = store?.getItem(KEY) ?? null;
  } catch {
    stored = null;
  }
  for (const ff of [stored, chosen]) if (ff !== null && offered.includes(ff)) return ff;
  return offered[0] ?? "";
}

function session(): KeyValue | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}
