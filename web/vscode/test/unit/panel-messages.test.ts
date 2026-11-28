// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The guards both ends of the panel read its messages through
// (web/app/src/host/vscode-messages.ts), and the panel's EditLog: a
// message of an unknown type, or one naming a path that is not a clean
// project-relative one (../x, /abs, a\b), is refused before anything acts
// on it, and a write is only ever exactly a change core worked out.

import { describe, expect, it } from "vitest";

import { checkFromExtension, checkToExtension, checkValue, CORE_FNS } from "@c65llc/starboard-app/src/host/vscode-messages.ts";

import { EditLog } from "../../src/panel.ts";

const BAD_PATHS = ["../x", "/abs", "a\\b"];

function refused(v: { ok: boolean }): void {
  expect(v.ok).toBe(false);
}

describe("checkToExtension", () => {
  it("accepts each of the page's requests", () => {
    for (const msg of [
      { type: "readAll", id: 1 },
      { type: "read", id: 2, path: "docs/flows/screens.yaml" },
      { type: "stat", id: 3, path: "starboard.yaml" },
      { type: "write", id: 4, changes: { "docs/flows/screens.yaml": "x", "docs/flows/generated/a.md": null } },
      { type: "core", id: 5, fn: "model", args: [{ "starboard.yaml": "" }] },
      { type: "core", id: 6, fn: "lint", args: [{}, true] },
      { type: "core", id: 7, fn: "edit", args: [{}, [{ op: "set" }]] },
      { type: "core", id: 8, fn: "fix", args: [{}] },
      { type: "core", id: 9, fn: "render", args: [{}, "auth.sign-in", "phone"] },
      { type: "core", id: 10, fn: "render", args: [{}, "auth.sign-in", "phone", "credentials"] },
      { type: "core", id: 11, fn: "walkthrough", args: [{}, "sign-in", "phone"] },
      { type: "core", id: 12, fn: "scope", args: [{}] },
    ]) {
      expect(checkToExtension(msg), JSON.stringify(msg)).toEqual({ ok: true, value: msg });
    }
  });

  it("refuses an unknown type, and anything that is not a message", () => {
    refused(checkToExtension({ type: "open", id: 1, ref: "x" }));
    refused(checkToExtension({ type: "listDir", id: 1, dir: "docs" }));
    refused(checkToExtension({ type: "readBlob", id: 1, path: "a.png" }));
    refused(checkToExtension({ id: 1 }));
    refused(checkToExtension(null));
    refused(checkToExtension("readAll"));
    refused(checkToExtension([{ type: "readAll", id: 1 }]));
  });

  it("refuses a request without an id", () => {
    refused(checkToExtension({ type: "readAll" }));
    refused(checkToExtension({ type: "read", id: -1, path: "a" }));
    refused(checkToExtension({ type: "read", id: 1.5, path: "a" }));
  });

  it("refuses ../x, /abs and a\\b wherever a path goes", () => {
    for (const p of BAD_PATHS) {
      refused(checkToExtension({ type: "read", id: 1, path: p }));
      refused(checkToExtension({ type: "stat", id: 1, path: p }));
      refused(checkToExtension({ type: "write", id: 1, changes: { [p]: "x" } }));
      refused(checkToExtension({ type: "core", id: 1, fn: "model", args: [{ [p]: "" }] }));
    }
    refused(checkToExtension({ type: "read", id: 1, path: "" }));
    refused(checkToExtension({ type: "read", id: 1, path: "a//b" }));
    refused(checkToExtension({ type: "read", id: 1, path: "./a" }));
  });

  it("refuses a core function the web app never calls", () => {
    expect([...CORE_FNS].sort()).toEqual(["edit", "fix", "lint", "model", "render", "scope", "walkthrough"]);
    for (const fn of ["format", "generate", "close", "constructor", "__proto__", "toString"]) {
      refused(checkToExtension({ type: "core", id: 1, fn, args: [{}] }));
    }
  });

  it("refuses a core call whose arguments are not that call's", () => {
    refused(checkToExtension({ type: "core", id: 1, fn: "model", args: [] }));
    refused(checkToExtension({ type: "core", id: 1, fn: "model", args: "files" }));
    refused(checkToExtension({ type: "core", id: 1, fn: "lint", args: [{}, "strict"] }));
    refused(checkToExtension({ type: "core", id: 1, fn: "edit", args: [{}, ["op"]] }));
    refused(checkToExtension({ type: "core", id: 1, fn: "edit", args: [{}] }));
    refused(checkToExtension({ type: "core", id: 1, fn: "fix", args: [{}, {}] }));
    refused(checkToExtension({ type: "core", id: 1, fn: "render", args: [{}, "a"] }));
    refused(checkToExtension({ type: "core", id: 1, fn: "render", args: [{}, "a", 2] }));
    refused(checkToExtension({ type: "core", id: 1, fn: "walkthrough", args: [{}, "a", "b", "c"] }));
    refused(checkToExtension({ type: "core", id: 1, fn: "model", args: [{ "a.md": 3 }] }));
  });

  it("refuses an empty write, or one of anything but text and deletions", () => {
    refused(checkToExtension({ type: "write", id: 1, changes: {} }));
    refused(checkToExtension({ type: "write", id: 1, changes: { "a.md": 1 } }));
    refused(checkToExtension({ type: "write", id: 1, changes: "a.md" }));
    refused(checkToExtension({ type: "write", id: 1 }));
  });

  it("checks the test-only messages' shapes", () => {
    expect(checkToExtension({ type: "rendered", heading: "Sign in", tabs: ["phone"], nodes: 0 }).ok).toBe(true);
    expect(checkToExtension({ type: "applied", outcome: "saved" }).ok).toBe(true);
    refused(checkToExtension({ type: "rendered", heading: 1, tabs: [], nodes: 0 }));
    refused(checkToExtension({ type: "rendered", heading: "x", tabs: [1], nodes: 0 }));
    refused(checkToExtension({ type: "rendered", heading: "x", tabs: [] }));
    refused(checkToExtension({ type: "applied" }));
  });
});

