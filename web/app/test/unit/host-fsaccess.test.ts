// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { describe, expect, it } from "vitest";

import { DeletionRefusedError, NoProjectError } from "../../src/host/host.ts";
import type { ScopeFn } from "../../src/host/host.ts";
import {
  canOpenInPlace,
  memoryRecentStore,
  openFolder,
  PermissionDeniedError,
  reconnect,
  rememberSummary,
  restoreRecent,
  summaryRecorder,
} from "../../src/host/fsaccess.ts";
import { folder } from "./fake-fs.ts";

// scope stands in for core.scope on these folders: the default content
// root, permissions.yaml read in full, and app/ (a root) listed by name.
const scope: ScopeFn = (files) =>
  Promise.resolve({
    content: "docs/flows",
    read: "permissions.yaml" in files ? ["permissions.yaml"] : [],
    present: Object.keys(files).filter((p) => p.startsWith("app/")),
  });

function project() {
  return folder("travel-app", {
    "starboard.yaml": "version: 1\n",
    "permissions.yaml": "permissions: []\n",
    "docs/flows/screens.yaml": "screens: {}\n",
    "docs/flows/flows/a.md": "# A\n",
    "docs/flows/generated/screens.md": "old\n",
    "app/HomeView.swift": "struct HomeView {}\n",
    "notes/todo.txt": "unrelated\n",
    "node_modules/x/package.json": "{}\n",
  });
}

describe("feature detection", () => {
  it("edits in place only where showDirectoryPicker exists", () => {
    expect(canOpenInPlace({ showDirectoryPicker: () => undefined })).toBe(true);
    expect(canOpenInPlace({})).toBe(false);
  });
});

describe("openFolder", () => {
  it("asks for a read-write folder and remembers it", async () => {
    const dir = project();
    const store = memoryRecentStore();
    const modes: string[] = [];
    const host = await openFolder({
      scope,
      store,
      picker: (opts) => {
        modes.push(opts.mode);
        return Promise.resolve(dir);
      },
    });
    expect(modes).toEqual(["readwrite"]);
    expect(host.kind).toBe("fsaccess");
    expect(host.name).toBe("travel-app");
    expect(host.canWrite).toBe(true);
    const recent = await restoreRecent({ store });
    expect(recent.map((r) => [r.id, r.name, r.permission])).toEqual([[host.recentId, "travel-app", "granted"]]);
  });

  it("opening the same folder again keeps one recent entry", async () => {
    const dir = project();
    const store = memoryRecentStore();
    const a = await openFolder({ scope, store, picker: () => Promise.resolve(dir) });
    const b = await openFolder({ scope, store, picker: () => Promise.resolve(dir) });
    expect(b.recentId).toBe(a.recentId);
    expect(await restoreRecent({ store })).toHaveLength(1);
  });

  it("refuses a folder without starboard.yaml", async () => {
    const dir = folder("photos", { "a.jpg": "x" });
    await expect(
      openFolder({ scope, store: memoryRecentStore(), picker: () => Promise.resolve(dir) }),
    ).rejects.toBeInstanceOf(NoProjectError);
  });
});

