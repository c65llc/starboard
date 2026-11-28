// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// WorkspaceHost against the real starboard.wasm: the two-step scope, the
// skipped folders, and unsaved buffers laid over the disk.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createNodeCore } from "@c65llc/starboard-core/node";

import { WorkspaceHost } from "../../src/host.ts";
import { Uri } from "vscode";

import { disk } from "./vscode-stub.ts";

/** The core on dist's starboard.wasm, which `make wasm` builds. */
const core = createNodeCore();
afterAll(() => core.close());

const encoder = new TextEncoder();

/** A root of "." with a screenFiles glob, so scope walks the whole folder, and a glob that would match under .git and node_modules. */
const CONFIG = `version: 1
platforms:
  android:
    formFactors: [phone]
    roots: ["."]
    screenFiles: ["**/*Screen.kt"]
areas: [home]
`;

const SCREENS = `screens:
  home.main:
    title: Home
    area: home
    purpose: The first screen.
    presentation: root
    files:
      android: [src/HomeScreen.kt]
    layout:
      - {region: title, kind: text, label: Home}
`;

beforeEach(() => {
  disk.clear();
  const files: Record<string, string> = {
    "starboard.yaml": CONFIG,
    "docs/flows/screens.yaml": SCREENS,
    "src/HomeScreen.kt": "class HomeScreen\n",
    "README.md": "not the project's\n",
    ".git/HEADScreen.kt": "ref: refs/heads/main\n",
    "node_modules/pkg/VendoredScreen.kt": "class VendoredScreen\n",
    "vendor/node_modules/deep/DeepScreen.kt": "class DeepScreen\n",
  };
  for (const [name, text] of Object.entries(files)) disk.set(`/p/${name}`, encoder.encode(text));
});

const host = () => new WorkspaceHost(Uri.file("/p"), (files) => core.scope(files));

describe("WorkspaceHost", () => {
  it("reads what the two-step scope names, and only that", async () => {
    const { files, content } = await host().readAll();
    expect(content).toBe("docs/flows");
    // The root "." reaches the whole folder, but for the skipped ones.
    expect(Object.keys(files).sort()).toEqual(["README.md", "docs/flows/screens.yaml", "src/HomeScreen.kt", "starboard.yaml"]);
    expect(files["docs/flows/screens.yaml"]).toBe(SCREENS);
    // Under the root, but not content: present, as "", which lint only checks exists.
    expect(files["src/HomeScreen.kt"]).toBe("");
    expect(files["README.md"]).toBe("");
  });

  it("never lists .git or node_modules, at any depth, even where a screenFiles glob matches", async () => {
    const { files } = await host().readAll();
    for (const name of Object.keys(files)) {
      expect(name.split("/")).not.toContain(".git");
      expect(name.split("/")).not.toContain("node_modules");
    }
    const { diagnostics } = await core.lint((await host().readAll()).files);
    expect(diagnostics.filter((d) => d.rule === "unregistered-screen-file")).toEqual([]);
  });

  it("reads an unsaved buffer instead of the file, and the file again once it is cleared", async () => {
    const h = host();
    const edited = SCREENS.replace("area: home", "area: nowhere");
    h.overlay("docs/flows/screens.yaml", edited);
    expect((await h.readAll()).files["docs/flows/screens.yaml"]).toBe(edited);
    h.overlay("docs/flows/screens.yaml", null);
    expect((await h.readAll()).files["docs/flows/screens.yaml"]).toBe(SCREENS);
  });

  it("lists a buffer whose file is not on disk, and an overlaid starboard.yaml rescopes", async () => {
    const h = host();
    h.overlay("docs/flows/flows/new.md", "---\ntitle: New\n---\n");
    expect((await h.readAll()).files["docs/flows/flows/new.md"]).toBe("---\ntitle: New\n---\n");
    h.overlay("starboard.yaml", `${CONFIG}content: elsewhere\n`);
    const sel = await h.readAll();
    expect(sel.content).toBe("elsewhere");
    expect(sel.files["docs/flows/screens.yaml"]).toBe(""); // no longer content: only present
  });
});
