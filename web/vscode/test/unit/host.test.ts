// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// WorkspaceHost against the real starboard.wasm: the two-step scope, .git
// skipped and node_modules deferred until the scope reaches it (lint then
// matches the CLI's), and unsaved buffers laid over the disk.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Diagnostic, Files } from "@c65llc/starboard-core";
import { createNodeCore } from "@c65llc/starboard-core/node";

import { WorkspaceHost } from "../../src/host.ts";
import { Uri } from "vscode";

import { disk } from "./vscode-stub.ts";

/** The core on dist's starboard.wasm, which `make wasm` builds. */
const core = createNodeCore();
afterAll(() => core.close());

/** bin/starboard, which `make build` builds. */
const cli = fileURLToPath(new URL("../../../../bin/starboard", import.meta.url));

const encoder = new TextEncoder();

/** A config whose one root is the folder itself, globbing glob. */
const config = (glob: string) => `version: 1
platforms:
  android:
    formFactors: [phone]
    roots: ["."]
    screenFiles: ["${glob}"]
areas: [home]
`;

/** A glob from the folder itself: scope walks everything, node_modules included. */
const EVERYWHERE = "**/*Screen.kt";
/** A glob that stays in src/: scope walks src/ and never reaches the top node_modules. */
const IN_SRC = "src/**/*Screen.kt";

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

/** The project, without .git, which the CLI globs into and the hosts skip. */
const project = (glob: string): Record<string, string> => ({
  "starboard.yaml": config(glob),
  "docs/flows/screens.yaml": SCREENS,
  "src/HomeScreen.kt": "class HomeScreen\n",
  "README.md": "not a screen\n",
  "node_modules/pkg/VendoredScreen.kt": "class VendoredScreen\n",
  "vendor/node_modules/deep/DeepScreen.kt": "class DeepScreen\n",
});

/** put lays files out on the stub's disk under /p. */
function put(files: Record<string, string>): void {
  disk.clear();
  for (const [name, text] of Object.entries(files)) disk.set(`/p/${name}`, encoder.encode(text));
}

const host = () => new WorkspaceHost(Uri.file("/p"), (files) => core.scope(files));

/** findings is each diagnostic as "rule file:line", sorted. */
const findings = (ds: Diagnostic[]) => ds.map((d) => `${d.rule} ${d.file}:${d.line ?? 0}`).sort();

/** cliFindings writes files to a real folder and lints it with bin/starboard, as a user would. */
function cliFindings(files: Record<string, string>): string[] {
  const dir = mkdtempSync(join(tmpdir(), "starboard-host-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    let out: string;
    try {
      out = execFileSync(cli, ["--dir", dir, "lint", "--json"], { encoding: "utf8" });
    } catch (err) {
      const { status, stdout } = err as { status: number; stdout: string };
      if (status !== 1) throw err;
      out = stdout;
    }
    const report = JSON.parse(out) as { errors: Diagnostic[]; warnings: Diagnostic[] };
    return findings([...report.errors, ...report.warnings]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const lint = async (files: Files) => findings((await core.lint(files)).diagnostics);
const under = (files: Files, dir: string) => Object.keys(files).filter((p) => p.split("/").includes(dir));

describe("WorkspaceHost", () => {
  beforeEach(() => put({ ...project(EVERYWHERE), ".git/HEADScreen.kt": "ref: refs/heads/main\n" }));

  it("reads what the two-step scope names, and never lists .git", async () => {
    const { files, content } = await host().readAll();
    expect(content).toBe("docs/flows");
    expect(files["docs/flows/screens.yaml"]).toBe(SCREENS);
    // Under the root, but not content: present, as "", which lint only checks exists.
    expect(files["src/HomeScreen.kt"]).toBe("");
    expect(files["README.md"]).toBe("");
    expect(under(files, ".git")).toEqual([]);
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
    h.overlay("starboard.yaml", `${config(EVERYWHERE)}content: elsewhere\n`);
    const sel = await h.readAll();
    expect(sel.content).toBe("elsewhere");
    expect(sel.files["docs/flows/screens.yaml"]).toBe(""); // no longer content: only present
  });
});

describe("WorkspaceHost and node_modules (deferred, as the CLI globs into it)", () => {
  it("lists nothing under a node_modules the scope does not reach, and lints as the CLI does", async () => {
    const files = project(IN_SRC);
    put(files);
    const read = (await host().readAll()).files;
    expect(under(read, "node_modules")).toEqual([]);
    expect(await lint(read)).toEqual(cliFindings(files));
  });

  it("lists a node_modules the scope reaches, at any depth, and lints as the CLI does", async () => {
    const files = project(EVERYWHERE);
    put(files);
    const read = (await host().readAll()).files;
    expect(under(read, "node_modules").sort()).toEqual(["node_modules/pkg/VendoredScreen.kt", "vendor/node_modules/deep/DeepScreen.kt"]);
    const ours = await lint(read);
    expect(ours).toContain("unregistered-screen-file node_modules/pkg/VendoredScreen.kt:0");
    expect(ours).toEqual(cliFindings(files));
  });
});
