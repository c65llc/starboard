// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The 300-screen map is drawn a batch per frame (src/map/draw.ts). Focus
// must not notice: a screen focused before a new layout keeps its focus,
// and a jump to a screen whose batch is not yet drawn (End, or a link in
// the selected screen's panel) draws it and focuses it (#22).

import type { Page } from "@playwright/test";

import { expect, test } from "./test.ts";
import { largeProject, SCREENS } from "./fixtures/large-project.ts";
import { runAtRunnerSpeed } from "./cpu.ts";
import { openFiles } from "./helpers.ts";

/** The last screen in the map's order (every list is sorted by ID). */
const LAST = "area9.screen-299";
const PROPOSED = Math.ceil(SCREENS / 7); // every seventh screen

async function openLarge(page: Page): Promise<void> {
  await page.goto("./");
  await openFiles(page, largeProject(), "large");
  await expect(page.getByRole("link", { name: /errors?, \d+ warnings?/ })).toBeVisible({ timeout: 60_000 });
}

const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("data-id") ?? document.activeElement?.tagName);

test("a late screen keeps its focus when a filter lays the map out again, without a long task of 100 ms", async ({ page, browserName }) => {
  await openLarge(page);
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "App map" }).click();
  const nodes = page.locator(".map__canvas a.map-node");
  const edges = page.locator(".map__canvas [data-edge]");
  // Every edge of the layout on screen is drawn: the count says how many links it has.
  const allEdges = async () => {
    const links = Number((await page.locator(".map__count").innerText()).match(/(\d+) links?/)?.[1]);
    await expect(edges).toHaveCount(links, { timeout: 60_000 });
  };
  await expect(nodes).toHaveCount(SCREENS, { timeout: 60_000 });
  // Every edge stays drawn while a screen is selected, so the new layouts' edge batches are inside the measured window.
  await page.locator(".map__filter", { hasText: "Only links of selected" }).locator("input").evaluate((e) => (e as HTMLInputElement).click());
  await allEdges();
  // A new layout keeps the screens already drawn, so its first commit moves
  // them all at once (src/map/draw.ts): the budget holds for it too, at the
  // CI runner's speed (Chromium: the long-task API and CPU throttling).
  const measured = browserName === "chromium";
  if (measured) {
    await runAtRunnerSpeed(page, test.info());
    await page.evaluate(() => {
      const seen: number[] = [];
      (globalThis as unknown as { __longTasks: number[] }).__longTasks = seen;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) seen.push(Math.round(entry.duration));
      }).observe({ type: "longtask" });
    });
  }
  await page.locator(`.map__canvas a[data-id="${LAST}"]`).evaluate((e) => (e as HTMLElement).focus());
  // The filter is changed from the page, so focus stays where it is, as when an edit lays the map out again.
  const proposed = page.locator(".map__filter", { hasText: "Show proposed" }).locator("input");
  await proposed.evaluate((e) => (e as HTMLInputElement).click());
  await expect(nodes).toHaveCount(SCREENS - PROPOSED, { timeout: 60_000 });
  await allEdges();
  expect(await focused(page)).toBe(LAST);
  await proposed.evaluate((e) => (e as HTMLInputElement).click());
  await expect(nodes).toHaveCount(SCREENS, { timeout: 60_000 });
  await allEdges();
  expect(await focused(page)).toBe(LAST);
  if (measured) {
    const longTasks = await page.evaluate(() => (globalThis as unknown as { __longTasks: number[] }).__longTasks);
    test.info().annotations.push({ type: "perf", description: `filter off and on; long tasks ${JSON.stringify(longTasks)}` });
    expect(Math.max(0, ...longTasks), `long tasks: ${JSON.stringify(longTasks)}`).toBeLessThan(100);
  }
});

/**
 * jumpEarly opens the map and, the moment its first batch of screens is
 * committed, focuses the first screen and runs jump; it says whether LAST
 * was drawn when jump ran.
 */
async function jumpEarly(page: Page, how: "End" | "panel"): Promise<boolean> {
  await openLarge(page);
  return page.evaluate(
    ([last, way]) =>
      new Promise<boolean>((resolve, reject) => {
        const drawn = () => document.querySelector(`.map__canvas a[data-id="${last}"]`) !== null;
        const seen = new MutationObserver(() => {
          const first = document.querySelector<HTMLAnchorElement>(".map__canvas a.map-node");
          if (!first) return;
          seen.disconnect();
          first.focus(); // selects it: the panel lists its links
          if (way === "End") {
            const was = drawn();
            first.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
            resolve(was);
            return;
          }
          const panel = new MutationObserver(() => {
            const link = [...document.querySelectorAll<HTMLButtonElement>(".map-panel__link")].find((b) => b.textContent?.endsWith(`→ ${last}`));
            if (!link) return;
            panel.disconnect();
            const was = drawn();
            link.click();
            resolve(was);
          });
          panel.observe(document.body, { childList: true, subtree: true });
        });
        seen.observe(document.body, { childList: true, subtree: true });
        const open = document.querySelector<HTMLElement>('nav[aria-label="Project"] a[href$="map"]');
        if (open) open.click();
        else reject(new Error("no App map link"));
      }),
    [LAST, how] as const,
  );
}

for (const how of ["End", "panel"] as const) {
  test(`a jump to a screen not yet drawn (${how}) draws it and focuses it`, async ({ page }) => {
    const drawnBefore = await jumpEarly(page, how);
    expect(drawnBefore, "the jump ran before the last screen's batch").toBe(false);
    await expect(page.locator(`.map__canvas a[data-id="${LAST}"]`)).toBeFocused();
    await expect(page.locator(".map__canvas a.map-node")).toHaveCount(SCREENS, { timeout: 60_000 });
    expect(await focused(page)).toBe(LAST);
  });
}
