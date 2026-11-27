// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Walk through (#/flows/<id>/walk[/<step>]), on the example project's
// add-activity flow: the storyboard strip, the current step's highlighted
// wireframe and details, Previous and Next, the strip's arrow keys, the
// form factor select, and a step that names no screen.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { FLOW, travelApp } from "./fixtures/travel-app.ts";
import { cspViolations, expectNoAxeViolations, openFiles } from "./helpers.ts";
import type { Files } from "./helpers.ts";

const strip = (page: Page) => page.getByRole("list", { name: "Steps" });
const stepButtons = (page: Page) => strip(page).getByRole("button");
const current = (page: Page) => page.getByRole("region", { name: "Current step" });
const wireframe = (page: Page) => current(page).getByRole("img", { name: /^Wireframe of / });

async function openWalk(page: Page, hash = "#/flows/add-activity/walk", files: Files = travelApp()): Promise<void> {
  await page.goto("./");
  await openFiles(page, files, "travel-app");
  await expect(page.getByRole("link", { name: /^Lint:/ })).toBeVisible({ timeout: 30_000 });
  await page.goto(`./${hash}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Add an activity");
}

async function expectStep(page: Page, n: number, screen: string, region: string): Promise<void> {
  await expect(stepButtons(page).nth(n - 1)).toHaveAttribute("aria-current", "step");
  await expect(strip(page).locator('[aria-current="step"]')).toHaveCount(1);
  await expect(current(page)).toContainText(`Step ${n} of 5`);
  await expect(wireframe(page)).toHaveAttribute("alt", new RegExp(`^Wireframe of ${screen} on \\S+, ${region} highlighted$`));
}

test("steps render: the five steps of add-activity, the first one's wireframe and details; axe finds nothing", async ({ page }) => {
  const csp = cspViolations(page);
  await openWalk(page);
  await expect(page.getByRole("navigation", { name: "Mode" }).getByRole("link", { name: "Walk through" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(stepButtons(page)).toHaveCount(5);
  await expect(stepButtons(page).first()).toHaveAccessibleName(/^Step 1 Tap @trip\.timeline#add-activity\. trip\.timeline$/);
  await expectStep(page, 1, "trip.timeline", "add-activity");
  await expect(wireframe(page)).toHaveAttribute("src", /^data:image\/svg\+xml,/);
  await expect(current(page).locator("svg")).toHaveCount(0); // drawn as an image, never inlined

  const details = current(page).getByRole("definition");
  await expect(current(page).getByRole("link", { name: "@trip.timeline", exact: true })).toHaveAttribute("href", "#/screens/trip.timeline");
  await expect(details.filter({ hasText: "#add-activity" })).toHaveCount(1);
  await expect(current(page).getByRole("link", { name: "@activity.add", exact: true })).toHaveAttribute("href", "#/screens/activity.add");
  const other = page.getByRole("list", { name: "Other paths from this step" });
  await expect(other).toContainText("If the traveller cannot edit logistics, the button is hidden.");
  await expect(page.getByRole("button", { name: "Previous step" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next step" })).toBeEnabled();

  await expectNoAxeViolations(page);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("next moves highlight: Next and Previous change the step, its address and the wireframe; Back returns", async ({ page }) => {
  await openWalk(page);
  const first = await wireframe(page).getAttribute("src");
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page).toHaveURL(/#\/flows\/add-activity\/walk\/2$/);
  await expectStep(page, 2, "activity.add", "title");
  expect(await wireframe(page).getAttribute("src")).not.toBe(first);
  await expect(page.getByRole("button", { name: "Previous step" })).toBeEnabled();

  await page.goBack();
  await expect(page).toHaveURL(/#\/flows\/add-activity\/walk$/);
  await expectStep(page, 1, "trip.timeline", "add-activity");

  // A step can be linked to; at the last one Next is disabled and focus stays on a button.
  await page.goto("./#/flows/add-activity/walk/4");
  await expectStep(page, 4, "activity.place-search", "results");
  await page.getByRole("button", { name: "Next step" }).click();
  await expectStep(page, 5, "activity.add", "save");
  await expect(page.getByRole("button", { name: "Next step" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Previous step" })).toBeFocused();
  await expect(current(page)).toContainText("End of the flow");

  // A step picked in the strip.
  await stepButtons(page).nth(2).click();
  await expectStep(page, 3, "activity.add", "day");
  await expectNoAxeViolations(page);
});

test("keyboard arrows: the strip is one Tab stop; arrows, Home and End move the step and focus follows", async ({ page }) => {
  await openWalk(page);
  await expect(stepButtons(page).first()).toHaveAttribute("tabindex", "0");
  for (const i of [1, 2, 3, 4]) await expect(stepButtons(page).nth(i)).toHaveAttribute("tabindex", "-1");
  await stepButtons(page).first().focus();
  await page.keyboard.press("ArrowRight");
  await expectStep(page, 2, "activity.add", "title");
  await expect(stepButtons(page).nth(1)).toBeFocused();
  await expect(stepButtons(page).nth(1)).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("End");
  await expectStep(page, 5, "activity.add", "save");
  await expect(stepButtons(page).nth(4)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(stepButtons(page).nth(4)).toBeFocused();
  await page.keyboard.press("Home");
  await expectStep(page, 1, "trip.timeline", "add-activity");
  await page.keyboard.press("ArrowLeft");
  await expect(stepButtons(page).first()).toBeFocused();
  await expect(page).toHaveURL(/#\/flows\/add-activity\/walk(\/1)?$/);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expectStep(page, 1, "trip.timeline", "add-activity");
});

test("the form factor select redraws the walkthrough and is remembered for the session", async ({ page }) => {
  await openWalk(page);
  const select = page.getByRole("combobox", { name: "Form factor" });
  await expect(select.getByRole("option")).toHaveText(["phone", "web-narrow", "web-wide"]);
  await expect(select).toHaveValue("phone");
  await expect(wireframe(page)).toHaveAttribute("alt", /on phone,/);
  await select.selectOption("web-wide");
  await expect(wireframe(page)).toHaveAttribute("alt", /^Wireframe of trip\.timeline on web-wide, add-activity highlighted$/);

  await page.getByRole("navigation", { name: "Mode" }).getByRole("link", { name: "Edit" }).click();
  await page.getByRole("navigation", { name: "Mode" }).getByRole("link", { name: "Walk through" }).click();
  await expect(select).toHaveValue("web-wide");
  await expect(wireframe(page)).toHaveAttribute("alt", /on web-wide,/);
});

test("step without ref message: the step says how to name its screen, with lint's warning", async ({ page }) => {
  const files = travelApp();
  files[FLOW] = (files[FLOW] ?? "").replace("3. Choose the day in @activity.add#day.", "3. Choose the <b>day</b>.");
  await openWalk(page, "#/flows/add-activity/walk/3", files);
  await expect(stepButtons(page)).toHaveCount(5);
  await expect(stepButtons(page).nth(2)).toHaveAttribute("aria-current", "step");
  await expect(current(page)).toContainText("This step names no screen. Add @screen#region to show it.");
  await expect(current(page)).toContainText("step-without-ref");
  await expect(current(page)).toContainText("step 3 has no @screen reference");
  await expect(current(page).getByRole("img")).toHaveCount(0);
  // Step text is text: markup in it is shown, never parsed.
  await expect(current(page).locator("b")).toHaveCount(0);
  await expect(current(page)).toContainText("Choose the <b>day</b>.");
  // The step before it leads to a step that names no screen.
  await page.getByRole("button", { name: "Previous step" }).click();
  await expect(current(page)).toContainText("A step that names no screen");
  await page.getByRole("button", { name: "Next step" }).click();
  await expectNoAxeViolations(page);
});
