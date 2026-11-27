// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The real starboard.wasm, run in a worker thread through the same client
// the browser uses, against the CLI built from the same source. Needs
// `make build wasm` (web/core/dist/ and bin/starboard).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync } from "node:zlib";
import type { Worker } from "node:worker_threads";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createClient, StarboardCrashError, StarboardError } from "../src/client.ts";
import type { StarboardCore } from "../src/client.ts";
import type { Diagnostic, Files } from "../src/types.ts";
import { DIAGNOSTIC, FLOW, keysMatch, LINT, MODEL, REGION, SCOPE, SCREEN, WALK_STEP } from "./keys.ts";
import { dist, nodeTransport } from "./node-transport.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const cli = join(repo, "bin", "starboard");
const wasm = fileURLToPath(new URL("starboard.wasm", dist));
const fixture = fileURLToPath(new URL("./fixtures/trip/", import.meta.url));

/** at is xs[i], failing the test when there is none. */
function at<T>(xs: T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`no element ${i} of ${xs.length}`);
  return x;
}

/** read loads every file under dir as Files, keyed by slash path. */
function read(dir: string): Files {
  const out: Files = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const abs = join(entry.parentPath, entry.name);
      out[relative(dir, abs).split(sep).join("/")] = readFileSync(abs, "utf8");
    }
  }
  return out;
}

