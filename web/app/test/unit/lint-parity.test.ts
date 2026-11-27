// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Lint parity with the CLI (#24): the hosts list only what core.scope says
// a project can reach, so the app's lint of what it read must still be the
// CLI's lint of the whole folder. Each project is written to disk with build
// output beside it (dist/, target/, .venv, installed packages), opened as
// the app opens it, through the fsaccess host (Chromium) and as a dropped
// folder (the view-only host, Safari and Firefox), and linted by the real
// starboard.wasm; `starboard lint --json` lints the same folder. Needs
// `make build wasm` (bin/starboard and web/core/dist/), as web/core's
// tests do.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@c65llc/starboard-core";
import type { Diagnostic, StarboardCore } from "@c65llc/starboard-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nodeTransport } from "../../../core/test/node-transport.ts";
import type { Host } from "../../src/host/host.ts";
import { memoryRecentStore, openFolder } from "../../src/host/fsaccess.ts";
import { fromDrop } from "../../src/host/readonly.ts";
import { NodeDir, nodeDropEntry } from "./node-dir.ts";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const cli = join(repo, "bin", "starboard");

const registry = `screens:
  home.main:
    title: Home
    area: home
    purpose: Start here.
    files:
      web: [src/Home.tsx, dist/Home.tsx, dist/Gone.tsx]
      ios: [ios/HomeView.swift]
    screenshots:
      web: shots/home.png
      ios: 'shots/home.png ' 
    layout:
      - {region: title, kind: text, label: Home, requires: edit}
`;

/** config is starboard.yaml with web's screenFiles at the root "." set to web. */
function config(web: string): string {
  return `version: 1
platforms:
  web:
    formFactors: [web-wide]
    roots: ['.']
    screenFiles: ['${web}']
  kit:
    formFactors: [web-wide]
    roots: [app]
    screenFiles: ['**/*.tsx']
  ios:
    formFactors: [phone]
    roots: ['.']
    screenFiles: ['ios/**/*View.swift']
vocabularies:
  requires:
    file: caps.json
    select: .capabilities[].name
areas: [home]
`;
}

/** The project's own files, besides starboard.yaml. */
const project: Record<string, string> = {
  "docs/flows/screens.yaml": registry,
  "caps.json": `{"capabilities": [{"name": "edit"}]}\n`,
  "src/Home.tsx": "export {}\n",
  "src/Other.tsx": "export {}\n",
  "app/Card.tsx": "export {}\n",
  "ios/HomeView.swift": "struct HomeView {}\n",
  "dist/Home.tsx": "export {}\n",
  "shots/home.png": "png",
};

/** What a project folder holds besides the project, and the app should not list. */
const buildOutput: Record<string, string> = {
  "dist/bundle.tsx": "export {}\n",
  "dist/assets/index.js": "x",
  "target/debug/MainView.swift": "x",
  ".venv/lib/site.tsx": "x",
  "node_modules/pkg/Button.tsx": "export {}\n",
  "app/node_modules/kit/Card.tsx": "export {}\n",
};

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** write puts files in a new temporary folder and returns it. */
function write(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "starboard-parity-"));
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    const abs = join(dir, ...path.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return dir;
}

/** lintCLI is `starboard lint --json --strict` of dir: errors, then warnings. */
function lintCLI(dir: string): Diagnostic[] {
  let out: string;
  try {
    out = execFileSync(cli, ["--dir", dir, "lint", "--json", "--strict"], { encoding: "utf8" });
  } catch (err) {
    const { status, stdout } = err as { status: number; stdout: string };
    if (status !== 1) throw err;
    out = stdout;
  }
  const report = JSON.parse(out) as { errors: Diagnostic[]; warnings: Diagnostic[] };
  return [...report.errors, ...report.warnings];
}

