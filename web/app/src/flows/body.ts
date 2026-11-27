// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A flow file as the editor holds it: the front matter, edited in fields
// and saved with setFlowMeta, and the body, edited in CodeMirror and saved
// with writeFlowBody. These split the file as core does (core/edit.go
// splitFlow), put lint's file lines onto the body's lines, find the
// diagram, and say which edits a save sends.

import type { Diagnostic, EditOp, Flow, Severity } from "@c65llc/starboard-core";

import { findRefs, leadingRef } from "./refs.ts";
import type { RefSyntax } from "./refs.ts";

export interface FlowParts {
  /** The front matter with its --- lines and the newline after the closing one, or "" when there is none. */
  head: string;
  /** Everything after the front matter: what writeFlowBody takes. */
  body: string;
  /** The file line (1-based) the body's first line is. */
  bodyLine: number;
}

const isDelimiter = (line: string) => line.replace(/[ \t]+$/, "") === "---";

/** splitFlow splits text where core does: front matter only when the first line is --- and another --- closes it. */
export function splitFlow(text: string): FlowParts {
  const src = text.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  const lines = src.split("\n");
  if (isDelimiter(lines[0] ?? "")) {
    for (let i = 1; i < lines.length; i++) {
      if (isDelimiter(lines[i] ?? "")) {
        return { head: `${lines.slice(0, i + 1).join("\n")}\n`, body: lines.slice(i + 1).join("\n"), bodyLine: i + 2 };
      }
    }
  }
  return { head: "", body: src, bodyLine: 1 };
}

/**
 * A finding placed in the body: line is 1-based in the body (where the
 * editor puts it), fileLine the same line in the file (as lint and the CLI
 * number it), from and to are columns.
 */
export interface BodyMark {
  line: number;
  fileLine: number;
  from: number;
  to: number;
  severity: "error" | "warning";
  rule: string;
  message: string;
}

const severityOf = (s: Severity): "error" | "warning" => (s === "error" ? "error" : "warning");

/**
 * bodyMarks keeps file's findings and places those on body lines, over the
 * reference a message starts with when the line holds it, else over the
 * line; the rest (front matter, the whole file) come back as outside.
 */
export function bodyMarks(
  diagnostics: Diagnostic[],
  file: string,
  bodyLine: number,
  body: string,
  syntax: RefSyntax,
): { marks: BodyMark[]; outside: Diagnostic[] } {
  const lines = body.split("\n");
  const marks: BodyMark[] = [];
  const outside: Diagnostic[] = [];
  for (const d of diagnostics) {
    if (d.file !== file) continue;
    if (d.line === undefined || d.line < bodyLine) {
      outside.push(d);
      continue;
    }
    const line = Math.min(d.line - bodyLine + 1, lines.length);
    const text = lines[line - 1] ?? "";
    const ref = leadingRef(d.message, syntax);
    // The reference as the line holds it, whole: not the start of a longer one.
    const at = ref ? findRefs(text, syntax).find((r) => r.text === ref) : undefined;
    const [from, to] = at ? [at.from, at.to] : [0, text.length];
    marks.push({ line, fileLine: line + bodyLine - 1, from, to, severity: severityOf(d.severity), rule: d.rule, message: d.message });
  }
  return { marks, outside };
}

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)/;

/** extractDiagram is the text of the body's first ```mermaid block, or null when it has none. */
export function extractDiagram(body: string): string | null {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE.exec(lines[i] ?? "");
    if (!open || open[2] !== "mermaid") continue;
    const fence = open[1] ?? "```";
    const inside: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] ?? "";
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) break;
      inside.push(line);
    }
    while (inside.length > 0 && inside[inside.length - 1] === "") inside.pop();
    return inside.join("\n");
  }
  return null;
}

/** A front matter key: one of model.flowKeys. */
export type MetaKey = string;
/** The front matter fields as typed, where they differ from the file; a list is typed as "a, b". */
export type MetaDrafts = Partial<Record<MetaKey, string>>;

/** The keys a flow must set (core's flow parser requires them); an emptied one is not saved. */
export const REQUIRED_KEYS: readonly string[] = ["id", "title", "status", "entry"];
/** The keys whose values are lists. */
export const LIST_KEYS: readonly string[] = ["actors", "platforms"];

/** metaValue is a key's value as the field shows it: a list joined with ", ". */
export function metaValue(flow: Flow, key: MetaKey): string {
  switch (key) {
    case "id":
      return flow.frontMatterId;
    case "title":
      return flow.title;
    case "status":
      return flow.status;
    case "entry":
      return flow.entry;
    case "actors":
      return flow.actors.join(", ");
    case "platforms":
      return flow.platforms.join(", ");
    default:
      return "";
  }
}

/** metaWire is what setFlowMeta sends for a field's text: a list for list keys, null when empty. */
function metaWire(key: MetaKey, text: string): unknown {
  if (LIST_KEYS.includes(key)) {
    const items = text.split(",").map((x) => x.trim()).filter((x) => x !== "");
    return items.length > 0 ? items : null;
  }
  return text.trim() === "" ? null : text.trim();
}

/**
 * saveOps is what a save sends: a setFlowMeta for each field whose draft
 * differs from the flow's (an empty one removes the key, except a required
 * one, which is held back and listed in invalid until it is filled), then
 * a writeFlowBody when body differs from the file's.
 */
export function saveOps(flow: Flow, fileText: string, body: string, drafts: MetaDrafts): { ops: EditOp[]; invalid: MetaKey[] } {
  const ops: EditOp[] = [];
  const invalid: MetaKey[] = [];
  for (const [key, draft] of Object.entries(drafts)) {
    if (draft === undefined || draft === metaValue(flow, key)) continue;
    const value = metaWire(key, draft);
    if (value === null && REQUIRED_KEYS.includes(key)) {
      invalid.push(key);
      continue;
    }
    ops.push({ op: "setFlowMeta", flow: flow.id, key, value });
  }
  if (body !== splitFlow(fileText).body) ops.push({ op: "writeFlowBody", flow: flow.id, value: body });
  return { ops, invalid };
}

/** diff is the one change that turns a into b: the span between their common start and end. */
export function diff(a: string, b: string): { from: number; to: number; insert: string } {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && a.charCodeAt(a.length - 1 - end) === b.charCodeAt(b.length - 1 - end)) end++;
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end) };
}

/**
 * newFlowProblem says what is wrong with a new flow's ID and title, or
 * null when nothing is. pattern is core.model's flowIdPattern, core's own
 * rule for a flow ID, so the form is not restated here.
 */
export function newFlowProblem(f: { id: string; title: string }, flows: Flow[], pattern: string): string | null {
  const id = f.id.trim();
  if (id === "") return "Enter an ID, such as add-activity: it names the flow's file.";
  if (!new RegExp(pattern).test(id)) {
    return "An ID is lower-case letters, digits and hyphens, starting with a letter, such as add-activity.";
  }
  if (flows.some((x) => x.id === id)) return `A flow ${id} already exists; choose another ID.`;
  if (f.title.trim() === "") return "Enter a title.";
  return null;
}
