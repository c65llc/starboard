// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Review Focus 4: 300 screens and 60 flows stay responsive. Lint and
// model run in the worker; the main thread never holds a task for 100 ms
// or more while the project loads and a screen is opened, and the screen
// list renders only the rows in view. Long tasks are a Chromium API. Each
// spec runs at the CI runner's speed (e2e/cpu.ts), so a budget met here is
// met there.

import type { Locator } from "@playwright/test";

import { expect, test } from "./test.ts";
import { largeProject, SCREENS } from "./fixtures/large-project.ts";
import { runAtRunnerSpeed } from "./cpu.ts";
import { openFiles } from "./helpers.ts";

test.skip(({ browserName }) => browserName !== "chromium", "PerformanceObserver longtask is Chromium-only");

test("a 300-screen project loads without a long task of 100 ms, into a virtualised list", async ({ page }) => {
  await page.goto("./");
  await page.waitForFunction(() => "__starboardE2E" in globalThis);
  await runAtRunnerSpeed(page, test.info());
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

/** activate clicks el from inside the page (HTMLElement.click()): the app's handlers run, without Playwright's synthetic mouse input. */
const activate = (el: Locator) => el.evaluate((e) => (e as HTMLElement).click());

test("the app map of a 300-screen project is laid out in the worker, without a long task of 100 ms", async ({ page }) => {
  await page.goto("./");
  await openFiles(page, largeProject(), "large");
  await expect(page.getByRole("link", { name: /errors?, \d+ warnings?/ })).toBeVisible({ timeout: 60_000 });
  await runAtRunnerSpeed(page, test.info());
  // The budget is the app's: every main-thread task from opening the map to
  // the table's last batch, at 100 ms, at the runner's speed, wherever it
  // runs. What is not the app's is Playwright's synthetic input. Its click
  // on the App map link once measured 134 ms in CI (#22); traced, that task
  // came 75 to 110 ms after the click, before the map's chunk was even
  // requested, and only under a Playwright click: the same link clicked
  // from the page, or the route entered through location.hash, never made
  // one, and the map's own tasks (its first commit, that commit's style and
  // layout, the edge batches) stayed at 50 to 85 ms on a loaded machine.
  // So the page is driven from inside (activate, focus), through the app's
  // own handlers, and the budget is not eased. Each task's start, from
  // opening the map, goes into the annotation so a failure says which it was.
  await page.evaluate(() => {
    const seen: [number, number][] = [];
    const start = performance.now();
    (globalThis as unknown as { __longTasks: [number, number][] }).__longTasks = seen;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) seen.push([Math.round(entry.startTime - start), Math.round(entry.duration)]);
    }).observe({ type: "longtask" });
  });
  const started = Date.now();
  await activate(page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "App map" }));
  const nodes = page.getByRole("group", { name: "App map" }).getByRole("link");
  await expect(nodes).toHaveCount(SCREENS, { timeout: 60_000 });
  const shownMs = Date.now() - started;
  // The edges follow the screens a batch per frame (MapCanvas): wait for every
  // one, so each batch's task is inside the measured window. Each screen has
  // three to:, all to other screens, none of them tabs.
  await expect(page.locator(".map__canvas [data-edge]")).toHaveCount(SCREENS * 3, { timeout: 60_000 });
  // The text alternative's rows are made only when it is opened (MapTable).
  const rows = page.locator(".map-table tbody tr");
  await expect(rows).toHaveCount(0);
  await nodes.first().focus(); // focus selects a screen, as a plain click does
  // The most rows any one commit adds, whatever the machine's speed.
  await page.evaluate(() => {
    const w = globalThis as unknown as { __rowBatch: number };
    w.__rowBatch = 0;
    new MutationObserver((records) => {
      let added = 0;
      for (const r of records) for (const n of r.addedNodes) if (n instanceof HTMLElement) added += n.matches("tr") ? 1 : n.querySelectorAll("tbody tr").length;
      w.__rowBatch = Math.max(w.__rowBatch, added);
    }).observe(document.querySelector(".map-table") as Node, { childList: true, subtree: true });
  });
  // Opening it makes every row, in batches, and says so when they are all there.
  const summary = page.getByText("Every link as a table");
  const filled = page.getByRole("status").filter({ hasText: `${SCREENS * 3} of ${SCREENS * 3} links shown` });
  await activate(summary);
  await expect(rows).toHaveCount(SCREENS * 3, { timeout: 60_000 });
  await expect(filled).toHaveCount(1);
  // Closing drops the rows; opening again fills them in batches again, not in one commit.
  await activate(summary);
  await expect(rows).toHaveCount(0);
  await expect(filled).toHaveCount(0);
  await activate(summary);
  await expect(rows).toHaveCount(SCREENS * 3, { timeout: 60_000 });
  await expect(filled).toHaveCount(1);
  expect(await page.evaluate(() => (globalThis as unknown as { __rowBatch: number }).__rowBatch)).toBeLessThanOrEqual(100) // MapTable's TABLE_BATCH;
  const longTasks = await page.evaluate(() => (globalThis as unknown as { __longTasks: [number, number][] }).__longTasks);
  const said = longTasks.map(([at, ms]) => `${ms} ms at +${at} ms`).join(", ");
  test.info().annotations.push({ type: "perf", description: `map shown in ${shownMs} ms; long tasks [${said}]` });
  expect(Math.max(0, ...longTasks.map(([, ms]) => ms)), `long tasks: ${said}`).toBeLessThan(100);
});
