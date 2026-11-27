// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// examples/travel-app read from disk, for the flow specs: its flows have
// Mermaid diagrams whose nodes are @ references.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { Files } from "../helpers.ts";

const ROOT = fileURLToPath(new URL("../../../../examples/travel-app/", import.meta.url));

export const FLOW = "docs/flows/flows/add-activity.md";

function walk(dir: string, out: Files): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name !== "README.md") out[relative(ROOT, path).split("\\").join("/")] = readFileSync(path, "utf8");
  }
}

/** travelApp is the example project, as the app bundles it. */
export function travelApp(): Files {
  const files: Files = {};
  walk(ROOT, files);
  return files;
}
