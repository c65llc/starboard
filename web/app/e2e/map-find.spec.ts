// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Find a screen, on the app map: a combobox in the map's header that lists
// the screens matching part of an ID or title. Choosing one selects it,
// moves keyboard focus to it (drawing it first if its batch has not come)
// and centres it in the map's scroll box. Escape in the box clears it and
// leaves the map's selection alone.

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./test.ts";
import { largeProject, SCREENS } from "./fixtures/large-project.ts";
import { cspViolations, expectNoAxeViolations, openExample, openFiles } from "./helpers.ts";

const map = (page: Page) => page.getByRole("group", { name: "App map" });
const node = (page: Page, id: string) => map(page).locator(`a[data-id="${id}"]`);
const find = (page: Page) => page.getByRole("combobox", { name: "Find a screen" });
const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("data-id") ?? document.activeElement?.tagName);

async function openMap(page: Page): Promise<void> {
  await openExample(page);
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "App map" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("App map");
  await expect(node(page, "trip.timeline")).toBeVisible({ timeout: 30_000 });
}

/** The screen sits in the middle of the map's scroll box, on each axis where the box could scroll that far. */
async function expectCentred(page: Page, el: Locator): Promise<void> {
  const off = await el.evaluate((a) => {
    const box = a.closest(".map__scroll") as HTMLElement;
    const r = a.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const axis = (centre: number, boxCentre: number, scrolled: number, max: number) => {
      const gap = centre - boxCentre;
      // At an end of the scroll range the box cannot bring the screen any nearer the middle.
      if ((gap < 0 && scrolled <= 0) || (gap > 0 && scrolled >= max - 1)) return 0;
      return Math.abs(gap);
    };
    return [
      axis(r.left + r.width / 2, b.left + box.clientLeft + box.clientWidth / 2, box.scrollLeft, box.scrollWidth - box.clientWidth),
      axis(r.top + r.height / 2, b.top + box.clientTop + box.clientHeight / 2, box.scrollTop, box.scrollHeight - box.clientHeight),
    ];
  });
  expect(off[0]).toBeLessThanOrEqual(2);
  expect(off[1]).toBeLessThanOrEqual(2);
}

test("Find selects and focuses a screen by part of its title", async ({ page }) => {
  const csp = cspViolations(page);
  await openMap(page);
  await expect(find(page)).toHaveAttribute("aria-expanded", "false");
  await find(page).fill("timel");
  await expect(find(page)).toHaveAttribute("aria-expanded", "true");
  const list = page.getByRole("listbox", { name: "Find a screen" });
  await expect(list.getByRole("option", { name: "Timeline trip.timeline" })).toBeVisible();
  // The first match is active, so Enter chooses it; the input says which.
  const active = await find(page).getAttribute("aria-activedescendant");
  expect(active).toBeTruthy();
  await expect(page.locator(`[id="${active}"]`)).toHaveAttribute("aria-selected", "true");
  await expectNoAxeViolations(page);

  await page.keyboard.press("Enter");
  await expect(node(page, "trip.timeline")).toHaveAttribute("aria-current", "true");
  expect(await focused(page)).toBe("trip.timeline");
  await expect(page).toHaveURL(/#\/map$/); // choosing selects; it does not follow the screen's link
  await expect(find(page)).toHaveAttribute("aria-expanded", "false");
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("Find's arrow keys move the active option, and a click chooses like Enter", async ({ page }) => {
  const csp = cspViolations(page);
  await openMap(page);
  await find(page).fill("trip.");
  const options = page.getByRole("listbox", { name: "Find a screen" }).getByRole("option");
  expect(await options.count()).toBeGreaterThan(2);
  const ids = await options.evaluateAll((os) => os.map((o) => o.id));
  const idAt = (i: number) => ids.at(i) ?? "(none)";
  await expect(find(page)).toHaveAttribute("aria-activedescendant", idAt(0));
  await page.keyboard.press("ArrowDown");
  await expect(find(page)).toHaveAttribute("aria-activedescendant", idAt(1));
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp"); // wraps to the last
  await expect(find(page)).toHaveAttribute("aria-activedescendant", idAt(-1));

  await options.filter({ hasText: "trip.timeline" }).click();
  await expect(node(page, "trip.timeline")).toHaveAttribute("aria-current", "true");
  expect(await focused(page)).toBe("trip.timeline");
  await expect(page).toHaveURL(/#\/map$/);
  expect(csp).toEqual([]);
});

test("Escape in Find clears it and keeps the selection", async ({ page }) => {
  const csp = cspViolations(page);
  await openMap(page);
  await node(page, "trip.map").click();
  await expect(node(page, "trip.map")).toHaveAttribute("aria-current", "true");
  await find(page).fill("timel");
  await expect(find(page)).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(find(page)).toHaveValue("");
  await expect(find(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("listbox", { name: "Find a screen" })).toHaveCount(0);
  await expect(find(page)).toBeFocused();
  // The map's Escape clears the selection; Find's does not reach it.
  await expect(node(page, "trip.map")).toHaveAttribute("aria-current", "true");
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("choosing a Find result before the map is drawn focuses it once drawn", async ({ page }) => {
  test.slow(); // a 300-screen project to open and lint
  const csp = cspViolations(page);
  await page.goto("./");
  await openFiles(page, largeProject(), "large");
  await expect(page.getByRole("link", { name: /errors?, \d+ warnings?/ })).toBeVisible({ timeout: 60_000 });
  const LAST = "area9.screen-299"; // last in the map's order, so in the last batch drawn
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "App map" }).click();
  // Find opens with the layout, while the canvas still draws its batches a
  // frame at a time: type and choose in the same task, so no frame between
  // can draw the rest first, and count what was drawn when the choice came.
  const drawnAtChoice = await page.evaluate(
    (query) =>
      new Promise<number>((resolve) => {
        const choose = (input: HTMLInputElement) => {
          input.value = query;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
          resolve(document.querySelectorAll(".map__canvas a.map-node").length);
        };
        const ready = () => {
          const input = document.querySelector<HTMLInputElement>('input[role="combobox"][aria-controls]');
          if (input && !input.disabled) {
            choose(input);
            return true;
          }
          return false;
        };
        if (ready()) return;
        const watch = new MutationObserver(() => {
          if (ready()) watch.disconnect();
        });
        watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
      }),
    "screen-299",
  );
  expect(drawnAtChoice).toBeLessThan(SCREENS);
  await expect(node(page, LAST)).toHaveAttribute("aria-current", "true", { timeout: 30_000 });
  await expect.poll(() => focused(page), { timeout: 30_000 }).toBe(LAST);
  await expectCentred(page, node(page, LAST));

  // A screen in the middle of the drawing is centred both ways.
  await page.locator(".map__canvas a.map-node").nth(SCREENS - 1).waitFor();
  await find(page).fill("area4.screen-154");
  await page.keyboard.press("Enter");
  await expect.poll(() => focused(page)).toBe("area4.screen-154");
  await expectCentred(page, node(page, "area4.screen-154"));
  expect(csp).toEqual([]);
});