describe("restoreRecent and reconnect", () => {
  async function remembered(permission: "granted" | "prompt" | "denied") {
    const dir = project();
    const store = memoryRecentStore();
    await openFolder({ scope, store, picker: () => Promise.resolve(dir) });
    dir.permission = permission; // as after a reload
    return { dir, store };
  }

  it("reports a remembered folder's permission without asking for it", async () => {
    const { dir, store } = await remembered("prompt");
    const [entry] = await restoreRecent({ store });
    expect(entry?.permission).toBe("prompt");
    expect(dir.requests).toEqual([]);
  });

  it("reconnect asks for read-write permission and opens the folder when granted", async () => {
    const { dir, store } = await remembered("prompt");
    dir.answer = "granted";
    const [entry] = await restoreRecent({ store });
    if (!entry) throw new Error("no recent entry");
    const host = await reconnect(entry, { scope, store });
    expect(dir.requests).toEqual(["readwrite"]);
    expect(host.name).toBe("travel-app");
    expect(Object.keys(await host.readAll())).toContain("docs/flows/screens.yaml");
  });

  it("reconnect rejects with PermissionDeniedError, never silently, when denied", async () => {
    const { dir, store } = await remembered("prompt");
    dir.answer = "denied";
    const [entry] = await restoreRecent({ store });
    if (!entry) throw new Error("no recent entry");
    const err = await reconnect(entry, { scope, store }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermissionDeniedError);
    expect((err as Error).message).toMatch(/Reconnect folder/);
  });

  it("reconnect rejects when the prompt is dismissed (prompt stays prompt)", async () => {
    const { dir, store } = await remembered("prompt");
    dir.answer = "prompt";
    const [entry] = await restoreRecent({ store });
    if (!entry) throw new Error("no recent entry");
    await expect(reconnect(entry, { scope, store })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("rememberSummary stores the lint summary shown in Recent", async () => {
    const { store } = await remembered("granted");
    const [entry] = await restoreRecent({ store });
    if (!entry) throw new Error("no recent entry");
    await rememberSummary(entry.id, { screens: 10, flows: 4, errors: 0, warnings: 1 }, { store });
    const [again] = await restoreRecent({ store });
    expect(again?.summary).toEqual({ screens: 10, flows: 4, errors: 0, warnings: 1 });
  });

  it("rememberSummary writes nothing when the summary is unchanged", async () => {
    const { store } = await remembered("granted");
    let saves = 0;
    const counting = { load: () => store.load(), save: (r: Parameters<typeof store.save>[0]) => (saves++, store.save(r)) };
    const [entry] = await restoreRecent({ store });
    if (!entry) throw new Error("no recent entry");
    const summary = { screens: 10, flows: 4, errors: 0, warnings: 1 };
    await rememberSummary(entry.id, summary, { store: counting });
    await rememberSummary(entry.id, { ...summary }, { store: counting });
    expect(saves).toBe(1);
    await rememberSummary(entry.id, { ...summary, warnings: 0 }, { store: counting });
    expect(saves).toBe(2);
  });
});

describe("summaryRecorder", () => {
  it("writes in order, one at a time, skips counts already written, and retries counts whose write failed", async () => {
    const writes: string[] = [];
    let fail = true;
    const gates: (() => void)[] = [];
    const record = summaryRecorder(async (id, s) => {
      await new Promise<void>((resolve) => gates.push(resolve));
      if (fail) {
        fail = false;
        throw new Error("IndexedDB is unavailable");
      }
      writes.push(`${id}:${s.errors}`);
    });
    const s = (errors: number) => ({ screens: 1, flows: 1, errors, warnings: 0 });
    const a = record("r", s(1)); // fails
    const b = record("r", s(1)); // retried, as the first never landed
    const c = record("r", s(2));
    const d = record("r", s(2)); // already written by then: skipped
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 0));
      expect(gates).toHaveLength(i + 1); // one write at a time
      gates[i]?.();
    }
    await Promise.all([a, b, c, d]);
    expect(writes).toEqual(["r:1", "r:2"]);
    expect(gates).toHaveLength(3);
  });
});

