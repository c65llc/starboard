// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Review Focus 4: 300 screens and 60 flows stay responsive. Lint and
// model run in the worker; the main thread never holds a task for 100 ms
// or more while the project loads and a screen is opened, and the screen
// list renders only the rows in view. Long tasks are a Chromium API.

import { expect, test } from "@playwright/test";

import { largeProject, SCREENS } from "./fixtures/large-project.ts";
import { openFiles } from "./helpers.ts";

test.skip(({ browserName }) => browserName !== "chromium", "PerformanceObserver longtask is Chromium-only");

test("a 300-screen project loads without a long task of 100 ms, into a virtualised list", async ({ page }) => {
  await page.goto("./");
  await page.waitForFunction(() => "__starboardE2E" in globalThis);
  await page.evaluate(() => {
    const seen: number[] = [];
    (globalThis as unknown as { __longTasks: number[] }).__longTasks = seen;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) seen.push(entry.duration);
    }).observe({ type: "longtask" });
  });

  const started = Date.now();
  await openFiles(page, largeProject(), "large");
  await expect(page.getByRole("link", { name: /errors?, \d+ warnings?/ })).toBeVisible({ timeout: 60_000 });
  const list = page.getByRole("navigation", { name: "Screens" });
  await expect(list.getByRole("link").first()).toBeVisible();
  const loadMs = Date.now() - started;

  // Open a screen far down the list, through the filter.
  await list.getByRole("searchbox", { name: "Filter screens" }).fill("screen-299");
  await list.getByRole("link", { name: /^area9\.screen-299/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Screen 299");
  await expect(page.getByRole("img", { name: /Wireframe of area9\.screen-299/ })).toBeVisible();
  await list.getByRole("searchbox", { name: "Filter screens" }).fill("");

  const rendered = await list.getByRole("link").count();
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThan(SCREENS / 2);

  const longTasks = await page.evaluate(() => (globalThis as unknown as { __longTasks: number[] }).__longTasks);
  test.info().annotations.push({
    type: "perf",
    description: `load ${loadMs} ms; long tasks ${JSON.stringify(longTasks.map(Math.round))}; ${rendered} rows rendered`,
  });
  expect(Math.max(0, ...longTasks)).toBeLessThan(100);
});

test("the app map of a 300-screen project is laid out in the worker, without a long task of 100 ms", async ({ page }) => {
  await page.goto("./");
  await openFiles(page, largeProject(), "large");
  await expect(page.getByRole("link", { name: /errors?, \d+ warnings?/ })).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => {
    const seen: number[] = [];
    (globalThis as unknown as { __longTasks: number[] }).__longTasks = seen;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) seen.push(entry.duration);
    }).observe({ type: "longtask" });
  });
  const started = Date.now();
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "App map" }).click();
  const nodes = page.getByRole("group", { name: "App map" }).getByRole("link");
  await expect(nodes).toHaveCount(SCREENS, { timeout: 60_000 });
  const shownMs = Date.now() - started;
  await nodes.first().click();
  const longTasks = await page.evaluate(() => (globalThis as unknown as { __longTasks: number[] }).__longTasks);
  test.info().annotations.push({ type: "perf", description: `map shown in ${shownMs} ms; long tasks ${JSON.stringify(longTasks.map(Math.round))}` });
  expect(Math.max(0, ...longTasks)).toBeLessThan(100);
});
