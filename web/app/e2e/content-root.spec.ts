// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A project whose content root is the folder itself (`content: .`): the
// app reads screens.yaml, flows/ and generated/ at the top, shows its
// screens, and Fix automatically may delete a stale page under generated/.

import { expect, test } from "@playwright/test";

import { travelApp } from "./fixtures/travel-app.ts";
import { cspViolations, hostFiles, openFiles } from "./helpers.ts";
import type { Files } from "./helpers.ts";

const STALE = "generated/wireframes/retired.phone.svg";

/** atRoot is travel-app with its content root moved from docs/flows to the project folder. */
function atRoot(): Files {
  const files: Files = {};
  for (const [path, text] of Object.entries(travelApp())) {
    files[path.startsWith("docs/flows/") ? path.slice("docs/flows/".length) : path] = text;
  }
  files["starboard.yaml"] = (files["starboard.yaml"] ?? "").replace("version: 1\n", "version: 1\ncontent: .\n");
  files[STALE] = files["generated/wireframes/trip.timeline.phone.svg"] ?? "";
  return files;
}

test("a content: . project shows its screens, and Fix deletes a stale generated page", async ({ page }) => {
  const csp = cspViolations(page);
  await page.goto("./");
  await openFiles(page, atRoot(), "travel-app");
  await expect(page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: /^trip\.timeline/ })).toBeVisible({
    timeout: 30_000,
  });

  const lint = page.getByRole("region", { name: "Lint findings" });
  await lint.getByRole("button", { name: /^Fix \d+ automatically$/ }).click();
  await expect(page.getByRole("link", { name: /0 errors, 0 warnings/ })).toBeVisible({ timeout: 30_000 });
  // Keys, not toHaveProperty: Playwright's reads a dotted name as a path.
  const paths = Object.keys(await hostFiles(page));
  expect(paths).not.toContain(STALE);
  expect(paths).toContain("generated/wireframes/trip.timeline.phone.svg");
  expect(paths).toContain("screens.yaml");
  expect(paths).not.toContain("docs/flows/screens.yaml");
  expect(csp).toEqual([]);
});
