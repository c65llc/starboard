// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The tauri host against a fake of the desktop app's Rust commands: a
// bridge whose invoke answers from files held in memory, as list,
// read_text, stat and write answer from disk, and logs every call; and
// the files-changed event Rust's watcher sends, as the page listens for it.

import type { EditOp, Files, LintResult, Model } from "@c65llc/starboard-core";
import { describe, expect, it } from "vitest";

import { DeletionRefusedError, InvalidPathError, NoProjectError } from "../../src/host/host.ts";
import type { ScopeFn } from "../../src/host/host.ts";
import { DesktopError, desktopOpener, FILES_CHANGED, onFilesChanged, TauriHost } from "../../src/host/tauri.ts";
import type { Bridge, Events, Opened, RecentProject } from "../../src/host/tauri.ts";
import { createState, RELOADED_NOTICE } from "../../src/state.ts";
import type { StateCore } from "../../src/state.ts";

// The same scope as host-fsaccess.test.ts: the default content root,
// permissions.yaml read in full, app/ (a root) listed by name, and
// shots/home.png named by a screen.
const scope: ScopeFn = (files) =>
  Promise.resolve({
    content: "docs/flows",
    read: "permissions.yaml" in files ? ["permissions.yaml"] : [],
    present: Object.keys(files).filter((p) => p.startsWith("app/") || p === "shots/home.png"),
    walk: ["app", "docs/flows"],
    named: ["permissions.yaml", "shots/home.png", "shots/gone.png"],
  });

function projectFiles(): Record<string, string> {
  return {
    "starboard.yaml": "version: 1\n",
    "permissions.yaml": "permissions: []\n",
    "docs/flows/screens.yaml": "screens: {}\n",
    "docs/flows/flows/a.md": "# A\n",
    "docs/flows/generated/screens.md": "old\n",
    "app/HomeView.swift": "struct HomeView {}\n",
    "app/node_modules/kit/Card.tsx": "export {}\n",
    "shots/home.png": "png",
    "shots/other.png": "png",
    "notes/todo.txt": "unrelated\n",
    "node_modules/x/package.json": "{}\n",
    "dist/bundle.js": "x",
  };
}

interface Call {
  cmd: string;
  args: Record<string, unknown> | undefined;
}

/** A refusal as Rust's commands reject with one. */
function refusal(name: string, message: string) {
  return { name, message };
}

const BAD = /(^|\/)\.\.(\/|$)|^\/|\\|^[A-Za-z]:/;

/**
 * fakeDesktop is the desktop app as the page sees it: one project, opened
 * as root 0, and the recent list; every call is logged.
 */
