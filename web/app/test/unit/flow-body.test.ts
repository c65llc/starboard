// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import type { Diagnostic, Flow } from "@c65llc/starboard-core";
import { describe, expect, it } from "vitest";

import { bodyMarks, diff, extractDiagram, saveOps, splitFlow } from "../../src/flows/body.ts";

const FILE = "docs/flows/flows/a.md";
const text = "---\nid: a\ntitle: A\nstatus: shipped\nentry: x.y\n---\n\n## Steps\n\n1. Tap @x.y#nope.\n2. Go.\n";

describe("splitFlow", () => {
  it("splits at the --- that closes the front matter, as core does", () => {
    const parts = splitFlow(text);
    expect(parts.head).toBe("---\nid: a\ntitle: A\nstatus: shipped\nentry: x.y\n---\n");
    expect(parts.body).toBe("\n## Steps\n\n1. Tap @x.y#nope.\n2. Go.\n");
    expect(parts.bodyLine).toBe(7);
    expect(parts.head + parts.body).toBe(text);
  });

  it("takes the whole file as body without front matter, or when it is never closed", () => {
    expect(splitFlow("# A\n")).toEqual({ head: "", body: "# A\n", bodyLine: 1 });
    expect(splitFlow("---\nid: a\n")).toEqual({ head: "", body: "---\nid: a\n", bodyLine: 1 });
  });

  it("reads CRLF as LF and ignores a byte order mark", () => {
    expect(splitFlow("﻿---\r\nid: a\r\n--- \r\nbody\r\n")).toEqual({ head: "---\nid: a\n--- \n", body: "body\n", bodyLine: 4 });
  });
});

const diag = (line: number | undefined, message: string, more: Partial<Diagnostic> = {}): Diagnostic => ({
  rule: "ref-unresolved",
  severity: "error",
  file: FILE,
  path: "",
  message,
  ...(line === undefined ? {} : { line }),
  ...more,
});

describe("bodyMarks", () => {
  const body = splitFlow(text).body;

  it("keeps this file's findings, on body lines, over the reference they name", () => {
    const { marks, outside } = bodyMarks(
      [
        diag(10, "@x.y#nope: x.y has no region nope in any layout"),
        diag(11, "step has no reference", { rule: "step-without-ref", severity: "warn" }),
        diag(3, "status must be shipped or proposed", { rule: "flow-frontmatter-invalid" }),
        diag(undefined, "the whole file", { rule: "flow-stale" }),
        diag(10, "elsewhere", { file: "docs/flows/flows/b.md" }),
      ],
      FILE,
      7,
      body,
    );
    expect(marks).toEqual([
      { line: 4, from: 7, to: 16, severity: "error", rule: "ref-unresolved", message: "@x.y#nope: x.y has no region nope in any layout" },
      { line: 5, from: 0, to: 6, severity: "warning", rule: "step-without-ref", message: "step has no reference" },
    ]);
    expect(outside.map((d) => d.message)).toEqual(["status must be shipped or proposed", "the whole file"]);
  });

  it("puts a finding past the body's end on its last line", () => {
    const { marks } = bodyMarks([diag(99, "late")], FILE, 7, "a\nbc");
    expect(marks).toEqual([{ line: 2, from: 0, to: 2, severity: "error", rule: "ref-unresolved", message: "late" }]);
  });

  it("marks one character on an empty line", () => {
    const { marks } = bodyMarks([diag(7, "x")], FILE, 7, "\nb");
    expect(marks[0]).toMatchObject({ line: 1, from: 0, to: 0 });
  });
});

describe("extractDiagram", () => {
  it("is the first mermaid fence's text", () => {
    const body = "Intro\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n~~~mermaid\nother\n~~~\n";
    expect(extractDiagram(body)).toBe("flowchart TD\n  A --> B");
  });

  it("needs a closing fence of the same kind, at least as long", () => {
    expect(extractDiagram("````mermaid\nA\n```\nB\n````\n")).toBe("A\n```\nB");
    expect(extractDiagram("```mermaid\nA\n")).toBe("A");
    expect(extractDiagram("```js\nx\n```\n")).toBeNull();
    expect(extractDiagram("no diagram")).toBeNull();
  });
});

const flow: Flow = { id: "a", file: FILE, title: "A", status: "shipped", entry: "x.y", steps: [] };

describe("saveOps", () => {
  it("is nothing when neither the body nor a field changed", () => {
    expect(saveOps(flow, text, splitFlow(text).body, {})).toEqual([]);
    expect(saveOps(flow, text, splitFlow(text).body, { title: "A" })).toEqual([]);
  });

  it("sets each changed field and writes a changed body", () => {
    expect(saveOps(flow, text, "new body\n", { title: "B", status: "proposed", entry: "" })).toEqual([
      { op: "setFlowMeta", flow: "a", key: "title", value: "B" },
      { op: "setFlowMeta", flow: "a", key: "status", value: "proposed" },
      { op: "setFlowMeta", flow: "a", key: "entry", value: null },
      { op: "writeFlowBody", flow: "a", value: "new body\n" },
    ]);
  });
});

describe("diff", () => {
  it("is the span between the common start and end", () => {
    expect(diff("a  b\n", "a b\n")).toEqual({ from: 2, to: 3, insert: "" });
    expect(diff("abc", "abc\n")).toEqual({ from: 3, to: 3, insert: "\n" });
    expect(diff("x", "y")).toEqual({ from: 0, to: 1, insert: "y" });
    expect(diff("aaa", "aa")).toEqual({ from: 2, to: 3, insert: "" });
  });
});