interface CLIReport {
  version: number;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

/** lintCLI runs `starboard lint --json` on dir, as a user would. */
function lintCLI(dir: string, strict: boolean): { report: CLIReport; passed: boolean } {
  const args = ["--dir", dir, "lint", "--json", ...(strict ? ["--strict"] : [])];
  try {
    return { report: JSON.parse(execFileSync(cli, args, { encoding: "utf8" })) as CLIReport, passed: true };
  } catch (err) {
    const { status, stdout } = err as { status: number; stdout: string };
    if (status !== 1) throw err;
    return { report: JSON.parse(stdout) as CLIReport, passed: false };
  }
}

beforeAll(() => {
  for (const [path, how] of [
    [wasm, "make wasm"],
    [cli, "make build"],
  ] as const) {
    if (!existsSync(path)) throw new Error(`${path} is missing: run ${how} first`);
  }
});

describe("starboard.wasm", () => {
  let core: StarboardCore;
  const files = read(fixture);

  beforeAll(() => {
    core = createClient(nodeTransport());
  });
  afterAll(() => core.close());

  for (const strict of [false, true]) {
    it(`lint matches the CLI's JSON for the valid fixture (strict: ${strict})`, async () => {
      const { report, passed } = lintCLI(fixture, strict);
      const res = await core.lint(files, strict);
      expect(report.warnings.length).toBeGreaterThan(0); // the comparison is not vacuous
      expect(res.diagnostics.filter((d) => d.severity === "error")).toEqual(report.errors);
      expect(res.diagnostics.filter((d) => d.severity === "warn")).toEqual(report.warnings);
      expect(res.errors).toBe(report.errors.length);
      expect(res.warnings).toBe(report.warnings.length);
      expect(res.passed).toBe(passed);
    });
  }

  it("round trip edit: the edited files lint as Edit said, and model shows the edit", async () => {
    const edit = await core.edit(files, [
      { op: "set", screen: "trip.timeline", key: "title", value: "Days" },
      { op: "insertRegion", screen: "activity.editor", path: "", index: 1, value: { region: "notes", kind: "field", label: "Notes" } },
    ]);
    expect(Object.keys(edit.files)).toEqual(["docs/flows/screens.yaml"]);
    const next = { ...files, ...edit.files };

    const model = await core.model(next);
    const timeline = model.screens.find((s) => s.id === "trip.timeline");
    const editor = model.screens.find((s) => s.id === "activity.editor");
    expect(timeline?.title).toBe("Days");
    expect(editor?.layout.map((r) => r.name)).toEqual(["title", "notes", "save"]);

    // Edit's diagnostics are the lint of its result: the generated files
    // are now stale, and fix brings them back.
    const lint = await core.lint(next);
    expect(lint.diagnostics).toEqual(edit.diagnostics);
    expect(lint.passed).toBe(false);
    const fix = await core.fix(next);
    expect(fix.remove).toEqual([]);
    expect(await core.lint({ ...next, ...fix.write })).toMatchObject({ errors: 0, passed: true });
  });

  it("returns the other results in their documented shapes", async () => {
    expect(await core.format(files)).toEqual({});
    const generated = await core.generate(files);
    for (const [name, data] of Object.entries(generated)) expect(data).toBe(files[name]);
    expect(await core.render(files, "trip.timeline", "phone")).toBe(
      files["docs/flows/generated/wireframes/trip.timeline.phone.svg"],
    );
    const walk = await core.walkthrough(files, "add-activity", "phone");
    expect(walk.steps.map((s) => [s.number, s.screen, s.region, s.next])).toEqual([
      [1, "trip.timeline", "add-activity", "activity.editor"],
      [2, "activity.editor", "title", "activity.editor"],
      [3, "activity.editor", "save", ""],
    ]);
    expect(walk.steps[0]?.svg).toMatch(/^<svg/);
    const model = await core.model(files);
    expect(model.flows.map((f) => f.id)).toEqual(["add-activity", "browse"]);
    expect(await core.scope(files)).toEqual({ content: "docs/flows", read: [], present: [] });
  });

  it("results carry exactly the fields src/types.ts declares (Go to TypeScript drift)", async () => {
    const none = { unknown: [], missing: [] };
    const model = await core.model(files);
    expect(keysMatch(model, MODEL)).toEqual(none);
    const screen = at(model.screens, 0);
    expect(keysMatch(screen, SCREEN)).toEqual(none);
    expect(keysMatch(at(screen.layout, 0), REGION)).toEqual(none);
    expect(keysMatch(at(model.flows, 0), FLOW)).toEqual(none);
    const lint = await core.lint(files);
    expect(keysMatch(lint, LINT)).toEqual(none);
    for (const d of lint.diagnostics) expect(keysMatch(d, DIAGNOSTIC)).toEqual(none);
    expect(lint.diagnostics.length).toBeGreaterThan(0); // not vacuous
    const walk = await core.walkthrough(files, "add-activity", "phone");
    expect(Object.keys(walk)).toEqual(["steps"]);
    expect(keysMatch(at(walk.steps, 0), WALK_STEP)).toEqual(none);
    expect(keysMatch(await core.scope(files), SCOPE)).toEqual(none);
  });

  it("error surfaces as a rejected promise, and the worker carries on", async () => {
    const p = core.render(files, "no.such.screen", "phone");
    await expect(p).rejects.toBeInstanceOf(StarboardError);
    await expect(p).rejects.toThrow("render: unknown screen: no.such.screen");
    await expect(core.lint({})).rejects.toThrow("starboard.yaml");
    expect((await core.lint(files)).passed).toBe(true);
  });
});

describe("a crashed worker", () => {
  it("rejects what was in flight and is restarted for the next call", async () => {
    const workers: Worker[] = [];
    const core = createClient(nodeTransport((w) => workers.push(w)));
    try {
      const files = read(fixture);
      expect((await core.model(files)).screens).toHaveLength(2);
      const inFlight = core.lint(files);
      await at(workers, 0).terminate();
      await expect(inFlight).rejects.toBeInstanceOf(StarboardCrashError);
      expect((await core.model(files)).screens).toHaveLength(2);
      expect(workers).toHaveLength(2);
    } finally {
      core.close();
    }
  });
});

describe("size budget", () => {
  // Amended 2026-11-26: Go 1.27's js/wasm output is 6.9 MB raw, so the raw
  // limit is 8 MB; brotli, the size users download, is the gate that matters.
  it("starboard.wasm is at most 8 MB raw and 2 MB with brotli", () => {
    const bytes = readFileSync(wasm);
    expect(bytes.length).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(brotliCompressSync(bytes).length).toBeLessThanOrEqual(2_000_000);
  });
});
