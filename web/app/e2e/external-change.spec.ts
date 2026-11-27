// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A flow changed on disk underneath the editor (an agent, another editor):
// on focus the app reloads it and says so, the editor shows the file as it
// now is, and the next save keeps the outside change.

import { expect, test } from "@playwright/test";

import { FLOW, travelApp } from "./fixtures/travel-app.ts";
import { hostFiles, openFiles, putFile } from "./helpers.ts";

test("a flow changed on disk reloads on focus, and the next save keeps the change", async ({ page }) => {
  await page.goto("./");
  await openFiles(page, travelApp(), "travel-app");
  await page.evaluate(() => {
    location.hash = "#/flows/add-activity/edit";
  });
  const editor = page.getByRole("textbox", { name: "Markdown of add-activity.md" });
  await expect(editor).toContainText("## Steps");

  // The file changes on disk while the editor holds an unsaved edit. Disk
  // wins, whether the focus check or the autosave notices first.
  const onDisk = (await hostFiles(page))[FLOW] ?? "";
  await putFile(page, FLOW, onDisk.replace("## Steps", "## Steps\n\nAdded outside the app."));
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Unsaved line");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  await expect(page.getByRole("status").filter({ hasText: "Reloaded: changed on disk" })).toBeVisible();
  await expect(editor).toContainText("Added outside the app.");
  await expect(editor).not.toContainText("Unsaved line");

  await editor.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("6. Check @trip.timeline#days.");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toHaveText("Saved · formatted");
  const saved = (await hostFiles(page))[FLOW] ?? "";
  expect(saved).toContain("Added outside the app.");
  expect(saved).toContain("6. Check @trip.timeline#days.");
  expect(saved).not.toContain("Unsaved line");
});
