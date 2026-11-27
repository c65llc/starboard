// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The screen editor, on the example project in a memory host: the list,
// the wireframe, the region tree by keyboard, the inspector's edits, the
// lint panel and Fix automatically, Override layout and the Source tab.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { changedPaths, coreFormat, cspViolations, expectNoAxeViolations, hostFiles, openExample, REGISTRY } from "./helpers.ts";

async function openTimeline(page: Page): Promise<void> {
  await openExample(page);
  await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: /^trip\.timeline/ }).click();
  await expect(page).toHaveURL(/#\/screens\/trip\.timeline$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Timeline");
}

const tree = (page: Page) => page.getByRole("tree", { name: /^Layout/ });
const region = (page: Page, name: string) => tree(page).getByRole("treeitem", { name: new RegExp(`^${name} `) });
const saveStatus = (page: Page) => page.getByRole("status").filter({ hasText: /Saved|Not saved|kept/ });

async function treeOrder(page: Page): Promise<string[]> {
  const names = await tree(page).getByRole("treeitem").allTextContents();
  return names.map((n) => n.trim().split(/\s+/)[0] ?? "");
}

test("shows a screen: header, form factors, wireframe as an image, references; axe finds nothing", async ({ page }) => {
  const csp = cspViolations(page);
  await openTimeline(page);
  const main = page.getByRole("main");
  await expect(main.getByText("trip.timeline", { exact: true }).first()).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "View" });
  await expect(tabs.getByRole("tab")).toHaveText(["phone", "web-narrow", "web-wide · override", "Source"]);
  await expect(tabs.getByRole("tab", { name: "phone" })).toHaveAttribute("aria-selected", "true");

  const wireframe = page.getByRole("img", { name: /Wireframe of trip\.timeline on phone/ });
  await expect(wireframe).toBeVisible();
  const src = await wireframe.getAttribute("src");
  expect(src?.startsWith("data:image/svg+xml,")).toBe(true);
  expect(await page.locator("main svg").count()).toBe(0); // never inlined

  const refs = page.getByRole("region", { name: "References" });
  await expect(refs).toContainText("Used in flows");
  await expect(refs.getByRole("link", { name: /Add an activity/i })).toHaveAttribute("href", /#\/flows\/add-activity/);
  await expect(refs).toContainText("Navigates to");
  await expect(refs.getByRole("link", { name: "activity.add" })).toBeVisible();

  await page.getByRole("tab", { name: "web-wide · override" }).click();
  await expect(page.getByRole("img", { name: /on web-wide/ })).toBeVisible();
  await expect(tree(page)).toHaveAccessibleName("Layout · web-wide");
  await expect(region(page, "shell")).toBeVisible();

  await expectNoAxeViolations(page);
  // Reduced motion: no colour transition is caught half way.
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("the screen list filters by text and by status:proposed", async ({ page }) => {
  await openExample(page);
  const list = page.getByRole("navigation", { name: "Screens" });
  const filter = list.getByRole("searchbox", { name: "Filter screens" });
  await filter.fill("activity.");
  await expect(list.getByRole("link")).toHaveText([/^activity\.add/, /^activity\.detail/, /^activity\.place-search/]);
  await filter.fill("status:proposed");
  await expect(list.getByRole("link")).toHaveText([/^trip\.invite.*proposed/]);
  await filter.fill("nothing-matches-this");
  await expect(list).toContainText("No screens match");
});

test("edit label: changes the memory host's screens.yaml and nothing else, formatted as core.format would", async ({ page }) => {
  await openTimeline(page);
  const before = await hostFiles(page);
  await region(page, "add-activity").click();
  const inspector = page.getByRole("form", { name: "Region · add-activity" });
  const label = inspector.getByLabel("Label", { exact: true });
  await expect(label).toHaveValue("Add activity");
  await label.fill("Add a plan");
  await label.press("Enter");
  await expect(saveStatus(page)).toHaveText(/Saved/);

  const after = await hostFiles(page);
  expect(changedPaths(before, after)).toEqual([REGISTRY]);
  const count = (text: string | undefined, of: string) => (text ?? "").split(of).length - 1;
  expect(count(after[REGISTRY], "label: Add a plan")).toBe(1);
  expect(count(after[REGISTRY], "label: Add activity")).toBe(count(before[REGISTRY], "label: Add activity") - 1);
  expect(await coreFormat(page, after)).not.toHaveProperty(REGISTRY);
  await expect(page.getByRole("img", { name: /Wireframe of trip\.timeline/ })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("the inspector's kind and presentation are selects, and to is a combobox of screen IDs", async ({ page }) => {
  await openTimeline(page);
  await region(page, "add-activity").click();
  const inspector = page.getByRole("form", { name: "Region · add-activity" });
  const kind = inspector.getByRole("combobox", { name: "Kind" });
  await expect(kind).toHaveValue("primary-action");
  expect(await kind.locator("option").allTextContents()).toContain("card");
  const to = inspector.getByRole("combobox", { name: "Navigates to" });
  await expect(to).toHaveValue("activity.add");
  const options = await page.locator(`datalist#${await to.getAttribute("list")} option`).evaluateAll((os) =>
    os.map((o) => (o as HTMLOptionElement).value),
  );
  expect(options).toContain("trip.members");
  const presentation = page.getByRole("form", { name: "Screen" }).getByRole("combobox", { name: "Presentation" });
  await expect(presentation).toHaveValue("push");
  await presentation.selectOption("sheet");
  await expect(saveStatus(page)).toHaveText(/Saved/);
  expect((await hostFiles(page))[REGISTRY]).toMatch(/trip\.timeline:\n(?:.*\n)*?\s+presentation: sheet/);
});

test("move region by keyboard: arrows move focus, Enter selects, Alt+Up moves the region", async ({ page }) => {
  await openTimeline(page);
  expect(await treeOrder(page)).toEqual(["app-bar", "title", "members", "days", "item", "add-activity", "tabs"]);
  await region(page, "app-bar").focus();
  await page.keyboard.press("ArrowDown");
  await expect(region(page, "title")).toBeFocused();
  await page.keyboard.press("End");
  await expect(region(page, "tabs")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(region(page, "add-activity")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(region(page, "add-activity")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("form", { name: "Region · add-activity" })).toBeVisible();

  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => treeOrder(page)).toEqual(["app-bar", "title", "members", "add-activity", "days", "item", "tabs"]);
  await expect(region(page, "add-activity")).toBeFocused();
  await expect(region(page, "add-activity")).toHaveAttribute("aria-selected", "true");
  const yaml = (await hostFiles(page))[REGISTRY] ?? "";
  const timeline = yaml.slice(yaml.indexOf("  trip.timeline:"));
  expect(timeline.indexOf("region: add-activity")).toBeLessThan(timeline.indexOf("region: days"));

  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => treeOrder(page)).toEqual(["app-bar", "title", "members", "days", "item", "add-activity", "tabs"]);
  await expect(region(page, "add-activity")).toBeFocused();
});

test("lint click selects the region a finding is about; Fix automatically regenerates", async ({ page }) => {
  await openTimeline(page);
  const before = await hostFiles(page);
  await region(page, "add-activity").click();
  const label = page.getByRole("form", { name: "Region · add-activity" }).getByLabel("Label", { exact: true });
  await label.fill("Add an activity to any day of this trip, right now");
  await label.press("Enter");
  await expect(saveStatus(page)).toHaveText(/Saved/);

  const lint = page.getByRole("region", { name: "Lint findings" });
  const finding = lint.getByRole("button", { name: /label-too-long/ });
  await expect(finding).toBeVisible();
  const stale = lint.getByRole("listitem").filter({ hasText: "generated-stale" });
  await expect(stale.first()).toBeVisible();

  // Go elsewhere, then let the finding bring the editor back.
  await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: /^trips\.list/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your trips");
  await finding.click();
  await expect(page).toHaveURL(/#\/screens\/trip\.timeline$/);
  await expect(region(page, "add-activity")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("form", { name: "Region · add-activity" })).toBeVisible();
  await expectNoAxeViolations(page);

  const fix = lint.getByRole("button", { name: /^Fix \d+ automatically$/ });
  await fix.click();
  await expect(page.getByRole("link", { name: /0 errors, 1 warning/ })).toBeVisible();
  await expect(stale).toHaveCount(0);
  const changed = changedPaths(before, await hostFiles(page));
  expect(changed).toContain(REGISTRY);
  expect(changed).toContain("docs/flows/generated/wireframes/trip.timeline.phone.svg");
});

test("Override layout copies the default layout into layouts.<form factor>", async ({ page }) => {
  await openTimeline(page);
  await page.getByRole("tab", { name: "web-narrow" }).click();
  await expect(tree(page)).toHaveAccessibleName("Layout · web-narrow (default layout)");
  await page.getByRole("button", { name: "Override layout for web-narrow" }).click();
  await expect(saveStatus(page)).toHaveText(/Saved/);
  await expect(page.getByRole("tab", { name: "web-narrow · override" })).toHaveAttribute("aria-selected", "true");
  await expect(tree(page)).toHaveAccessibleName("Layout · web-narrow");
  expect(await treeOrder(page)).toEqual(["app-bar", "title", "members", "days", "item", "add-activity", "tabs"]);
  const yaml = (await hostFiles(page))[REGISTRY] ?? "";
  expect(yaml).toMatch(/layouts:\n(?:.*\n)*?\s+web-narrow:\n\s+- region: app-bar/);
});

test("the Source tab shows screens.yaml, read-only while it parses", async ({ page }) => {
  const csp = cspViolations(page);
  await openTimeline(page);
  await page.getByRole("tab", { name: "Source" }).click();
  const editor = page.getByRole("textbox", { name: "screens.yaml source" });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute("aria-readonly", "true");
  await expect(editor).toContainText("trips.list:");
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("+ Region inserts after the selected region, and Remove takes it out again", async ({ page }) => {
  await openTimeline(page);
  await region(page, "add-activity").click();
  await page.getByRole("button", { name: "Region", exact: true }).click();
  await expect(saveStatus(page)).toHaveText(/Saved/);
  await expect.poll(() => treeOrder(page)).toEqual(["app-bar", "title", "members", "days", "item", "add-activity", "region", "tabs"]);
  await expect(region(page, "region")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("form", { name: "Region · region" })).toBeVisible();

  await page.getByRole("button", { name: "Remove region" }).click();
  await expect.poll(() => treeOrder(page)).toEqual(["app-bar", "title", "members", "days", "item", "add-activity", "tabs"]);
  expect((await hostFiles(page))[REGISTRY]).not.toContain("region: region");
});
