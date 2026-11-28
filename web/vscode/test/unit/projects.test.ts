// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Projects: one core session per starboard.yaml, the nearest project above
// a file (Review Focus 2's lookup, without VS Code), one core call at a
// time, and the model read once until the project changes.

import { beforeEach, describe, expect, it } from "vitest";

import type { StarboardCore } from "@c65llc/starboard-core";

import { Projects, serial } from "../../src/projects.ts";
import { Uri } from "vscode";

import { disk, findFilesCalls, findFilesDelays } from "./vscode-stub.ts";

const yaml = new TextEncoder().encode("version: 1\n");

/** fakeCore is a session that only records whether it was closed. */
function fakeCore(): StarboardCore & { closed: boolean } {
  const core = { closed: false, close: () => void (core.closed = true) };
  return core as unknown as StarboardCore & { closed: boolean };
}

let made: (StarboardCore & { closed: boolean })[];
let projects: Projects;

async function start(paths: string[]): Promise<void> {
  disk.clear();
  findFilesCalls.length = 0;
  findFilesDelays.length = 0;
  for (const p of paths) disk.set(p, yaml);
  made = [];
  projects = new Projects(() => {
    const core = fakeCore();
    made.push(core);
    return core;
  });
  await projects.refresh();
}

const root = (uri: string) => projects.projectFor(Uri.file(uri))?.root.path;

describe("Projects.projectFor", () => {
  beforeEach(() => start(["/w/starboard.yaml", "/w/sub/starboard.yaml"]));

  it("picks the nearest project above a file", () => {
    expect(root("/w/sub/x/y.kt")).toBe("/w/sub");
    expect(root("/w/x/y.kt")).toBe("/w");
    expect(root("/w/sub/starboard.yaml")).toBe("/w/sub");
  });

  it("gives a file under no project nothing", () => {
    expect(root("/elsewhere/z.kt")).toBeUndefined();
    expect(root("/wx/z.kt")).toBeUndefined(); // starts like /w, but is not under it
    expect(root("/w")).toBeUndefined(); // the folder itself is not inside it
  });

  it("lists every project above a file, nearest first, and gives each its relative path", () => {
    const uri = Uri.file("/w/sub/x/y.kt");
    expect(projects.projectsFor(uri).map((p) => p.root.path)).toEqual(["/w/sub", "/w"]);
    const p = projects.projectFor(uri);
    expect(p && projects.relativePath(p, uri)).toBe("x/y.kt");
  });
});

describe("Projects.refresh", () => {
  beforeEach(() =>
    start(["/w/a/starboard.yaml", "/w/a/sub/inner/starboard.yaml", "/w/b/node_modules/pkg/starboard.yaml", "/x/starboard.yaml"]),
  );

  it("finds each starboard.yaml outside node_modules, each with its own core", () => {
    expect(findFilesCalls).toEqual([["**/starboard.yaml", "**/node_modules/**"]]);
    expect(projects.all().map((p) => p.root.path)).toEqual(["/w/a", "/w/a/sub/inner", "/x"]);
    expect(new Set(projects.all().map((p) => p.core)).size).toBe(3);
    expect(made).toHaveLength(3);
    expect(root("/w/b/node_modules/pkg/screens.yaml")).toBeUndefined();
  });

  it("keeps the sessions of projects still there and closes the rest", async () => {
    let fired = 0;
    projects.onDidChange(() => fired++);
    await projects.refresh();
    expect(fired).toBe(0);
    expect(made).toHaveLength(3);

    disk.delete("/w/a/sub/inner/starboard.yaml");
    disk.set("/w/c/starboard.yaml", yaml);
    await projects.refresh();
    expect(fired).toBe(1);
    expect(projects.all().map((p) => p.root.path)).toEqual(["/w/a", "/w/c", "/x"]);
    expect(made.map((c) => c.closed)).toEqual([false, true, false, false]);
    expect(root("/w/a/sub/inner/docs/x.md")).toBe("/w/a");

    projects.dispose();
    expect(made.every((c) => c.closed)).toBe(true);
  });

  it("starts no session for a refresh still in flight at dispose", async () => {
    disk.set("/w/d/starboard.yaml", yaml);
    findFilesDelays.push(20);
    const pending = projects.refresh();
    projects.dispose();
    await pending;
    expect(made).toHaveLength(3);
    expect(projects.all()).toEqual([]);
  });

  it("runs refreshes in turn, so a slow, older listing never lands after a newer one", async () => {
    disk.set("/w/d/starboard.yaml", yaml);
    findFilesDelays.push(30, 0);
    const older = projects.refresh(); // lists /w/d, but answers late
    disk.delete("/w/d/starboard.yaml");
    const newer = projects.refresh(); // would answer first, without /w/d
    await Promise.all([older, newer]);
    expect(projects.all().map((p) => p.root.path)).toEqual(["/w/a", "/w/a/sub/inner", "/x"]);
  });
});

