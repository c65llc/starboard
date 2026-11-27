// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Lint parity with the CLI (#24): the fsaccess host lists only what
// core.scope says a project can reach, so the app's lint of what it read
// must still be the CLI's lint of the whole folder. Each project is written
// to disk with build output beside it (dist/, target/, .venv, installed
// packages), opened through the fsaccess host over the real folder, and
// linted by the real starboard.wasm; `starboard lint --json` lints the same
// folder. Needs `make build wasm` (bin/starboard and web/core/dist/), as
// web/core's tests do.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@c65llc/starboard-core";
import type { Diagnostic, StarboardCore } from "@c65llc/starboard-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nodeTransport } from "../../../core/test/node-transport.ts";
import { memoryRecentStore, openFolder } from "../../src/host/fsaccess.ts";
import { NodeDir } from "./node-dir.ts";

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
      ios: shots/gone.png
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

  /** lintApp opens dir with the fsaccess host, as the app does, and lints what it read. */
  async function lintApp(dir: string): Promise<{ diagnostics: Diagnostic[]; listed: string[] }> {
    const root = new NodeDir(dir, "project");
    const host = await openFolder({
      scope: (files) => core.scope(files),
      store: memoryRecentStore(),
      picker: () => Promise.resolve(root),
    });
    const files = await host.readAll();
    const res = await core.lint(files, true);
    const order = (d: Diagnostic) => (d.severity === "error" ? 0 : 1);
    return { diagnostics: [...res.diagnostics].sort((a, b) => order(a) - order(b)), listed: root.listed };
  }

  it("finds what the CLI finds, without listing dist/, target/, .venv or node_modules/", async () => {
    const dir = write({ "starboard.yaml": config("src/**/*.tsx"), ...project, ...buildOutput });
    const want = lintCLI(dir);
    const { diagnostics, listed } = await lintApp(dir);
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
    expect(listed.sort()).toEqual([
      "app",
      "app/node_modules",
      "app/node_modules/kit",
      "docs/flows",
      "ios",
      "src",
    ]);
  });

  it("walks the whole folder, and still finds what the CLI finds, when a root of '.' is globbed with **", async () => {
    const dir = write({ "starboard.yaml": config("**/*.tsx"), ...project, ...buildOutput });
    const want = lintCLI(dir);
    const { diagnostics, listed } = await lintApp(dir);
    expect(diagnostics).toEqual(want);
    expect(want.map((d) => d.file)).toEqual(
      expect.arrayContaining(["dist/bundle.tsx", ".venv/lib/site.tsx", "node_modules/pkg/Button.tsx"]),
    );
    expect(listed).toContain(".");
  });
});
