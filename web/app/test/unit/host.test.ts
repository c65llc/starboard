// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { describe, expect, it } from "vitest";

import { checkChanges, DeletionRefusedError, selectFiles } from "../../src/host/host.ts";
import type { Listing, ScopeFn } from "../../src/host/host.ts";
import { createMemoryHost } from "../../src/host/memory.ts";

/** listing serves texts as a folder would. */
function listing(texts: Record<string, string>): Listing & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    paths: Object.keys(texts),
    read: (path) => {
      reads.push(path);
      return Promise.resolve(texts[path] ?? "");
    },
  };
}

// scope stands in for core.scope on a project whose content root is the
// folder itself: src/ is a root, listed by name.
const dotScope: ScopeFn = (files) =>
  Promise.resolve({
    content: ".",
    read: [],
    present: Object.keys(files).filter((p) => p.startsWith("src/")),
  });

describe("selectFiles", () => {
  it("with content '.', reads screens.yaml, flows/ and generated/ at the top, and lists the rest", async () => {
    const l = listing({
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
});
