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
// writes text to path, and {op:"writeFlowBody", key, value} appends value
// to what files holds at key (so a lost update shows); lint counts the
// files; model is empty.
function fakeCore(log: string[] = []): StateCore {
  return {
    edit(files: Files, ops: EditOp[]) {
      log.push("edit");
      const changed: Record<string, string> = {};
      for (const op of ops) {
        const key = op.key ?? "";
        changed[key] = op.op === "writeFlowBody" ? (changed[key] ?? files[key] ?? "") + String(op.value) : String(op.value);
      }
      return Promise.resolve({ files: changed, diagnostics: [] });
    },
    lint(files: Files): Promise<LintResult> {
      log.push("lint");
      return Promise.resolve({ diagnostics: [], errors: 0, warnings: Object.keys(files).length, passed: true });
    },
    model(): Promise<Model> {
      log.push("model");
      return Promise.resolve({ screens: [], flows: [], areas: [], idPattern: "", refPattern: "", flowIdPattern: "", flowKeys: [], kinds: [], presentations: [] });
    },
    fix(files: Files) {
      log.push("fix");
      // Formats screens.yaml (appends "# fixed") and removes a generated page.
      const reg = "docs/flows/screens.yaml";
      return Promise.resolve({
        write: { [reg]: `${files[reg] ?? ""}# fixed\n` },
        remove: Object.keys(files).filter((p) => p.startsWith("docs/flows/generated/")),
      });
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
const appendOp = (path: string, value: string): EditOp => ({ op: "writeFlowBody", key: path, value });

/** gated wraps a host so each write waits for release(); writes counts them. */
function gated(host: Host) {
  let open: () => void = () => undefined;
  let gate = Promise.resolve();
  const state = { writes: 0, afterWrite: (): void => undefined };
  const close = () => {
    gate = new Promise<void>((resolve) => (open = resolve));
  };
  const wrapped: Host = {
    kind: host.kind,
    name: host.name,
    canWrite: host.canWrite,
    readAll: () => host.readAll(),
    stat: (path) => host.stat(path),
    write: async (changes) => {
      state.writes++;
      await gate;
      await host.write(changes);
      state.afterWrite();
    },
  };
  return { host: wrapped, close, release: () => open(), state };
}

/** settle lets every queued microtask and timer-free promise run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("open", () => {
  it("reads the host and lints and models what it read", async () => {
    const state = createState(fakeCore());
    await state.open(createMemoryHost(project, { name: "travel-app" }));
    expect(state.host.value?.name).toBe("travel-app");
    expect(state.files.value).toEqual(project);
    expect(state.lint.value?.warnings).toBe(3);
    expect(state.model.value).toEqual({ screens: [], flows: [], areas: [], idPattern: "", refPattern: "", flowIdPattern: "", flowKeys: [], kinds: [], presentations: [] });
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

  it("reads counts each fresh read of the host (open, reload), not saves", async () => {
    const host = createMemoryHost(project, { name: "p" });
    const state = createState(fakeCore());
    expect(state.reads.value).toBe(0);
    await state.open(host);
    expect(state.reads.value).toBe(1);
    expect(await state.applyEdit([setOp("docs/flows/flows/a.md", "# B\n")])).toBe("saved");
    expect(state.reads.value).toBe(1);
    host.put("docs/flows/flows/a.md", "# C\n");
    await state.checkDisk();
    expect(state.reads.value).toBe(2);
  });
});

describe("serialised saves", () => {
  it("two edits on one path and a focus check right after a write: no reload, both saved", async () => {
    const mem = createMemoryHost(project, { name: "p" });
    const g = gated(mem);
    const state = createState(fakeCore());
    await state.open(g.host);
    // Window focus arrives the moment the first write lands, before the
    // app has re-stamped the file.
    let focus: Promise<boolean> | undefined;
    g.state.afterWrite = () => {
      focus ??= state.checkDisk();
    };
    g.close();
    const first = state.applyEdit([appendOp("docs/flows/flows/a.md", "one\n")]);
    const second = state.applyEdit([appendOp("docs/flows/flows/a.md", "two\n")]);
    await settle();
    g.release();
    expect(await first).toBe("saved");
    expect(await second).toBe("saved");
    expect(await focus).toBe(false);
    expect(state.notice.value).toBeNull();
    expect((await mem.readAll())["docs/flows/flows/a.md"]).toBe("# A\none\ntwo\n");
    expect(state.files.value["docs/flows/flows/a.md"]).toBe("# A\none\ntwo\n");
    expect(state.dirty.value.size).toBe(0);
  });

  it("an edit that finishes after another project opened leaves the new project alone", async () => {
    const one = gated(createMemoryHost(project, { name: "one" }));
    const two = createMemoryHost({ "starboard.yaml": "version: 1\n", "docs/flows/flows/a.md": "# Two\n" }, { name: "two" });
    const state = createState(fakeCore());
    await state.open(one.host);
    one.close();
    const edit = state.applyEdit([setOp("docs/flows/flows/a.md", "# One edited\n")]);
    await settle();
    await state.open(two);
    one.release();
    expect(await edit).toBe("discarded");
    expect(state.host.value?.name).toBe("two");
    expect(state.files.value["docs/flows/flows/a.md"]).toBe("# Two\n");
    expect(state.dirty.value.size).toBe(0);
    // two's stamps are its own: an edit there saves rather than reloading.
    expect(await state.applyEdit([setOp("docs/flows/flows/a.md", "# Two edited\n")])).toBe("saved");
    expect((await two.readAll())["docs/flows/flows/a.md"]).toBe("# Two edited\n");
  });
});

describe("a write that fails", () => {
  it("keeps the edit unsaved and dirty, says so, and saves it on retry", async () => {
    const mem = createMemoryHost(project, { name: "p" });
    let failing = true;
    const host: Host = {
      kind: "memory",
      name: "p",
      canWrite: true,
      readAll: () => mem.readAll(),
      stat: (path) => mem.stat(path),
      write: (changes) => (failing ? Promise.reject(new Error("The folder is no longer allowed.")) : mem.write(changes)),
    };
    const state = createState(fakeCore());
    await state.open(host);
    expect(await state.applyEdit([setOp("docs/flows/screens.yaml", "screens: {a: 1}\n")])).toBe("failed");
    expect(state.notice.value).toMatch(/^Not saved: The folder is no longer allowed\./);
    expect(state.files.value["docs/flows/screens.yaml"]).toBe("screens: {a: 1}\n");
    expect([...state.dirty.value]).toEqual(["docs/flows/screens.yaml"]);
    expect((await mem.readAll())["docs/flows/screens.yaml"]).toBe("screens: {}\n");

    failing = false;
    expect(await state.retrySave()).toBe("saved");
    expect((await mem.readAll())["docs/flows/screens.yaml"]).toBe("screens: {a: 1}\n");
    expect(state.dirty.value.size).toBe(0);
    expect(state.notice.value).toBeNull();
  });

  it("the next edit carries the unsaved change with it", async () => {
    const mem = createMemoryHost(project, { name: "p" });
    let failing = true;
    const host: Host = {
      kind: "memory",
      name: "p",
      canWrite: true,
      readAll: () => mem.readAll(),
      stat: (path) => mem.stat(path),
      write: (changes) => (failing ? Promise.reject(new Error("denied")) : mem.write(changes)),
    };
    const state = createState(fakeCore());
    await state.open(host);
    await state.applyEdit([setOp("docs/flows/screens.yaml", "s1\n")]);
    failing = false;
    expect(await state.applyEdit([setOp("docs/flows/flows/a.md", "# A2\n")])).toBe("saved");
    const disk = await mem.readAll();
    expect(disk["docs/flows/screens.yaml"]).toBe("s1\n");
    expect(disk["docs/flows/flows/a.md"]).toBe("# A2\n");
    expect(state.dirty.value.size).toBe(0);
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

describe("applyChanges", () => {
  it("writes the texts given, without core's edit, and relints", async () => {
    const log: string[] = [];
    const host = createMemoryHost(project, { name: "p" });
    const state = createState(fakeCore(log));
    await state.open(host);
    log.length = 0;
    const result = await state.applyChanges({ "docs/flows/screens.yaml": "screens: [\n" });
    expect(result).toBe("saved");
    expect(log).not.toContain("edit");
    expect(log).toContain("lint");
    expect((await host.readAll())["docs/flows/screens.yaml"]).toBe("screens: [\n");
    expect(state.files.value["docs/flows/screens.yaml"]).toBe("screens: [\n");
    expect(state.dirty.value.size).toBe(0);
  });

  it("reloads instead of writing when the file changed on disk", async () => {
    const host = createMemoryHost(project, { name: "p" });
    const state = createState(fakeCore());
    await state.open(host);
    host.put("docs/flows/screens.yaml", "screens: {outside: 1}\n");
    expect(await state.applyChanges({ "docs/flows/screens.yaml": "mine\n" })).toBe("reloaded");
    expect((await host.readAll())["docs/flows/screens.yaml"]).toBe("screens: {outside: 1}\n");
  });
});

describe("applyFix", () => {
  it("writes core.fix's files and removes its generated pages, as one change", async () => {
    const files = { ...project, "docs/flows/generated/old.md": "old\n" };
    const log: string[] = [];
    const host = createMemoryHost(files, { name: "p" });
    const state = createState(fakeCore(log));
    await state.open(spy(host, log));
    log.length = 0;
    expect(await state.applyFix()).toBe("saved");
    expect(log.filter((l) => l.startsWith("write"))).toEqual(["write docs/flows/screens.yaml,docs/flows/generated/old.md"]);
    const now = await host.readAll();
    expect(now["docs/flows/screens.yaml"]).toBe("screens: {}\n# fixed\n");
    expect(now).not.toHaveProperty("docs/flows/generated/old.md");
    expect(state.files.value).not.toHaveProperty("docs/flows/generated/old.md");
  });

  it("runs after a save in progress, on the files that save wrote", async () => {
    const host = createMemoryHost(project, { name: "p" });
    const state = createState(fakeCore());
    await state.open(host);
    const edit = state.applyEdit([setOp("docs/flows/screens.yaml", "screens: {a: 1}\n")]);
    const fix = state.applyFix();
    expect(await edit).toBe("saved");
    expect(await fix).toBe("saved");
    expect((await host.readAll())["docs/flows/screens.yaml"]).toBe("screens: {a: 1}\n# fixed\n");
  });
});

/** flaky wraps a memory host whose stat and write fail while the flags say so. */
function flaky(mem: ReturnType<typeof createMemoryHost>) {
  const flags = { statFails: false, writeFailsAfter: -1 };
  const host: Host = {
    kind: "memory",
    name: mem.name,
    canWrite: true,
    readAll: () => mem.readAll(),
    stat: (path) =>
      flags.statFails ? Promise.reject(new DOMException("The request is not allowed.", "NotAllowedError")) : mem.stat(path),
    write: async (changes) => {
      if (flags.writeFailsAfter < 0) return mem.write(changes);
      // Writes file by file, as the fsaccess host does, failing part way.
      let n = 0;
      for (const [path, text] of Object.entries(changes)) {
        if (n++ === flags.writeFailsAfter) throw new Error("The disk is full.");
        await mem.write({ [path]: text });
      }
    },
  };
  return { host, flags };
}

describe("a save that fails before or after the write", () => {
  it("a stat that throws before the write keeps the edit unsaved, says so, and saves it on retry", async () => {
    const mem = createMemoryHost(project, { name: "p" });
    const { host, flags } = flaky(mem);
    const state = createState(fakeCore());
    await state.open(host);
    flags.statFails = true;
    expect(await state.applyEdit([setOp("docs/flows/screens.yaml", "screens: {a: 1}\n")])).toBe("failed");
    expect(state.notice.value).toMatch(/^Not saved: The request is not allowed\./);
    expect([...state.dirty.value]).toEqual(["docs/flows/screens.yaml"]);

    flags.statFails = false;
    // A later edit to another file carries the kept one with it.
    expect(await state.applyEdit([setOp("docs/flows/flows/a.md", "# A2\n")])).toBe("saved");
    const disk = await mem.readAll();
    expect(disk["docs/flows/screens.yaml"]).toBe("screens: {a: 1}\n");
    expect(disk["docs/flows/flows/a.md"]).toBe("# A2\n");
    expect(state.dirty.value.size).toBe(0);
    expect(state.notice.value).toBeNull();
  });

  it("a stat that throws after the write lands in the failed path, and retry saves without a reload", async () => {
    const mem = createMemoryHost(project, { name: "p" });
    const { host, flags } = flaky(mem);
    const state = createState(fakeCore());
    await state.open(host);
    const write = host.write;
    host.write = async (changes) => {
      await write(changes);
      flags.statFails = true; // access is revoked right after the write
    };
    expect(await state.applyEdit([setOp("docs/flows/screens.yaml", "screens: {a: 1}\n")])).toBe("failed");
    expect(state.notice.value).toMatch(/^Not saved: /);
    host.write = write;
    flags.statFails = false;
    expect(await state.retrySave()).toBe("saved");
    expect(state.notice.value).toBeNull();
    expect((await mem.readAll())["docs/flows/screens.yaml"]).toBe("screens: {a: 1}\n");
  });

  it("after a failed post-write stat, an outside edit before the retry is reloaded, not overwritten", async () => {
    const mem = createMemoryHost(project, { name: "p" });
    const { host, flags } = flaky(mem);
    const state = createState(fakeCore());
    await state.open(host);
    const write = host.write;
    host.write = async (changes) => {
      await write(changes);
      flags.statFails = true;
    };
    expect(await state.applyEdit([setOp("docs/flows/screens.yaml", "screens: {a: 1}\n")])).toBe("failed");
    host.write = write;
    flags.statFails = false;
    mem.put("docs/flows/screens.yaml", "screens: {outside: 1}\n"); // minutes later, before the reconnect
    expect(await state.retrySave()).toBe("reloaded");
    expect(state.notice.value).toBe(RELOADED_NOTICE);
    expect((await mem.readAll())["docs/flows/screens.yaml"]).toBe("screens: {outside: 1}\n");
    expect(state.files.value["docs/flows/screens.yaml"]).toBe("screens: {outside: 1}\n");
  });

  it("after a failed post-write stat, the focus check also sees an outside edit", async () => {
    const mem = createMemoryHost(project, { name: "p" });
    const { host, flags } = flaky(mem);
    const state = createState(fakeCore());
    await state.open(host);
    const write = host.write;
    host.write = async (changes) => {
      await write(changes);
      flags.statFails = true;
    };
    expect(await state.applyEdit([setOp("docs/flows/screens.yaml", "screens: {a: 1}\n")])).toBe("failed");
    host.write = write;
    flags.statFails = false;
    expect(await state.checkDisk()).toBe(false); // the app's own write, read back: not a change
    mem.put("docs/flows/screens.yaml", "screens: {outside: 1}\n");
    expect(await state.checkDisk()).toBe(true);
    expect(state.files.value["docs/flows/screens.yaml"]).toBe("screens: {outside: 1}\n");
  });

  it("a write that fails part way re-stamps the files that landed, so retry writes the rest", async () => {
    const files = { ...project, "docs/flows/generated/old.md": "old\n" };
    const mem = createMemoryHost(files, { name: "p" });
    const { host, flags } = flaky(mem);
    const state = createState(fakeCore());
    await state.open(host);
    flags.writeFailsAfter = 1; // screens.yaml lands, the deletion does not
    expect(await state.applyFix()).toBe("failed");
    expect((await mem.readAll())["docs/flows/screens.yaml"]).toBe("screens: {}\n# fixed\n");
    expect(await mem.readAll()).toHaveProperty("docs/flows/generated/old.md");

    flags.writeFailsAfter = -1;
    expect(await state.retrySave()).toBe("saved");
    expect(state.notice.value).toBeNull();
    expect(await mem.readAll()).not.toHaveProperty("docs/flows/generated/old.md");
  });

  it("checkDisk never rejects: a stat that throws becomes a notice", async () => {
    const mem = createMemoryHost(project, { name: "p" });
    const { host, flags } = flaky(mem);
    const state = createState(fakeCore());
    await state.open(host);
    flags.statFails = true;
    expect(await state.checkDisk()).toBe(false);
    expect(state.notice.value).toMatch(/^Could not check the files on disk: The request is not allowed\./);
  });
});

describe("empty files", () => {
  it("an empty file filled on disk by someone else is reloaded, not overwritten", async () => {
    const mem = createMemoryHost({ ...project, "docs/flows/flows/empty.md": "" }, { name: "p" });
    const state = createState(fakeCore());
    await state.open(mem);
    mem.put("docs/flows/flows/empty.md", "# Someone else's\n");
    expect(await state.applyEdit([setOp("docs/flows/flows/empty.md", "# Mine\n")])).toBe("reloaded");
    expect((await mem.readAll())["docs/flows/flows/empty.md"]).toBe("# Someone else's\n");
  });

  it("files a host lists by name only are not stamped", async () => {
    const log: string[] = [];
    const mem = createMemoryHost({ ...project, "app/HomeView.swift": "" }, { name: "p" });
    const host = spy(mem, log);
    host.listedOnly = () => new Set(["app/HomeView.swift"]);
    const state = createState(fakeCore());
    await state.open(host);
    expect(log).not.toContain("stat app/HomeView.swift");
    expect(log).toContain("stat docs/flows/screens.yaml");
  });
});
