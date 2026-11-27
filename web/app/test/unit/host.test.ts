// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { describe, expect, it } from "vitest";

import { checkChanges, DeletionRefusedError, NoProjectError, selectFiles } from "../../src/host/host.ts";
import type { ScopeFn, Tree } from "../../src/host/host.ts";
import { createMemoryHost } from "../../src/host/memory.ts";

/** tree serves texts as a folder would, recording what was walked, probed and read. */
function tree(texts: Record<string, string>): Tree & { walks: string[]; probes: string[]; reads: string[] } {
  const walks: string[] = [];
  const probes: string[] = [];
  const reads: string[] = [];
  return {
    walks,
    probes,
    reads,
    walk: (dir) => {
      walks.push(dir);
      return Promise.resolve(Object.keys(texts).filter((p) => dir === "." || p.startsWith(`${dir}/`)));
    },
    isFile: (path) => {
      probes.push(path);
      return Promise.resolve(path in texts);
    },
    read: (path) => {
      reads.push(path);
      return Promise.resolve(texts[path] ?? "");
    },
  };
}

// scope stands in for core.scope on a project whose content root is the
// folder itself: src/ is a root, listed by name, and screens.yaml is named.
const dotScope: ScopeFn = (files) =>
  Promise.resolve({
    content: ".",
    read: [],
    present: Object.keys(files).filter((p) => p.startsWith("src/")),
    walk: ["flows", "generated", "src"],
    named: ["screens.yaml"],
  });

describe("selectFiles", () => {
  it("with content '.', reads screens.yaml, flows/ and generated/ at the top, and lists the rest", async () => {
    const l = tree({
      "starboard.yaml": "version: 1\ncontent: .\n",
      "screens.yaml": "screens: {}\n",
      "flows/a.md": "# A\n",
      "generated/screens.md": "old\n",
      "src/App.tsx": "export {}\n",
      "notes/todo.txt": "unrelated\n",
    });
    const { files, content, listedOnly } = await selectFiles(l, dotScope);
    expect(content).toBe(".");
    expect(files).toEqual({
      "starboard.yaml": "version: 1\ncontent: .\n",
      "screens.yaml": "screens: {}\n",
      "flows/a.md": "# A\n",
      "generated/screens.md": "old\n",
      "src/App.tsx": "",
    });
    expect(l.reads).not.toContain("src/App.tsx");
    expect([...listedOnly]).toEqual(["src/App.tsx"]);
    expect(l.reads).not.toContain("notes/todo.txt");
    expect(l.walks).toEqual(["flows", "generated", "src"]);
  });

  // scope stands in for core.scope on a project with the content root
  // design/ and a root app/: the configuration names caps.json, and the
  // registry, once read, names a screen's file under dist/ and a screenshot.
  const named: ScopeFn = (files) => {
    const registry = files["design/screens.yaml"] ?? "";
    const names = ["caps.json", ...(registry.includes("dist/") ? ["dist/Home.tsx", "shots/home.png"] : [])];
    return Promise.resolve({
      content: "design",
      read: "caps.json" in files ? ["caps.json"] : [],
      present: Object.keys(files).filter((p) => p.startsWith("app/") || p.startsWith("dist/") || p.startsWith("shots/")),
      walk: ["app", "design"],
      named: names,
    });
  };

  it("walks only the directories scope names, and asks for the files it names one by one", async () => {
    const l = tree({
      "starboard.yaml": "version: 1\n",
      "design/screens.yaml": "files: [dist/Home.tsx]\n",
      "caps.json": "{}\n",
      "app/Card.tsx": "x",
      "dist/Home.tsx": "x",
      "dist/bundle.js": "x",
      "target/debug/app": "x",
      ".venv/lib/site.py": "x",
    });
    const { files, listedOnly } = await selectFiles(l, named);
    expect(files).toEqual({
      "starboard.yaml": "version: 1\n",
      "design/screens.yaml": "files: [dist/Home.tsx]\n",
      "caps.json": "{}\n",
      "app/Card.tsx": "",
      "dist/Home.tsx": "",
    });
    expect([...listedOnly].sort()).toEqual(["app/Card.tsx", "dist/Home.tsx"]);
    // Each directory once; the files named once each, missing ones included.
    expect(l.walks).toEqual(["app", "design"]);
    expect(l.probes).toEqual(["caps.json", "dist/Home.tsx", "shots/home.png"]);
    expect(l.reads.sort()).toEqual(["caps.json", "design/screens.yaml", "starboard.yaml"]);
  });

  it("walks the whole folder when scope says the project can reach anywhere", async () => {
    const whole: ScopeFn = (files) =>
      Promise.resolve({
        content: "docs/flows",
        read: [],
        present: Object.keys(files).filter((p) => p.endsWith(".tsx")),
        walk: ["."],
        named: [],
      });
    const l = tree({ "starboard.yaml": "version: 1\n", "dist/bundle.tsx": "x", "src/App.tsx": "x" });
    const { files } = await selectFiles(l, whole);
    expect(l.walks).toEqual(["."]);
    expect(l.probes).toEqual([]);
    expect(files).toEqual({ "starboard.yaml": "version: 1\n", "dist/bundle.tsx": "", "src/App.tsx": "" });
  });
});

describe("checkChanges", () => {
  it("with content '.', deletes only under the top-level generated/", () => {
    expect(() => checkChanges({ "generated/screens.md": null, "screens.yaml": "x\n" }, ".")).not.toThrow();
    expect(() => checkChanges({ "flows/a.md": null }, ".")).toThrow(DeletionRefusedError);
    expect(() => checkChanges({ "docs/flows/generated/x.md": null }, ".")).toThrow(DeletionRefusedError);
  });

  it("with any other content root, deletes only under <content>/generated/", () => {
    expect(() => checkChanges({ "design/generated/x.md": null }, "design")).not.toThrow();
    expect(() => checkChanges({ "generated/x.md": null }, "design")).toThrow(DeletionRefusedError);
  });
});

describe("the memory host", () => {
  it("given scope, takes its content root from it, so a content '.' project deletes its generated pages", async () => {
    const host = createMemoryHost(
      { "starboard.yaml": "version: 1\ncontent: .\n", "screens.yaml": "screens: {}\n", "generated/old.md": "old\n" },
      { name: "p", scope: dotScope },
    );
    expect(Object.keys(await host.readAll())).toContain("screens.yaml");
    await host.write({ "generated/old.md": null });
    expect(await host.stat("generated/old.md")).toBeNull();
    await expect(host.write({ "screens.yaml": null })).rejects.toBeInstanceOf(DeletionRefusedError);
  });

  it("refuses a project without starboard.yaml, as the folder hosts do, before asking scope", async () => {
    let asked = false;
    const scope: ScopeFn = (files) => {
      asked = true;
      return dotScope(files);
    };
    const host = createMemoryHost({ "docs/flows/screens.yaml": "screens: {}\n" }, { name: "loose", scope });
    await expect(host.readAll()).rejects.toBeInstanceOf(NoProjectError);
    await expect(host.readAll()).rejects.toThrow(/^loose has no starboard\.yaml/);
    expect(asked).toBe(false);
  });

  it("reads one file, or null for a missing one", async () => {
    const host = createMemoryHost({ "starboard.yaml": "version: 1\n" }, { name: "p" });
    expect(await host.read("starboard.yaml")).toBe("version: 1\n");
    expect(await host.read("nope.md")).toBeNull();
  });
});
