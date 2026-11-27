// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import type { EditOp, Files, LintResult, Model } from "@c65llc/starboard-core";
import { describe, expect, it } from "vitest";

import type { Host } from "../../src/host/host.ts";
import { createMemoryHost } from "../../src/host/memory.ts";
import { createState, RELOADED_NOTICE } from "../../src/state.ts";
import type { StateCore } from "../../src/state.ts";

const project: Files = {
  "starboard.yaml": "version: 1\n",
  "docs/flows/screens.yaml": "screens: {}\n",
  "docs/flows/flows/a.md": "# A\n",
};

// fakeCore stands in for the worker: an op {op:"set", key: path, value: text}
// writes text to path; lint counts the files; model is empty.
function fakeCore(log: string[] = []): StateCore {
  return {
    edit(files: Files, ops: EditOp[]) {
      log.push("edit");
      const changed: Record<string, string> = {};
      for (const op of ops) changed[op.key ?? ""] = String(op.value);
      void files;
      return Promise.resolve({ files: changed, diagnostics: [] });
    },
    lint(files: Files): Promise<LintResult> {
      log.push("lint");
      return Promise.resolve({ diagnostics: [], errors: 0, warnings: Object.keys(files).length, passed: true });
    },
    model(): Promise<Model> {
      log.push("model");
      return Promise.resolve({ screens: [], flows: [] });
    },
  };
}

/** spy wraps a host and logs stat and write calls in order. */
function spy(host: Host, log: string[]): Host {
  return {
    kind: host.kind,
    name: host.name,
    canWrite: host.canWrite,
    readAll: () => {
      log.push("readAll");
      return host.readAll();
    },
    stat: (path) => {
      log.push(`stat ${path}`);
      return host.stat(path);
    },
    write: (changes) => {
      log.push(`write ${Object.keys(changes).join(",")}`);
      return host.write(changes);
    },
  };
}

const setOp = (path: string, value: string): EditOp => ({ op: "set", key: path, value });

describe("open", () => {
  it("reads the host and lints and models what it read", async () => {
    const state = createState(fakeCore());
    await state.open(createMemoryHost(project, { name: "travel-app" }));
    expect(state.host.value?.name).toBe("travel-app");
    expect(state.files.value).toEqual(project);
    expect(state.lint.value?.warnings).toBe(3);
    expect(state.model.value).toEqual({ screens: [], flows: [] });
    expect(state.notice.value).toBeNull();
  });

  it("keeps the newer project when an older open finishes last", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = createMemoryHost(project, { name: "slow" });
    const slowHost: Host = {
      kind: "memory",
      name: "slow",
      canWrite: true,
      readAll: async () => {
        await gate;
        return slow.readAll();
      },
      stat: (path) => slow.stat(path),
      write: (changes) => slow.write(changes),
    };
    const state = createState(fakeCore());
    const first = state.open(slowHost);
    await state.open(createMemoryHost({ "starboard.yaml": "version: 1\n" }, { name: "fast" }));
    release();
    await first;
    expect(state.host.value?.name).toBe("fast");
    expect(Object.keys(state.files.value)).toEqual(["starboard.yaml"]);
  });
});

describe("applyEdit", () => {
  it("edits through core, sets files, stats each file, then writes", async () => {
    const log: string[] = [];
    const host = createMemoryHost(project, { name: "p" });
    const state = createState(fakeCore(log));
    await state.open(spy(host, log));
    log.length = 0;

    const result = await state.applyEdit([setOp("docs/flows/screens.yaml", "screens: {a: 1}\n")]);
    expect(result).toBe("saved");
    const firstWrite = log.findIndex((l) => l.startsWith("write"));
    expect(log.slice(0, firstWrite + 1)).toEqual(["edit", "stat docs/flows/screens.yaml", "write docs/flows/screens.yaml"]);
    expect(state.files.value["docs/flows/screens.yaml"]).toBe("screens: {a: 1}\n");
    expect((await host.readAll())["docs/flows/screens.yaml"]).toBe("screens: {a: 1}\n");
    expect(state.dirty.value.size).toBe(0);
  });

  it("reloads instead of writing when a file changed on disk since it was read", async () => {
    const log: string[] = [];
    const host = createMemoryHost(project, { name: "p" });
    const state = createState(fakeCore(log));
    await state.open(spy(host, log));
    host.put("docs/flows/screens.yaml", "screens: {fromAgent: 1}\n"); // an agent or editor wrote it
    log.length = 0;

    const result = await state.applyEdit([setOp("docs/flows/screens.yaml", "screens: {mine: 1}\n")]);
    expect(result).toBe("reloaded");
    expect(log.some((l) => l.startsWith("write"))).toBe(false);
    expect(state.files.value["docs/flows/screens.yaml"]).toBe("screens: {fromAgent: 1}\n");
    expect(state.notice.value).toBe(RELOADED_NOTICE);
    expect(RELOADED_NOTICE).toBe("Reloaded: changed on disk");
    expect((await host.readAll())["docs/flows/screens.yaml"]).toBe("screens: {fromAgent: 1}\n");

    // After the reload, the next edit is based on the new contents and saves.
    expect(await state.applyEdit([setOp("docs/flows/screens.yaml", "screens: {both: 1}\n")])).toBe("saved");
    expect((await host.readAll())["docs/flows/screens.yaml"]).toBe("screens: {both: 1}\n");
  });

  it("treats a file deleted on disk as changed", async () => {
    const host = createMemoryHost(project, { name: "p" });
    const state = createState(fakeCore());
    await state.open(host);
    host.remove("docs/flows/flows/a.md");
    expect(await state.applyEdit([setOp("docs/flows/flows/a.md", "# A2\n")])).toBe("reloaded");
    expect(state.files.value).not.toHaveProperty("docs/flows/flows/a.md");
  });

  it("writes a new file that is still absent on disk", async () => {
    const host = createMemoryHost(project, { name: "p" });
    const state = createState(fakeCore());
    await state.open(host);
    expect(await state.applyEdit([setOp("docs/flows/flows/b.md", "# B\n")])).toBe("saved");
    expect((await host.readAll())["docs/flows/flows/b.md"]).toBe("# B\n");
  });

  it("on a view-only host, keeps the change pending and dirty", async () => {
    const host = createMemoryHost(project, { name: "p", canWrite: false });
    const state = createState(fakeCore());
    await state.open(host);
    expect(await state.applyEdit([setOp("docs/flows/screens.yaml", "x\n")])).toBe("pending");
    expect([...state.dirty.value]).toEqual(["docs/flows/screens.yaml"]);
    expect(state.files.value["docs/flows/screens.yaml"]).toBe("x\n");
  });

  it("checkDisk reloads when anything read has changed, and says so", async () => {
    const host = createMemoryHost(project, { name: "p" });
    const state = createState(fakeCore());
    await state.open(host);
    expect(await state.checkDisk()).toBe(false);
    host.put("docs/flows/flows/a.md", "# Changed\n");
    expect(await state.checkDisk()).toBe(true);
    expect(state.files.value["docs/flows/flows/a.md"]).toBe("# Changed\n");
    expect(state.notice.value).toBe(RELOADED_NOTICE);
  });
});

describe("selection and close", () => {
  it("close forgets the project", async () => {
    const state = createState(fakeCore());
    await state.open(createMemoryHost(project, { name: "p" }));
    state.selection.value = { screen: "trip.timeline" };
    state.close();
    expect(state.host.value).toBeNull();
    expect(state.files.value).toEqual({});
    expect(state.selection.value).toEqual({});
  });
});
