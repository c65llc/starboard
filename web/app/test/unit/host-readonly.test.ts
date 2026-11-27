// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { DeletionRefusedError, NoProjectError } from "../../src/host/host.ts";
import type { ScopeFn } from "../../src/host/host.ts";
import { fromDirectoryInput, fromDrop, ReservedPathError } from "../../src/host/readonly.ts";
import type { DropEntry } from "../../src/host/readonly.ts";

const scope: ScopeFn = () => Promise.resolve({ content: "docs/flows", read: [], present: [] });

/** picked is what <input webkitdirectory> gives for a folder: Files with webkitRelativePath. */
function picked(top: string, files: Record<string, string>, lastModified = 5): File[] {
  return Object.entries(files).map(([path, text]) => {
    const file = new File([text], path.split("/").pop() as string, { lastModified });
    Object.defineProperty(file, "webkitRelativePath", { value: `${top}/${path}` });
    return file;
  });
}

const project = {
  "starboard.yaml": "version: 1\n",
  "docs/flows/screens.yaml": "screens: {}\n",
  "docs/flows/flows/a.md": "# A\n",
  "docs/flows/generated/screens.md": "old\n",
  "README.md": "not read\n",
};

describe("fromDirectoryInput", () => {
  it("opens the picked folder view-only, with project-relative paths", async () => {
    const host = await fromDirectoryInput(picked("travel-app", project), { scope });
    expect(host.kind).toBe("readonly");
    expect(host.canWrite).toBe(false);
    expect(host.name).toBe("travel-app");
    expect(await host.readAll()).toEqual({
      "starboard.yaml": "version: 1\n",
      "docs/flows/screens.yaml": "screens: {}\n",
      "docs/flows/flows/a.md": "# A\n",
      "docs/flows/generated/screens.md": "old\n",
    });
    expect(await host.stat("docs/flows/flows/a.md")).toEqual({ mtime: 5, size: 4 });
    expect(await host.stat("nope.md")).toBeNull();
  });

  it("finds the project inside a picked parent folder", async () => {
    const files = picked("Projects", Object.fromEntries(Object.entries(project).map(([p, t]) => [`travel-app/${p}`, t])));
    const host = await fromDirectoryInput(files, { scope });
    expect(host.name).toBe("travel-app");
    expect(Object.keys(await host.readAll())).toContain("starboard.yaml");
  });

  it("refuses a folder with no starboard.yaml", async () => {
    await expect(fromDirectoryInput(picked("photos", { "a.jpg": "x" }), { scope })).rejects.toBeInstanceOf(
      NoProjectError,
    );
  });
});

