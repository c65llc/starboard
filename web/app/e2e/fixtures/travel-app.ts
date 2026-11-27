// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// examples/travel-app read from disk, for the flow specs, with a Mermaid
// diagram added to add-activity: the example's flows have none, and the
// flow editor draws one when a flow has it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { Files } from "../helpers.ts";

const ROOT = fileURLToPath(new URL("../../../../examples/travel-app/", import.meta.url));

export const FLOW = "docs/flows/flows/add-activity.md";

export const DIAGRAM = [
  "```mermaid",
  "flowchart TD",
  '  A["@trip.timeline"] -->|"@trip.timeline#add-activity"| B["@activity.add"]',
  '  B --> C["@activity.place-search"]',
  "  C --> B",
  "  B -->|Save| A",
  "```",
].join("\n");

function walk(dir: string, out: Files): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name !== "README.md") out[relative(ROOT, path).split("\\").join("/")] = readFileSync(path, "utf8");
  }
}

/** travelApp is the example project; withDiagram adds DIAGRAM to add-activity before its Steps. */
export function travelApp({ withDiagram = true } = {}): Files {
  const files: Files = {};
  walk(ROOT, files);
  if (withDiagram) {
    const flow = files[FLOW] ?? "";
    files[FLOW] = flow.replace("## Steps", `${DIAGRAM}\n\n## Steps`);
  }
  return files;
}
