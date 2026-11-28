// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The desktop app's window freezes Object.prototype before the page runs
// (Tauri's freezePrototype, web/desktop/src-tauri/tauri.conf.json). A
// library that assigns a property Object.prototype already has (valueOf,
// toString) to its own prototype then throws in strict code (the override
// mistake), and the app renders nothing: @preact/signals-core did, until
// web/patches/ fixed it. This runs the app under the same freeze, through
// every view (the editors, Mermaid and ELK included), so the next
// dependency that does it fails here rather than as a blank window.

import { expect, test } from "./test.ts";

test("the app runs with Object.prototype frozen, as the desktop app's window has it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.addInitScript(() => {
    Object.freeze(Object.prototype);
  });
  await page.goto("./");
  expect(await page.evaluate(() => Object.isFrozen(Object.prototype))).toBe(true);
  await page.getByRole("button", { name: "Explore the example project" }).click();
  await expect(page.getByRole("link", { name: /0 errors, 0 warnings/ })).toBeVisible({ timeout: 30_000 });
  for (const [hash, heading] of [
    ["#/screens/trip.timeline", "Timeline"],
    ["#/flows", "Flows"],
    ["#/flows/add-activity/edit", "Add an activity"],
    ["#/flows/add-activity/walk", "Add an activity"],
    ["#/map", "App map"],
  ] as const) {
    await page.evaluate((h) => {
      location.hash = h;
    }, hash);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading, { timeout: 15_000 });
  }
  // The map lays out in ELK's worker, then draws its screens.
  await expect(page.locator(".map-node").first()).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});
