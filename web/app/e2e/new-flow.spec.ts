// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A project with no flows is not a dead end: New flow opens a dialog whose
// ID is checked against core's form, and adding the flow writes
// flows/<id>.md (core's addFlow, formatted) and opens it in the editor.

import { expect, test } from "./test.ts";
import { coreFormat, cspViolations, expectNoAxeViolations, hostFiles, openFiles, REGISTRY } from "./helpers.ts";

const NEW = "docs/flows/flows/plan-a-day.md";

const noFlows = {
  "starboard.yaml": "version: 1\nplatforms:\n  ios:\n    formFactors: [phone]\nareas: [trip]\n",
  [REGISTRY]: "screens:\n  trip.timeline:\n    title: Timeline\n    area: trip\n    presentation: root\n    status: proposed\n    layout:\n      - {region: days, kind: list}\n",
};

test("a project with no flows offers New flow, and the dialog adds one", async ({ page }) => {
  const csp = cspViolations(page);
  await page.goto("./");
  await openFiles(page, noFlows, "fresh");
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "Flows" }).click();
  await expect(page.getByRole("main")).toContainText("This project has no flows yet: add one with New flow.");

  const open = page.getByRole("button", { name: "New flow" });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "New flow" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("ID")).toBeFocused();
  await expectNoAxeViolations(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  await dialog.getByLabel("ID").fill("Plan a day");
  await dialog.getByLabel("Title").fill("Plan a day");
  await dialog.getByRole("button", { name: "Add flow" }).click();
  await expect(dialog.getByRole("alert")).toContainText("lower-case letters");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("ID").fill("plan-a-day");
  await expect(dialog.getByRole("combobox", { name: "Entry screen" })).toHaveValue("trip.timeline");
  await dialog.getByRole("button", { name: "Add flow" }).click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/#\/flows\/plan-a-day\/edit$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Plan a day");
  await expect(page.getByRole("navigation", { name: "Flows" }).getByRole("link", { name: "Plan a day" })).toHaveAttribute("aria-current", "page");
  const files = await hostFiles(page);
  const text = files[NEW] ?? "";
  expect(text).toBe("---\nid: plan-a-day\ntitle: Plan a day\nstatus: proposed\nentry: trip.timeline\n---\n\n## Steps\n");
  expect((await coreFormat(page, files))[NEW] ?? text).toBe(text);

  // A second flow with the same ID is refused before any edit.
  const again = page.getByRole("navigation", { name: "Flows" }).getByRole("button", { name: "New flow" });
  await again.click();
  await page.getByRole("dialog", { name: "New flow" }).getByLabel("ID").fill("plan-a-day");
  await page.getByRole("dialog", { name: "New flow" }).getByLabel("Title").fill("Again");
  await page.getByRole("dialog", { name: "New flow" }).getByRole("button", { name: "Add flow" }).click();
  await expect(page.getByRole("dialog", { name: "New flow" }).getByRole("alert")).toContainText("already exists");
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});
