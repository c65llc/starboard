// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A fresh project with an empty registry is not a dead end: New screen
// opens a dialog whose ID is checked against core's form, and adding the
// screen saves screens.yaml and opens the new screen.

import { expect, test } from "./test.ts";
import { cspViolations, expectNoAxeViolations, hostFiles, openFiles, REGISTRY } from "./helpers.ts";

const empty = {
  "starboard.yaml": "version: 1\nplatforms:\n  ios:\n    formFactors: [phone]\nareas: [home, account]\n",
  [REGISTRY]: "screens: {}\n",
};

test("an empty registry offers New screen, and the dialog adds one", async ({ page }) => {
  const csp = cspViolations(page);
  await page.goto("./");
  await openFiles(page, empty, "fresh");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Screens");
  await expect(page.getByRole("main")).toContainText("No screens yet: add one with New screen.");

  const open = page.getByRole("button", { name: "New screen" });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "New screen" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("ID")).toBeFocused();
  await expectNoAxeViolations(page);

  // Escape closes it and gives focus back.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  await dialog.getByLabel("ID").fill("start");
  await dialog.getByLabel("Title").fill("Start");
  await dialog.getByRole("button", { name: "Add screen" }).click();
  await expect(dialog.getByRole("alert")).toContainText("start is not a screen ID: an ID must match");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("ID").fill("home.start");
  await expect(dialog.getByRole("combobox", { name: "Area" })).toHaveValue("home");
  await dialog.getByRole("combobox", { name: "Presentation" }).selectOption("root");
  await dialog.getByRole("button", { name: "Add screen" }).click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/#\/screens\/home\.start$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Start");
  await expect(page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: /^home\.start/ })).toBeVisible();
  const yaml = (await hostFiles(page))[REGISTRY] ?? "";
  expect(yaml).toMatch(/home\.start:\n\s+title: Start\n\s+area: home\n\s+presentation: root/);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});
