// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Runs the integration suites in VS Code 1.105.0, the oldest version
// engines.vscode allows, downloaded by @vscode/test-electron, so a run is
// the same on every machine. Each suite opens its own workspace, built
// fresh from examples/ (test/fixtures/fixtures.ts). A later suite joins
// SUITES with the workspace it opens, and suite/<name>.test.ts.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runTests } from "@vscode/test-electron";

import { buildFixtures } from "../fixtures/fixtures.ts";
import type { Fixtures } from "../fixtures/fixtures.ts";

const VERSION = "1.105.0";

/** Each suite, and the fixture workspace it opens. */
const SUITES: [string, keyof Fixtures][] = [
  ["diagnostics", "single"],
  ["multiroot", "multiroot"],
  ["refs", "single"],
  ["refs-anylang", "single"],
  ["lens", "single"],
  ["commands", "commands"],
  ["panel", "panel"],
];

// Bundled into dist-test/, so the package is one folder up.
const extension = resolve(__dirname, "..");
const examples = resolve(extension, "../../examples");
// Each suite's VS Code profile, logs included, kept for CI to upload when a run fails.
const results = join(extension, "test-results");

async function main(): Promise<void> {
  const out = mkdtempSync(join(tmpdir(), "starboard-vscode-"));
  rmSync(results, { recursive: true, force: true });
  try {
    const fixtures = buildFixtures(examples, out);
    // STARBOARD_SUITES=a,b runs only those suites, for a quick loop on one.
    const only = process.env["STARBOARD_SUITES"]?.split(",");
    for (const [suite, name] of SUITES) {
      if (only && !only.includes(suite)) continue;
      const workspace = fixtures[name];
      console.log(`suite ${suite}: ${workspace}`);
      await runTests({
        version: VERSION,
        extensionDevelopmentPath: extension,
        extensionTestsPath: join(extension, "dist-test", "suite", "index.js"),
        // STARBOARD_PANEL_TEST turns on the panel's test-only messages
        // (panel.ts); it is set here and nowhere else.
        extensionTestsEnv: { STARBOARD_SUITE: suite, STARBOARD_WORKSPACE: workspace, STARBOARD_PANEL_TEST: "1" },
        launchArgs: [
          workspace,
          "--disable-extensions",
          "--disable-workspace-trust",
          "--skip-welcome",
          "--skip-release-notes",
          `--user-data-dir=${join(results, suite)}`,
          // Ubuntu 24.04 restricts unprivileged user namespaces through
          // AppArmor, which kills Electron's sandbox on CI's Linux runners.
          ...(process.platform === "linux" ? ["--no-sandbox"] : []),
        ],
      });
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
