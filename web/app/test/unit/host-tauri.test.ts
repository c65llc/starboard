// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The tauri host against a fake of the desktop app's Rust commands: a
// bridge whose invoke answers from files held in memory, as list,
// read_text, stat and write answer from disk, and logs every call.

import { describe, expect, it } from "vitest";

import { DeletionRefusedError, InvalidPathError, NoProjectError } from "../../src/host/host.ts";
import type { ScopeFn } from "../../src/host/host.ts";
import { DesktopError, desktopOpener, TauriHost } from "../../src/host/tauri.ts";
import type { Bridge, Opened, RecentProject } from "../../src/host/tauri.ts";

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
            return Promise.resolve(text === undefined ? null : { mtime: 7, size: new TextEncoder().encode(text).length });
          }
          case "write": {
            const changes = a["changes"] as Record<string, string | null>;
            for (const [path, text] of Object.entries(changes)) {
              if (text === null) Reflect.deleteProperty(files, path);
              else files[path] = text;
            }
            return Promise.resolve(null);
          }
        }
        throw refusal("UnknownCommand", cmd);
      } catch (err) {
        return Promise.reject(err);
      }
    },
  };
  return {
    bridge,
    calls,
    files,
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
