// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The integration tests' workspaces, built from the repository's examples/
// into a temporary folder for each run, so they never drift from the
// examples and a test's edits never touch the repository.

import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The file the tests edit, project-relative. */
export const SCREENS = "docs/flows/screens.yaml";

/** The rule an area missing from starboard.yaml's areas breaks (internal/lint). */
export const UNKNOWN_AREA = "unknown-area";

/**
 * misplace sets the first screen's area in a screens.yaml's text to
 * "nowhere", which no project lists, and returns the text and that line
 * (0-based). It edits the test's text; the extension itself never reads
 * screens.yaml but through core.
 */
export function misplace(text: string): { text: string; line: number } {
  const lines = text.split("\n");
  const line = lines.findIndex((l) => /^ {4}area: /.test(l));
  if (line < 0) throw new Error(`no screen area in ${SCREENS}`);
  lines[line] = "    area: nowhere";
  return { text: lines.join("\n"), line };
}

export interface Fixtures {
  /** One folder: a clean copy of examples/travel-app. */
  single: string;
  /**
   * A .code-workspace of two roots: one/ is examples/travel-app, clean;
   * two/ holds examples/desktop-notes in app/ (a project in a subfolder),
   * with its first screen's area misplaced on disk, and loose/, under no
   * project, holding a copy of that broken screens.yaml.
   */
  multiroot: string;
  /** Another clean copy of examples/travel-app, for the suite that writes to it (commands). */
  commands: string;
}

/** buildFixtures copies the examples under out and returns the paths to open. */
export function buildFixtures(examples: string, out: string): Fixtures {
  const single = join(out, "single");
  cpSync(join(examples, "travel-app"), single, { recursive: true });

  const multi = join(out, "multi");
  cpSync(join(examples, "travel-app"), join(multi, "one"), { recursive: true });
  const app = join(multi, "two", "app");
  cpSync(join(examples, "desktop-notes"), app, { recursive: true });
  const broken = misplace(readFileSync(join(app, SCREENS), "utf8")).text;
  writeFileSync(join(app, SCREENS), broken);
  mkdirSync(join(multi, "two", "loose"), { recursive: true });
  writeFileSync(join(multi, "two", "loose", "screens.yaml"), broken);
  const multiroot = join(multi, "multi.code-workspace");
  writeFileSync(multiroot, JSON.stringify({ folders: [{ path: "one" }, { path: "two" }] }, null, 2));

  const commands = join(out, "commands");
  cpSync(join(examples, "travel-app"), commands, { recursive: true });

  return { single, multiroot, commands };
}