describe("checkFromExtension", () => {
  it("accepts a reply, a reload and a test-apply", () => {
    expect(checkFromExtension({ type: "reply", id: 1, ok: true, value: null }).ok).toBe(true);
    expect(checkFromExtension({ type: "reply", id: 1, ok: false, error: "no", name: "PanelRefusal" }).ok).toBe(true);
    expect(checkFromExtension({ type: "reload" })).toEqual({ ok: true, value: { type: "reload" } });
    expect(checkFromExtension({ type: "test-apply", ops: [{ op: "set" }] }).ok).toBe(true);
  });

  it("refuses an unknown type, and a malformed reply", () => {
    refused(checkFromExtension({ type: "open" }));
    refused(checkFromExtension({ type: "readAll", id: 1 }));
    refused(checkFromExtension(undefined));
    refused(checkFromExtension({ type: "reply", ok: true }));
    refused(checkFromExtension({ type: "reply", id: 1, ok: false }));
    refused(checkFromExtension({ type: "test-apply", ops: "x" }));
  });
});

describe("checkValue", () => {
  it("refuses a readAll whose files or listed paths are ../x, /abs or a\\b", () => {
    const good = { files: { "starboard.yaml": "" }, content: "docs/flows", listedOnly: ["src/a.kt"] };
    expect(checkValue("readAll", good).ok).toBe(true);
    for (const p of BAD_PATHS) {
      refused(checkValue("readAll", { ...good, files: { [p]: "" } }));
      refused(checkValue("readAll", { ...good, listedOnly: [p] }));
    }
  });

  it("checks each answer's shape against what was asked", () => {
    expect(checkValue("read", null).ok).toBe(true);
    expect(checkValue("read", "text").ok).toBe(true);
    refused(checkValue("read", 3));
    expect(checkValue("stat", { mtime: 1, size: 2 }).ok).toBe(true);
    expect(checkValue("stat", null).ok).toBe(true);
    refused(checkValue("stat", { mtime: "1", size: 2 }));
    expect(checkValue("write", null).ok).toBe(true);
    refused(checkValue("write", "done"));
    expect(checkValue("core", { screens: [] }).ok).toBe(true);
    expect(checkValue("core", "<svg/>").ok).toBe(true);
    refused(checkValue("core", undefined));
  });
});

describe("EditLog", () => {
  const base = { "docs/flows/screens.yaml": "old" };

  it("matches only a result's exact files, and gives back the read it was worked out from", () => {
    const log = new EditLog();
    log.add({ "docs/flows/screens.yaml": "new" }, base);
    expect(log.find({ "docs/flows/screens.yaml": "new" })).toEqual(base);
    expect(log.find({ "docs/flows/screens.yaml": "new\nInjected" })).toBeUndefined();
    expect(log.find({ "docs/flows/screens.yaml": "new", "starboard.yaml": "x" })).toBeUndefined();
    expect(log.find({})).toBeUndefined();
  });

  it("matches a deletion only as null", () => {
    const log = new EditLog();
    log.add({ "docs/flows/generated/a.md": null }, base);
    expect(log.find({ "docs/flows/generated/a.md": null })).toEqual(base);
    expect(log.find({ "docs/flows/generated/a.md": "" })).toBeUndefined();
  });

  it("forgets a result once taken, and everything on clear", () => {
    const log = new EditLog();
    log.add({ "a.md": "1" }, base);
    log.add({ "b.md": "2" }, base);
    log.take({ "a.md": "1" });
    expect(log.find({ "a.md": "1" })).toBeUndefined();
    expect(log.find({ "b.md": "2" })).toEqual(base);
    log.clear();
    expect(log.find({ "b.md": "2" })).toBeUndefined();
  });

  it("keeps only the newest results", () => {
    const log = new EditLog();
    for (let i = 0; i < 20; i++) log.add({ "a.md": String(i) }, base);
    expect(log.find({ "a.md": "0" })).toBeUndefined();
    expect(log.find({ "a.md": "19" })).toEqual(base);
  });
});