function fakeDesktop(files: Record<string, string> = projectFiles()) {
  const calls: Call[] = [];
  let recents: RecentProject[] = [
    { path: "/work/travel-app", name: "travel-app", openedAt: 2 },
    { path: "/work/moved", name: "moved", openedAt: 1 },
  ];
  let dialog: Opened | null = { rootId: 0, name: "travel-app" };
  let arg: Opened | null = null;
  // Each file's modified time: 7 as opened, then a later one at each write,
  // the app's own (write) or an outside editor's (outside).
  const mtimes: Record<string, number> = {};
  let tick = 7;
  // After each write lands, as the watcher would see it (afterWrite).
  let afterWrite: () => void = () => undefined;
  const handlers = new Map<string, ((e: { payload: unknown }) => void)[]>();
  const refuse = (path: string) => {
    if (BAD.test(path)) throw refusal("InvalidPathError", `${JSON.stringify(path)} is not a path inside the project; use a relative path written with /.`);
  };
  const bridge: Bridge = {
    invoke(cmd, args) {
      calls.push({ cmd, args });
      const a = (args ?? {}) as Record<string, unknown>;
      try {
        switch (cmd) {
          case "open_dialog":
            return Promise.resolve(dialog);
          case "open_arg":
            return Promise.resolve(arg);
          case "recents":
            return Promise.resolve(recents);
          case "open_recent": {
            const path = a["path"] as string;
            if (!recents.some((r) => r.path === path)) throw refusal("NotRecentError", "That folder is not among the recent projects.");
            if (path === "/work/moved") {
              recents = recents.filter((r) => r.path !== path);
              throw refusal("MovedError", "moved is no longer at /work/moved, so it was removed from Recent.");
            }
            return Promise.resolve({ rootId: 0, name: "travel-app" });
          }
          case "list": {
            const dir = a["dir"] as string;
            refuse(dir);
            const all = Object.keys(files).sort();
            return Promise.resolve(dir === "." ? all : all.filter((p) => p.startsWith(`${dir}/`)));
          }
          case "read_text": {
            const path = a["path"] as string;
            refuse(path);
            return Promise.resolve(files[path] ?? null);
          }
          case "stat": {
            const path = a["path"] as string;
            refuse(path);
            const text = files[path];
            return Promise.resolve(text === undefined ? null : { mtime: mtimes[path] ?? 7, size: new TextEncoder().encode(text).length });
          }
          case "write": {
            const changes = a["changes"] as Record<string, string | null>;
            for (const [path, text] of Object.entries(changes)) {
              if (text === null) Reflect.deleteProperty(files, path);
              else files[path] = text;
              mtimes[path] = ++tick;
            }
            afterWrite();
            return Promise.resolve(null);
          }
        }
        throw refusal("UnknownCommand", cmd);
      } catch (err) {
        return Promise.reject(err);
      }
    },
  };
  const events: Events = {
    listen(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return Promise.resolve();
    },
  };
  return {
    bridge,
    events,
    calls,
    files,
    /** emit sends event to every listener, as Rust's app.emit does, with no payload. */
    emit(event: string) {
      for (const h of handlers.get(event) ?? []) h({ payload: null });
    },
    /** outside writes path as an editor outside the app would. */
    outside(path: string, text: string) {
      files[path] = text;
      mtimes[path] = ++tick;
    },
    set afterWrite(f: () => void) {
      afterWrite = f;
    },
    get recents() {
      return recents;
    },
    setDialog(o: Opened | null) {
      dialog = o;
    },
    setArg(o: Opened | null) {
      arg = o;
    },
  };
}

function hostOn(fake: ReturnType<typeof fakeDesktop>, s: ScopeFn = scope) {
  return new TauriHost(fake.bridge, { rootId: 0, name: "travel-app" }, s);
}