describe("pending changes", () => {
  it("write collects changes instead of writing, and readAll shows them", async () => {
    const host = await fromDirectoryInput(picked("travel-app", project), { scope });
    await host.write({ "docs/flows/screens.yaml": "screens: {a: 1}\n" });
    await host.write({ "docs/flows/flows/b.md": "# B\n", "docs/flows/generated/screens.md": null });
    await host.write({ "docs/flows/screens.yaml": "screens: {a: 2}\n" });
    expect(host.pending).toEqual({
      "docs/flows/screens.yaml": "screens: {a: 2}\n",
      "docs/flows/flows/b.md": "# B\n",
      "docs/flows/generated/screens.md": null,
    });
    const files = await host.readAll();
    expect(files["docs/flows/screens.yaml"]).toBe("screens: {a: 2}\n");
    expect(files["docs/flows/flows/b.md"]).toBe("# B\n");
    expect(files).not.toHaveProperty("docs/flows/generated/screens.md");
    // The folder on disk is unchanged, so its stamp is too.
    expect(await host.stat("docs/flows/screens.yaml")).toEqual({ mtime: 5, size: 12 });
  });

  it("refuses to delete a file that is not a generated page", async () => {
    const host = await fromDirectoryInput(picked("travel-app", project), { scope });
    await expect(host.write({ "docs/flows/flows/a.md": null })).rejects.toBeInstanceOf(DeletionRefusedError);
    expect(host.pending).toEqual({});
  });

  it("downloadPending gives one changed file as itself", async () => {
    const host = await fromDirectoryInput(picked("travel-app", project), { scope });
    await host.write({ "docs/flows/screens.yaml": "screens: {a: 1}\n" });
    expect(host.downloadName()).toBe("screens.yaml");
    const blob = host.downloadPending();
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("screens: {a: 1}\n");
  });

  it("downloadPending gives several files as a zip with project-relative paths", async () => {
    const host = await fromDirectoryInput(picked("travel-app", project), { scope });
    await host.write({ "docs/flows/screens.yaml": "s\n", "docs/flows/flows/b.md": "# B\n" });
    expect(host.downloadName()).toBe("travel-app-changes.zip");
    const blob = host.downloadPending();
    expect(blob.type).toBe("application/zip");
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.fromEntries(Object.entries(zip).map(([p, d]) => [p, strFromU8(d)]))).toEqual({
      "docs/flows/screens.yaml": "s\n",
      "docs/flows/flows/b.md": "# B\n",
    });
  });

  it("clearPending forgets the changes once downloaded, but the app keeps showing them", async () => {
    const host = await fromDirectoryInput(picked("travel-app", project), { scope });
    await host.write({ "docs/flows/screens.yaml": "s\n", "docs/flows/generated/screens.md": null });
    host.clearPending();
    expect(host.pending).toEqual({});
    expect(host.summary()).toEqual({ changed: [], deleted: [] });
    // The downloaded files are what the project now holds, as far as the app knows.
    const files = await host.readAll();
    expect(files["docs/flows/screens.yaml"]).toBe("s\n");
    expect(files).not.toHaveProperty("docs/flows/generated/screens.md");
  });

  it("summary lists the changed and the deleted paths, sorted", async () => {
    const host = await fromDirectoryInput(picked("travel-app", project), { scope });
    await host.write({ "docs/flows/screens.yaml": "s\n", "docs/flows/flows/b.md": "# B\n" });
    await host.write({ "docs/flows/generated/screens.md": null });
    expect(host.summary()).toEqual({
      changed: ["docs/flows/flows/b.md", "docs/flows/screens.yaml"],
      deleted: ["docs/flows/generated/screens.md"],
    });
  });

  it("one changed file keeps its project-relative path for the UI", async () => {
    const host = await fromDirectoryInput(picked("travel-app", project), { scope });
    await host.write({ "docs/flows/screens.yaml": "s\n" });
    expect(host.downloadPath()).toBe("docs/flows/screens.yaml");
    await host.write({ "docs/flows/flows/b.md": "# B\n" });
    expect(host.downloadPath()).toBeNull();
  });

  it("a deletion makes the download a zip, with .starboard-deleted.txt listing the paths to remove", async () => {
    const host = await fromDirectoryInput(picked("travel-app", project), { scope });
    await host.write({ "docs/flows/screens.yaml": "s\n", "docs/flows/generated/screens.md": null });
    expect(host.downloadPath()).toBeNull();
    expect(host.downloadName()).toBe("travel-app-changes.zip");
    const blob = host.downloadPending();
    expect(blob.type).toBe("application/zip");
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual([".starboard-deleted.txt", "docs/flows/screens.yaml"]);
    expect(strFromU8(zip[".starboard-deleted.txt"] as Uint8Array)).toBe("docs/flows/generated/screens.md\n");
  });

  it("deletions alone download as a zip holding .starboard-deleted.txt", async () => {
    const host = await fromDirectoryInput(picked("travel-app", project), { scope });
    await host.write({ "docs/flows/generated/screens.md": null });
    const zip = unzipSync(new Uint8Array(await host.downloadPending().arrayBuffer()));
    expect(Object.keys(zip)).toEqual([".starboard-deleted.txt"]);
  });

  it("refuses to write the deletions list's own name, which a download needs", async () => {
    const host = await fromDirectoryInput(picked("travel-app", project), { scope });
    await expect(host.write({ ".starboard-deleted.txt": "x\n" })).rejects.toBeInstanceOf(ReservedPathError);
    expect(host.pending).toEqual({});
  });

  it("deleting a file the folder never held only drops its pending creation", async () => {
    const host = await fromDirectoryInput(picked("travel-app", project), { scope });
    await host.write({ "docs/flows/generated/new.md": "x\n" });
    await host.write({ "docs/flows/generated/new.md": null });
    expect(host.pending).toEqual({});
    expect(host.summary()).toEqual({ changed: [], deleted: [] });
  });
});

describe("fromDrop", () => {
  // Entries as webkitGetAsEntry gives them; readEntries answers in batches.
  function dirEntry(name: string, children: DropEntry[]): DropEntry {
    let batches = [children.slice(0, 1), children.slice(1), []];
    return {
      isFile: false,
      isDirectory: true,
      name,
      createReader: () => ({
        readEntries: (ok: (entries: DropEntry[]) => void) => {
          const [next = [], ...rest] = batches;
          batches = rest;
          ok(next);
        },
      }),
    };
  }
  function fileEntry(name: string, text: string): DropEntry {
    return { isFile: true, isDirectory: false, name, file: (ok: (f: File) => void) => ok(new File([text], name)) };
  }
  function items(...entries: DropEntry[]): DataTransferItemList {
    return Object.assign(
      entries.map((e) => ({ kind: "file", webkitGetAsEntry: () => e })),
      { length: entries.length },
    ) as unknown as DataTransferItemList;
  }

  it("opens a dropped project folder", async () => {
    const root = dirEntry("travel-app", [
      fileEntry("starboard.yaml", "version: 1\n"),
      dirEntry("docs", [dirEntry("flows", [fileEntry("screens.yaml", "screens: {}\n")])]),
    ]);
    const host = await fromDrop(items(root), { scope });
    expect(host.name).toBe("travel-app");
    expect(await host.readAll()).toEqual({
      "starboard.yaml": "version: 1\n",
      "docs/flows/screens.yaml": "screens: {}\n",
    });
  });

  it("asks for a folder when files are dropped", async () => {
    await expect(fromDrop(items(fileEntry("starboard.yaml", "")), { scope })).rejects.toThrow(/Drop the project folder/);
  });
});
