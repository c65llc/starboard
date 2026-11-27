// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A flow changed on disk underneath the editor (an agent, another editor):
// on focus the app reloads it and says so, the editor shows the file as it
// now is, and the next save keeps the outside change.

import { expect, test } from "./test.ts";
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

test("a change to another file reloads, and keeps the flow's unsaved text and fields", async ({ page }) => {
  await page.goto("./");
  await openFiles(page, travelApp(), "travel-app");
  await page.evaluate(() => {
    location.hash = "#/flows/add-activity/edit";
  });
  const editor = page.getByRole("textbox", { name: "Markdown of add-activity.md" });
  await expect(editor).toContainText("## Steps");

  await page.getByRole("group", { name: "Front matter" }).getByLabel("Title", { exact: true }).fill("Add an activity to a day");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Still typing");
  const other = "docs/flows/flows/plan-a-trip.md";
  const text = (await hostFiles(page))[other] ?? "";
  await putFile(page, other, text.replace("title: Plan a trip", "title: Plan a whole trip"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  await expect(page.getByRole("status").filter({ hasText: "Reloaded: changed on disk" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Flows" })).toContainText("Plan a whole trip");
  await expect(editor).toContainText("Still typing");
  await expect(page.getByRole("group", { name: "Front matter" }).getByLabel("Title", { exact: true })).toHaveValue("Add an activity to a day");

  // The autosave, re-armed, writes the draft over the unchanged file.
  await expect.poll(async () => (await hostFiles(page))[FLOW], { timeout: 5_000 }).toContain("Still typing");
  const saved = (await hostFiles(page))[FLOW] ?? "";
  expect(saved).toContain("title: Add an activity to a day");
  expect((await hostFiles(page))[other]).toContain("Plan a whole trip");
});
