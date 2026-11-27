// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The wireframe outlines the region selected in the tree, as a walkthrough
// step outlines its region, and drops the outline when nothing is selected.

import type { Page } from "@playwright/test";

import { openExample } from "./helpers.ts";
import { expect, test } from "./test.ts";

async function drawn(page: Page): Promise<string> {
  const src = (await page.getByRole("img", { name: /Wireframe of trip\.timeline on phone/ }).getAttribute("src")) ?? "";
  return decodeURIComponent(src.slice("data:image/svg+xml,".length));
}

test("the selected region is outlined on the wireframe", async ({ page }) => {
  await openExample(page);
  await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: /^trip\.timeline/ }).click();
  await expect(page.getByRole("img", { name: /Wireframe of trip\.timeline on phone/ })).toBeVisible();
  expect(await drawn(page)).not.toContain('class="highlight"');

  const tree = page.getByRole("tree", { name: /^Layout/ });
  await tree.getByRole("treeitem", { name: /^add-activity / }).click();
  await expect.poll(() => drawn(page)).toContain('class="highlight"');
  expect(await drawn(page)).not.toContain('class="badge"');
});