describe("the fsaccess host", () => {
  async function opened(opts: { canMove?: boolean } = {}) {
    const dir = opts.canMove === false ? folder("travel-app", {}, { canMove: false }) : project();
    if (opts.canMove === false) {
      for (const [path, text] of Object.entries({ "starboard.yaml": "version: 1\n", "docs/flows/screens.yaml": "s\n" }))
        dir.put(path, text);
    }
    const host = await openFolder({ scope, store: memoryRecentStore(), picker: () => Promise.resolve(dir) });
    dir.log.ops.length = 0;
    return { dir, host };
  }

  it("readAll reads starboard.yaml, the content root and vocabularies, and only lists the rest", async () => {
    const { dir, host } = await opened();
    const files = await host.readAll();
    expect(files).toEqual({
      "starboard.yaml": "version: 1\n",
      "permissions.yaml": "permissions: []\n",
      "docs/flows/screens.yaml": "screens: {}\n",
      "docs/flows/flows/a.md": "# A\n",
      "docs/flows/generated/screens.md": "old\n",
      "app/HomeView.swift": "",
    });
    expect([...host.listedOnly()]).toEqual(["app/HomeView.swift"]);
    const read = dir.log.ops.filter((op) => op.startsWith("getFile")).sort();
    expect(read).toEqual([
      "getFile docs/flows/flows/a.md",
      "getFile docs/flows/generated/screens.md",
      "getFile docs/flows/screens.yaml",
      "getFile permissions.yaml",
      "getFile starboard.yaml",
    ]);
  });

  it("stat gives the modified time and size, or null", async () => {
    const { dir, host } = await opened();
    dir.put("docs/flows/screens.yaml", "screens: {}\n", 42);
    expect(await host.stat("docs/flows/screens.yaml")).toEqual({ mtime: 42, size: 12 });
    expect(await host.stat("docs/flows/nope.yaml")).toBeNull();
    expect(await host.stat("nope/deeper.yaml")).toBeNull();
  });

  it("read gives one file's text, or null", async () => {
    const { dir, host } = await opened();
    dir.put("docs/flows/screens.yaml", "screens: {a: 1}\n", 43);
    expect(await host.read("docs/flows/screens.yaml")).toBe("screens: {a: 1}\n");
    expect(await host.read("docs/flows/nope.yaml")).toBeNull();
    expect(await host.read("nope/deeper.yaml")).toBeNull();
  });

  it("writes each file through a temporary file and move()", async () => {
    const { dir, host } = await opened();
    await host.write({ "docs/flows/screens.yaml": "screens: {a: 1}\n", "docs/flows/flows/new.md": "# New\n" });
    expect(dir.read("docs/flows/screens.yaml")).toBe("screens: {a: 1}\n");
    expect(dir.read("docs/flows/flows/new.md")).toBe("# New\n");
    expect(dir.log.ops).toContain("move docs/flows/.screens.yaml.starboard-tmp -> screens.yaml");
    expect(dir.files().some((p) => p.endsWith(".starboard-tmp"))).toBe(false);
  });

  it("overwrites in place, and removes the temporary file, where move() is missing", async () => {
    const { dir, host } = await opened({ canMove: false });
    await host.write({ "docs/flows/screens.yaml": "t\n" });
    expect(dir.read("docs/flows/screens.yaml")).toBe("t\n");
    expect(dir.log.ops).toContain("remove docs/flows/.screens.yaml.starboard-tmp");
    expect(dir.files().some((p) => p.endsWith(".starboard-tmp"))).toBe(false);
  });

  it("removes the temporary file when writing it fails", async () => {
    const { dir, host } = await opened();
    dir.log.failWrite = ".screens.yaml.starboard-tmp";
    await expect(host.write({ "docs/flows/screens.yaml": "x\n" })).rejects.toThrow(/disk full/);
    expect(dir.files().some((p) => p.endsWith(".starboard-tmp"))).toBe(false);
    expect(dir.read("docs/flows/screens.yaml")).toBe("screens: {}\n");
  });

  it("readAll never reads a temporary file left by a crash", async () => {
    const { dir, host } = await opened();
    dir.put("docs/flows/.screens.yaml.starboard-tmp", "half a fi");
    expect(Object.keys(await host.readAll()).some((p) => p.endsWith(".starboard-tmp"))).toBe(false);
  });

  it("deletes generated pages only, and refuses the whole write otherwise", async () => {
    const { dir, host } = await opened();
    await host.write({ "docs/flows/generated/screens.md": null });
    expect(dir.read("docs/flows/generated/screens.md")).toBeUndefined();

    await expect(host.write({ "docs/flows/screens.yaml": "x\n", "docs/flows/flows/a.md": null })).rejects.toBeInstanceOf(
      DeletionRefusedError,
    );
    expect(dir.read("docs/flows/screens.yaml")).toBe("screens: {}\n");
    expect(dir.read("docs/flows/flows/a.md")).toBe("# A\n");
  });

  it("refuses paths outside the project", async () => {
    const { host } = await opened();
    await expect(host.write({ "../escape.txt": "x" })).rejects.toThrow(/not a path inside the project/);
  });
});
