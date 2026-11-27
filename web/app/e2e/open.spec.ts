// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** cspViolations collects the page's Content-Security-Policy reports. */
function cspViolations(page: Page): string[] {
  const seen: string[] = [];
  page.on("console", (msg) => {
    if (/Content[- ]Security[- ]Policy|Refused to/i.test(msg.text())) seen.push(msg.text());
  });
  return seen;
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test.describe("Open a project", () => {
  test("shows the open screen, and axe finds nothing", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Open a Starboard project");
    await expect(page.getByRole("button", { name: "Explore the example project" })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("the dark theme passes axe too", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("./");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("offers editing in place only where showDirectoryPicker exists", async ({ page, browserName }) => {
    await page.goto("./");
    const inPlace = page.getByRole("button", { name: "Open folder…" });
    const viewOnly = page.getByRole("button", { name: "Open folder (view only)" });
    if (browserName === "chromium") {
      await expect(inPlace).toBeVisible();
      await expect(viewOnly).toHaveCount(0);
    } else {
      await expect(viewOnly).toBeVisible();
      await expect(inPlace).toHaveCount(0);
    }
  });

  test("the capability copy follows feature detection, not the user agent", async ({ page }) => {
    await page.addInitScript(() => {
      // As a Chromium without the API (or a policy that removed it) would be.
      delete (window as unknown as Record<string, unknown>)["showDirectoryPicker"];
    });
    await page.goto("./");
    await expect(page.getByRole("button", { name: "Open folder (view only)" })).toBeVisible();
    await expect(page.getByText("This browser opens projects to view")).toBeVisible();
  });

  test("Explore the example project opens travel-app with 0 errors, under the CSP", async ({ page }) => {
    const csp = cspViolations(page);
    await page.goto("./");
    await page.getByRole("button", { name: "Explore the example project" }).click();
    await expect(page).toHaveURL(/#\/screens$/);
    await expect(page.getByRole("banner")).toContainText("travel-app");
    await expect(page.getByRole("link", { name: /0 errors, 0 warnings/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("main")).toContainText("trip.timeline");
    await expectNoAxeViolations(page);
    expect(csp).toEqual([]);
  });

  test("the routes later views fill exist, and Home goes back", async ({ page }) => {
    await page.goto("./");
    await page.getByRole("button", { name: "Explore the example project" }).click();
    await expect(page.getByRole("link", { name: /0 errors/ })).toBeVisible({ timeout: 30_000 });
    for (const [hash, heading] of [
      ["#/screens/trip.timeline", "Timeline"],
      ["#/flows", "Flows"],
      ["#/flows/add-activity/edit", "Add an activity"],
      ["#/flows/add-activity/walk", "Add an activity"],
      ["#/map", "App map"],
    ] as const) {
      await page.goto(`./${hash}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    }
    await page.getByRole("link", { name: "Starboard home" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Open a Starboard project");
  });

  test("works by keyboard: Explore is reachable with Tab and opens with Enter", async ({ page, browserName }) => {
    // Safari's Tab skips buttons unless the user turns on "Press Tab to
    // highlight each item"; Option-Tab is its key for every control.
    const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
    await page.goto("./");
    const explore = page.getByRole("button", { name: "Explore the example project" });
    for (let i = 0; i < 10 && !(await explore.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press(tab);
    }
    await expect(explore).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/screens$/);
  });
});