describe("the tauri host", () => {
  it("is a writable host named after the folder Rust opened", () => {
    const host = hostOn(fakeDesktop());
    expect(host.kind).toBe("tauri");
    expect(host.canWrite).toBe(true);
    expect(host.name).toBe("travel-app");
    expect(host.rootId).toBe(0);
  });

  it("readAll scopes as fsaccess does: the content root and vocabularies read, the rest listed by name", async () => {
    const fake = fakeDesktop();
    const host = hostOn(fake);
    const files = await host.readAll();
    expect(files).toEqual({
      "starboard.yaml": "version: 1\n",
      "permissions.yaml": "permissions: []\n",
      "docs/flows/screens.yaml": "screens: {}\n",
      "docs/flows/flows/a.md": "# A\n",
      "docs/flows/generated/screens.md": "old\n",
      "app/HomeView.swift": "",
      "app/node_modules/kit/Card.tsx": "",
      "shots/home.png": "",
    });
    expect([...host.listedOnly()]).toEqual(["app/HomeView.swift", "app/node_modules/kit/Card.tsx", "shots/home.png"]);
    // Only the folders scope walks are listed: never the whole project,
    // nor node_modules beside them.
    expect(fake.calls.filter((c) => c.cmd === "list").map((c) => c.args)).toEqual([
      { rootId: 0, dir: "app" },
      { rootId: 0, dir: "docs/flows" },
    ]);
    expect(
      fake.calls
        .filter((c) => c.cmd === "read_text")
        .map((c) => c.args?.["path"])
        .sort(),
    ).toEqual(["docs/flows/flows/a.md", "docs/flows/generated/screens.md", "docs/flows/screens.yaml", "permissions.yaml", "starboard.yaml"]);
  });

  it("readAll lists the whole folder when scope says the project can reach anywhere", async () => {
    const whole: ScopeFn = (files) =>
      Promise.resolve({ content: "docs/flows", read: [], present: Object.keys(files).filter((p) => p.startsWith("dist/")), walk: ["."], named: [] });
    const fake = fakeDesktop();
    const files = await hostOn(fake, whole).readAll();
    expect(files["dist/bundle.js"]).toBe("");
    expect(fake.calls.filter((c) => c.cmd === "list").map((c) => c.args)).toEqual([{ rootId: 0, dir: "." }]);
  });

  it("readAll takes a walked folder or a named file Rust refuses as missing, as fsaccess does", async () => {
    const odd: ScopeFn = () =>
      Promise.resolve({ content: "docs/flows", read: [], present: [], walk: ["docs/flows", "../outside"], named: ["../secret.png", "C:\\x.png"] });
    const files = await hostOn(fakeDesktop(), odd).readAll();
    expect(Object.keys(files).sort()).toEqual([
      "docs/flows/flows/a.md",
      "docs/flows/generated/screens.md",
      "docs/flows/screens.yaml",
      "starboard.yaml",
    ]);
  });

  it("readAll of a folder whose starboard.yaml has gone says it is no project", async () => {
    const fake = fakeDesktop({ "docs/flows/screens.yaml": "x" });
    await expect(hostOn(fake).readAll()).rejects.toBeInstanceOf(NoProjectError);
  });

  it("read and stat answer for one file, or null", async () => {
    const host = hostOn(fakeDesktop());
    expect(await host.read?.("docs/flows/screens.yaml")).toBe("screens: {}\n");
    expect(await host.read?.("docs/flows/nope.yaml")).toBeNull();
    expect(await host.stat("docs/flows/screens.yaml")).toEqual({ mtime: 7, size: 12 });
    expect(await host.stat("docs/flows/nope.yaml")).toBeNull();
  });

  it("read and stat refuse a path that is not project-relative before asking Rust", async () => {
    const fake = fakeDesktop();
    const host = hostOn(fake);
    for (const bad of ["../x", "a\\b", "", "a//b"]) {
      await expect(host.stat(bad)).rejects.toBeInstanceOf(InvalidPathError);
      await expect(host.read?.(bad)).rejects.toBeInstanceOf(InvalidPathError);
    }
    expect(fake.calls).toEqual([]);
  });

  it("write sends the changes to Rust's write, for this root", async () => {
    const fake = fakeDesktop();
    const host = hostOn(fake);
    await host.readAll();
    fake.calls.length = 0;
    await host.write({ "docs/flows/screens.yaml": "screens: {a: {}}\n", "docs/flows/generated/screens.md": null });
    expect(fake.calls).toEqual([
      { cmd: "write", args: { rootId: 0, changes: { "docs/flows/screens.yaml": "screens: {a: {}}\n", "docs/flows/generated/screens.md": null } } },
    ]);
    expect(fake.files["docs/flows/screens.yaml"]).toBe("screens: {a: {}}\n");
    expect("docs/flows/generated/screens.md" in fake.files).toBe(false);
  });

  it("write refuses what checkChanges refuses, before any invoke", async () => {
    const fake = fakeDesktop();
    const host = hostOn(fake);
    await host.readAll();
    fake.calls.length = 0;
    await expect(host.write({ "docs/flows/flows/new.md": "# New\n", "starboard.yaml": null })).rejects.toBeInstanceOf(DeletionRefusedError);
    await expect(host.write({ "docs/flows/screens.yaml": null })).rejects.toBeInstanceOf(DeletionRefusedError);
    await expect(host.write({ "../x": "pwned" })).rejects.toBeInstanceOf(InvalidPathError);
    await expect(host.write({ "C:\\x": "pwned" })).rejects.toBeInstanceOf(InvalidPathError);
    expect(fake.calls).toEqual([]);
    expect(fake.files["starboard.yaml"]).toBe("version: 1\n");
  });

  it("a refusal from Rust rejects under Rust's name, with its message", async () => {
    const fake = fakeDesktop();
    const bridge: Bridge = {
      invoke: (cmd, args) =>
        cmd === "write"
          ? Promise.reject(refusal("ContentUnreadError", "The desktop app could not read starboard.yaml's content setting for certain."))
          : fake.bridge.invoke(cmd, args),
    };
    const host = new TauriHost(bridge, { rootId: 0, name: "travel-app" }, scope);
    await host.readAll();
    const err = await host.write({ "docs/flows/screens.yaml": "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DesktopError);
    expect((err as Error).name).toBe("ContentUnreadError");
    expect((err as Error).message).toMatch(/content setting/);
  });

  it("an answer that is not what was asked for is refused", async () => {
    const bridge: Bridge = { invoke: () => Promise.resolve({ not: "a list" }) };
    const host = new TauriHost(bridge, { rootId: 0, name: "x" }, scope);
    await expect(host.stat("a.yaml")).rejects.toThrow(/answer/);
  });
});

describe("opening a project in the desktop app", () => {
  it("Open folder… gives a host for the folder the dialog opened, or null when cancelled", async () => {
    const fake = fakeDesktop();
    const open = desktopOpener(fake.bridge, scope);
    expect(open.kind).toBe("tauri");
    const host = await open.pick();
    expect(host?.kind).toBe("tauri");
    expect(host?.name).toBe("travel-app");
    fake.setDialog(null);
    expect(await open.pick()).toBeNull();
  });

  it("lists the recent projects from Rust and reopens one by its path", async () => {
    const fake = fakeDesktop();
    const open = desktopOpener(fake.bridge, scope);
    expect((await open.recents()).map((r) => r.name)).toEqual(["travel-app", "moved"]);
    const host = await open.reopen("/work/travel-app");
    expect(host.name).toBe("travel-app");
    expect(fake.calls.find((c) => c.cmd === "open_recent")?.args).toEqual({ path: "/work/travel-app" });
  });

  // Review Focus 4: a recent project that has moved says so, and leaves the list.
  it("a recent project that has moved is said to be gone, and is gone from the list", async () => {
    const fake = fakeDesktop();
    const open = desktopOpener(fake.bridge, scope);
    const err = await open.reopen("/work/moved").catch((e: unknown) => e);
    expect((err as Error).name).toBe("MovedError");
    expect((err as Error).message).toMatch(/removed from Recent/);
    expect((await open.recents()).map((r) => r.name)).toEqual(["travel-app"]);
  });

  it("the project the app was started with opens at once, and none gives null", async () => {
    const fake = fakeDesktop();
    const open = desktopOpener(fake.bridge, scope);
    expect(await open.arg()).toBeNull();
    fake.setArg({ rootId: 3, name: "from-the-shell" });
    const host = await open.arg();
    expect(host?.name).toBe("from-the-shell");
    expect((host as TauriHost).rootId).toBe(3);
  });

  it("a recent list or an Opened that is malformed is refused", async () => {
    const bad: Bridge = { invoke: (cmd) => Promise.resolve(cmd === "recents" ? [{ path: 1 }] : { rootId: "0", name: "x" }) };
    const open = desktopOpener(bad, scope);
    await expect(open.recents()).rejects.toThrow(/answer/);
    await expect(open.pick()).rejects.toThrow(/answer/);
  });
});

// stateCore stands in for core's worker: an edit sets each op's key to its
// value; lint and model are empty.
const stateCore: StateCore = {
  edit: (_files: Files, ops: EditOp[]) =>
    Promise.resolve({ files: Object.fromEntries(ops.map((op) => [op.key ?? "", String(op.value)])), diagnostics: [] }),
  lint: (): Promise<LintResult> => Promise.resolve({ diagnostics: [], errors: 0, warnings: 0, passed: true }),
  model: (): Promise<Model> =>
    Promise.resolve({ screens: [], flows: [], areas: [], idPattern: "", refPattern: "", flowIdPattern: "", flowKeys: [], kinds: [], presentations: [] }),
  fix: () => Promise.resolve({ write: {}, remove: [] }),
};

/**
 * watchedApp is the desktop window as desktop.tsx wires it: the app's
 * state on a tauri host, and files-changed running state's checkDisk.
 * checks holds each check files-changed started, to await.
 */
async function watchedApp() {
  const fake = fakeDesktop();
  const state = createState(stateCore);
  await state.open(hostOn(fake));
  const checks: Promise<boolean>[] = [];
  await onFilesChanged(fake.events, () => {
    const check = state.checkDisk();
    checks.push(check);
    return check;
  });
  return { fake, state, checks };
}

const SCREENS = "docs/flows/screens.yaml";

/** Review Focus 3: the project changing on disk while the app is open. */
describe("files-changed in the desktop app", () => {
  it("listens for Rust's files-changed event", async () => {
    const { fake, checks } = await watchedApp();
    expect(FILES_CHANGED).toBe("files-changed");
    fake.emit("something-else");
    expect(checks).toHaveLength(0);
    fake.emit(FILES_CHANGED);
    expect(checks).toHaveLength(1);
    expect(await checks[0]).toBe(false);
  });

  it("after an outside edit, reloads the project and says so", async () => {
    const { fake, state, checks } = await watchedApp();
    fake.outside(SCREENS, "screens: {home: {}}\n");
    fake.emit(FILES_CHANGED);
    expect(checks).toHaveLength(1);
    expect(await checks[0]).toBe(true);
    expect(state.files.value[SCREENS]).toBe("screens: {home: {}}\n");
    expect(state.notice.value).toBe(RELOADED_NOTICE);
    expect(state.reads.value).toBe(2);
  });

  it("right after the app's own write, reloads nothing: its stamps are the write's", async () => {
    const { fake, state, checks } = await watchedApp();
    // The watcher sees the write the moment it lands, before the app has
    // stamped it again.
    fake.afterWrite = () => fake.emit(FILES_CHANGED);
    expect(await state.applyChanges({ [SCREENS]: "screens: {mine: {}}\n" })).toBe("saved");
    expect(checks).toHaveLength(1);
    expect(await checks[0]).toBe(false);
    // And again once things are quiet, as the debounced event comes.
    fake.emit(FILES_CHANGED);
    expect(await checks[1]).toBe(false);
    expect(state.notice.value).toBeNull();
    expect(state.reads.value).toBe(1);
    expect(state.files.value[SCREENS]).toBe("screens: {mine: {}}\n");
  });

  it("keeps an edit whose save failed, as state keeps it, when nothing changed outside", async () => {
    const { fake, state, checks } = await watchedApp();
    // Rust refuses the write (the disk is full, say): the app keeps the edit to save again.
    const invoke = fake.bridge.invoke;
    fake.bridge.invoke = (cmd, args) =>
      cmd === "write" ? Promise.reject(refusal("IoError", "docs/flows/screens.yaml: No space left on device")) : invoke(cmd, args);
    expect(await state.applyChanges({ [SCREENS]: "screens: {draft: {}}\n" })).toBe("failed");
    fake.emit(FILES_CHANGED);
    expect(await checks[0]).toBe(false);
    expect(state.files.value[SCREENS]).toBe("screens: {draft: {}}\n");
    expect([...state.dirty.value]).toEqual([SCREENS]);
    // Save again still works.
    fake.bridge.invoke = invoke;
    expect(await state.retrySave()).toBe("saved");
    expect(fake.files[SCREENS]).toBe("screens: {draft: {}}\n");
  });

  it("an edit being saved when files-changed comes is saved and kept, not reloaded over", async () => {
    const { fake, state, checks } = await watchedApp();
    // The write is held until released, as a slow disk holds it.
    const invoke = fake.bridge.invoke;
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    fake.bridge.invoke = async (cmd, args) => {
      if (cmd === "write") await held;
      return invoke(cmd, args);
    };
    const saving = state.applyChanges({ [SCREENS]: "screens: {editing: {}}\n" });
    await new Promise((r) => setTimeout(r, 0));
    fake.emit(FILES_CHANGED);
    release();
    expect(await saving).toBe("saved");
    expect(await checks[0]).toBe(false);
    expect(state.files.value[SCREENS]).toBe("screens: {editing: {}}\n");
    expect(fake.files[SCREENS]).toBe("screens: {editing: {}}\n");
    expect(state.notice.value).toBeNull();
  });
});