/** slowCore answers each call after a delay, and records the most calls ever in flight and the calls made. */
function slowCore(): { core: StarboardCore; maxInFlight: () => number; calls: string[] } {
  let active = 0;
  let max = 0;
  const calls: string[] = [];
  const slow = (name: string, value: unknown) => async () => {
    calls.push(name);
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 15));
    active--;
    return value;
  };
  const core = {
    scope: slow("scope", { content: "docs/flows", read: [], present: [], walk: [], named: [] }),
    lint: slow("lint", { diagnostics: [], errors: 0, warnings: 0, passed: true }),
    model: slow("model", { screens: [], flows: [] }),
    close: () => undefined,
  } as unknown as StarboardCore;
  return { core, maxInFlight: () => max, calls };
}

describe("serial", () => {
  it("never overlaps two calls on one core, even when asked at once", async () => {
    const { core, maxInFlight } = slowCore();
    const s = serial(core);
    await Promise.all([s.lint({}), s.model({}), s.scope({}), s.lint({})]);
    expect(maxInFlight()).toBe(1);
  });

  it("goes on after a call fails, and lets close through", async () => {
    const s = serial({ lint: () => Promise.reject(new Error("boom")), model: async () => 7, close: () => "closed" } as never) as never as {
      lint(): Promise<unknown>;
      model(): Promise<unknown>;
      close(): unknown;
    };
    await expect(s.lint()).rejects.toThrow("boom");
    expect(await s.model()).toBe(7);
    expect(s.close()).toBe("closed");
  });
});

describe("Project.model", () => {
  it("is read when asked, once, until the project changes, and never overlaps a lint", async () => {
    disk.clear();
    disk.set("/w/a/starboard.yaml", yaml);
    const { core, maxInFlight, calls } = slowCore();
    const ps = new Projects(() => core);
    await ps.refresh();
    const p = ps.projectFor(Uri.file("/w/a/x.kt"));
    if (!p) throw new Error("no project");
    expect(calls).toEqual([]);

    const lint = p.core.lint({});
    const [a, b] = await Promise.all([p.model(), p.model(), lint]);
    expect(a).toBe(b);
    expect(calls.filter((c) => c === "model")).toHaveLength(1);
    expect(maxInFlight()).toBe(1);

    await p.model();
    expect(calls.filter((c) => c === "model")).toHaveLength(1);
    let invalidated = 0;
    ps.onDidInvalidate(() => invalidated++);
    ps.invalidate(p);
    expect(invalidated).toBe(1);
    await p.model();
    expect(calls.filter((c) => c === "model")).toHaveLength(2);
  });

  it("does not keep a read that failed", async () => {
    disk.clear();
    disk.set("/w/a/starboard.yaml", yaml);
    let fail = true;
    const core = {
      scope: async () => ({ content: "docs/flows", read: [], present: [], walk: [], named: [] }),
      model: async () => {
        if (fail) throw new Error("boom");
        return { screens: [] };
      },
      close: () => undefined,
    } as unknown as StarboardCore;
    const ps = new Projects(() => core);
    await ps.refresh();
    const p = ps.projectFor(Uri.file("/w/a/x.kt"));
    if (!p) throw new Error("no project");
    await expect(p.model()).rejects.toThrow("boom");
    fail = false;
    expect((await p.model()).screens).toEqual([]);
  });
});