describe("the app's lint of a scoped listing", () => {
  let core: StarboardCore;
  beforeAll(() => {
    for (const [path, how] of [
      [cli, "make build"],
      [fileURLToPath(new URL("../../../core/dist/starboard.wasm", import.meta.url)), "make wasm"],
    ] as const) {
      if (!existsSync(path)) throw new Error(`${path} is missing: run ${how} first`);
    }
    core = createClient(nodeTransport());
  });
  afterAll(() => core.close());

  type Via = "fsaccess" | "drop";

  /**
   * lintApp opens dir as the app does, through the fsaccess host or as a
   * dropped folder, and lints what it read. listed is each directory whose
   * entries were read, on the reload alone for fsaccess and from the drop
   * on for a dropped folder.
   */
  async function lintApp(dir: string, via: Via): Promise<{ diagnostics: Diagnostic[]; listed: string[] }> {
    const scope = (files: Record<string, string>) => core.scope(files);
    let host: Host;
    let listed: string[];
    if (via === "fsaccess") {
      const root = new NodeDir(dir, "project");
      host = await openFolder({ scope, store: memoryRecentStore(), picker: () => Promise.resolve(root) });
      root.listed.length = 0;
      listed = root.listed;
    } else {
      listed = [];
      const entry = nodeDropEntry(dir, "project", listed);
      const items = Object.assign([{ kind: "file", webkitGetAsEntry: () => entry }], { length: 1 });
      host = await fromDrop(items as unknown as DataTransferItemList, { scope });
    }
    const files = await host.readAll();
    const res = await core.lint(files, true);
    const order = (d: Diagnostic) => (d.severity === "error" ? 0 : 1);
    return { diagnostics: [...res.diagnostics].sort((a, b) => order(a) - order(b)), listed };
  }

  it.each<Via>(["fsaccess", "drop"])("finds what the CLI finds, without reading dist/, target/, .venv or node_modules/ (%s)", async (via) => {
    const dir = write({ "starboard.yaml": config("src/**/*.tsx"), ...project, ...buildOutput });
    const want = lintCLI(dir);
    const { diagnostics, listed } = await lintApp(dir, via);
    expect(diagnostics).toEqual(want);
    // Not vacuous: a named file outside the walk is missing, a screenshot
    // is, and installed packages under a root are globbed, as the CLI does.
    expect(want.map((d) => `${d.rule} ${d.file} ${d.path}`)).toEqual(
      expect.arrayContaining([
        "file-missing docs/flows/screens.yaml screens.home.main.files.web[2]",
        "screenshot-missing docs/flows/screens.yaml screens.home.main.screenshots.ios",
        "unregistered-screen-file app/node_modules/kit/Card.tsx ",
        "unregistered-screen-file src/Other.tsx ",
      ]),
    );
    if (via === "fsaccess") {
      expect(listed.sort()).toEqual(["app", "app/node_modules", "app/node_modules/kit", "docs/flows", "ios", "src"]);
    } else {
      // A drop reads the folder once, but installed packages only where a root reaches them.
      expect(listed.filter((d) => d.split("/").includes("node_modules")).sort()).toEqual(["app/node_modules", "app/node_modules/kit"]);
    }
  });

  it.each<Via>(["fsaccess", "drop"])("walks the whole folder, and still finds what the CLI finds, when a root of '.' is globbed with ** (%s)", async (via) => {
    const dir = write({ "starboard.yaml": config("**/*.tsx"), ...project, ...buildOutput });
    const want = lintCLI(dir);
    const { diagnostics, listed } = await lintApp(dir, via);
    expect(diagnostics).toEqual(want);
    expect(want.map((d) => d.file)).toEqual(
      expect.arrayContaining(["dist/bundle.tsx", ".venv/lib/site.tsx", "node_modules/pkg/Button.tsx"]),
    );
    expect(listed).toContain(".");
  });

  // Symbolic links. The CLI opens the folder with os.Root: a link that
  // leads outside it is refused, so a root behind one does not exist. Our
  // reading of Chromium's File System Access is that it shows no link at
  // all, so the app sees no such root either, and the two agree.
  it.each<Via>(["fsaccess", "drop"])("agrees with the CLI on a root behind a symbolic link leading out of the project (%s)", async (via) => {
    const outside = write({ "Escaped.tsx": "export {}\n" });
    const dir = write({ "starboard.yaml": config("src/**/*.tsx").replace("roots: [app]", "roots: [app, ext]"), ...project });
    symlinkSync(outside, join(dir, "ext"));
    const want = lintCLI(dir);
    expect(want.map((d) => d.message)).toContain("root ext does not exist");
    expect((await lintApp(dir, via)).diagnostics).toEqual(want);
  });

  // A relative link inside the project is where they differ, as they did
  // before #24: the CLI's os.Root follows it, so it globs the root behind
  // it, while the browser shows no link, so the app reports the root
  // missing. No File System Access call can tell a link apart to follow
  // it; this test pins the difference so a change to either side is seen.
  it.each<Via>(["fsaccess", "drop"])("differs from the CLI on a root behind a symbolic link inside the project (%s)", async (via) => {
    const dir = write({ "starboard.yaml": config("src/**/*.tsx").replace("roots: [app]", "roots: [app, linked]"), ...project });
    symlinkSync("src", join(dir, "linked")); // relative: os.Root refuses any absolute link
    const want = lintCLI(dir);
    const got = (await lintApp(dir, via)).diagnostics;
    const only = (a: Diagnostic[], b: Diagnostic[]) =>
      a.filter((d) => !b.some((e) => JSON.stringify(e) === JSON.stringify(d))).map((d) => `${d.rule} ${d.file} ${d.message}`);
    expect(only(want, got)).toEqual([
      expect.stringMatching(/^unregistered-screen-file linked\/Home\.tsx /),
      expect.stringMatching(/^unregistered-screen-file linked\/Other\.tsx /),
    ]);
    expect(only(got, want)).toEqual(["file-missing starboard.yaml root linked does not exist"]);
  });
});
