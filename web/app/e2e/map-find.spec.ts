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

test("Find says how many screens match, or that none do", async ({ page }) => {
  const csp = cspViolations(page);
  await openMap(page);
  const status = page.locator(".map-find").getByRole("status");
  await expect(status).toHaveText("");
  await find(page).fill("timel");
  await expect(status).toHaveText("1 screen");
  await find(page).fill("trip.");
  const n = await page.getByRole("listbox", { name: "Find a screen" }).getByRole("option").count();
  expect(n).toBeGreaterThan(1);
  await expect(status).toHaveText(`${n} screens`);
  await find(page).fill("no such screen");
  await expect(status).toHaveText("No screens match");
  await expect(find(page)).toHaveAttribute("aria-expanded", "false");
  await find(page).fill("");
  await expect(status).toHaveText("");
  await expectNoAxeViolations(page);
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

test("a Find choice made before a new filter's layout arrives focuses the screen once it does", async ({ page }) => {
  const csp = cspViolations(page);
  await page.setViewportSize({ width: 1280, height: 600 });
  await openMap(page);
  const proposed = page.getByRole("checkbox", { name: "Show proposed" });
  await proposed.uncheck();
  await expect(node(page, "trip.packing")).toHaveCount(0); // a proposed screen
  await page.evaluate(() => window.scrollTo(0, 0));
  // Show proposed on, then, in the same task, find and choose the proposed
  // screen: Find lists it as soon as it renders with the new filters, while
  // the new layout is still in the worker and the map shows the old one.
  const drawnAtChoice = await page.evaluate(
    (query) =>
      new Promise<boolean>((resolve) => {
        const input = document.querySelector<HTMLInputElement>('input[role="combobox"][aria-controls]') as HTMLInputElement;
        const box = [...document.querySelectorAll<HTMLLabelElement>(".map__filter")].find((l) => l.textContent?.includes("Show proposed"));
        box?.querySelector("input")?.click();
        input.value = query;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const ready = () => {
          if (!document.querySelector(`[role="option"] code`)?.textContent?.includes(query)) return false;
          const drawn = document.querySelector(`.map__canvas a[data-id="${query}"]`) !== null;
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
          resolve(drawn);
          return true;
        };
        if (ready()) return;
        const watch = new MutationObserver(() => {
          if (ready()) watch.disconnect();
        });
        watch.observe(document.body, { subtree: true, childList: true, attributes: true });
      }),
    "trip.packing",
  );
  expect(drawnAtChoice).toBe(false);
  await expect(node(page, "trip.packing")).toHaveAttribute("aria-current", "true");
  await expect.poll(() => focused(page)).toBe("trip.packing");
  await expectCentred(page, node(page, "trip.packing"));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("a click on another screen while a Find choice waits for its layout wins", async ({ page }) => {
  const csp = cspViolations(page);
  await openMap(page);
  await page.getByRole("checkbox", { name: "Show proposed" }).uncheck();
  await expect(node(page, "trip.packing")).toHaveCount(0);
  // Show proposed on, choose the proposed screen in Find, then click a screen
  // the old layout still shows, all before the new layout arrives.
  const drawnAtClick = await page.evaluate(
    ([query, other]) =>
      new Promise<boolean>((resolve) => {
        const input = document.querySelector<HTMLInputElement>('input[role="combobox"][aria-controls]') as HTMLInputElement;
        const box = [...document.querySelectorAll<HTMLLabelElement>(".map__filter")].find((l) => l.textContent?.includes("Show proposed"));
        box?.querySelector("input")?.click();
        input.value = query;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const ready = () => {
          if (!document.querySelector(`[role="option"] code`)?.textContent?.includes(query)) return false;
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
          const drawn = document.querySelector(`.map__canvas a[data-id="${query}"]`) !== null;
          // A pointer click (detail 1): it selects, where a detail-0 click would follow the link.
          document
            .querySelector(`.map__canvas a[data-id="${other}"]`)
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, detail: 1 }));
          resolve(drawn);
          return true;
        };
        if (ready()) return;
        const watch = new MutationObserver(() => {
          if (ready()) watch.disconnect();
        });
        watch.observe(document.body, { subtree: true, childList: true, attributes: true });
      }),
    ["trip.packing", "trip.map"] as const,
  );
  expect(drawnAtClick).toBe(false);
  // The new layout has come once the proposed screen is drawn.
  await expect(node(page, "trip.packing")).toHaveCount(1);
  await expect(node(page, "trip.map")).toHaveAttribute("aria-current", "true");
  await expect.poll(() => focused(page)).toBe("trip.map");
  await expect(node(page, "trip.packing")).not.toHaveAttribute("aria-current", "true");
  await expect(map(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("choosing a Find result before the map is drawn focuses it once drawn", async ({ page }) => {
  test.slow(); // a 300-screen project to open and lint
  const csp = cspViolations(page);
  // Short enough that the map's box starts well down the page: centring the
  // screen by scrolling the page as well would move the header and Find away.
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("./");
  await openFiles(page, largeProject(), "large");
  await expect(page.getByRole("link", { name: /errors?, \d+ warnings?/ })).toBeVisible({ timeout: 60_000 });
  const LAST = "area9.screen-299"; // last in the map's order, so in the last batch drawn
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "App map" }).click();
  // Find lists the screens from the model, so it works while the first
  // layout still runs in the worker: type and choose as soon as the map view
  // shows the box, and note whether the canvas existed at that moment.
  const canvasAtChoice = await page.evaluate(
    (query) =>
      new Promise<boolean>((resolve) => {
        const choose = (input: HTMLInputElement) => {
          const canvas = document.querySelector(".map__canvas") !== null;
          input.value = query;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
          resolve(canvas);
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
  // Chosen before the first layout came, so before any of the map was drawn.
  expect(canvasAtChoice).toBe(false);
  await expect(node(page, LAST)).toHaveAttribute("aria-current", "true", { timeout: 30_000 });
  await expect.poll(() => focused(page), { timeout: 30_000 }).toBe(LAST);
  await expectCentred(page, node(page, LAST));
  // Only the map's box scrolled: the page, and Find with it, stayed put.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(find(page)).toBeInViewport();

  // A screen in the middle of the drawing is centred both ways.
  await page.locator(".map__canvas a.map-node").nth(SCREENS - 1).waitFor();
  await find(page).fill("area4.screen-154");
  await page.keyboard.press("Enter");
  await expect.poll(() => focused(page)).toBe("area4.screen-154");
  await expectCentred(page, node(page, "area4.screen-154"));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(csp).toEqual([]);
});

test("a Find choice made while a filter lays the map out again is centred on the new layout", async ({ page }) => {
  test.slow(); // a 300-screen project to open and lint
  const csp = cspViolations(page);
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("./");
  await openFiles(page, largeProject(), "large");
  await expect(page.getByRole("link", { name: /errors?, \d+ warnings?/ })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "App map" }).click();
  const nodes = page.locator(".map__canvas a.map-node");
  await expect(nodes).toHaveCount(SCREENS, { timeout: 60_000 });
  const CHOSEN = "area5.screen-155"; // shipped, so in both layouts; proposed screens before it leave, so it moves
  // Show proposed off, and in the same task choose a screen both layouts
  // have: the map still shows the old layout, where the screen sits elsewhere.
  const before = await page.evaluate(
    (query) =>
      new Promise<{ left: number; top: number } | null>((resolve) => {
        const input = document.querySelector<HTMLInputElement>('input[role="combobox"][aria-controls]') as HTMLInputElement;
        const box = [...document.querySelectorAll<HTMLLabelElement>(".map__filter")].find((l) => l.textContent?.includes("Show proposed"));
        box?.querySelector("input")?.click();
        input.value = query;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const ready = () => {
          if (!document.querySelector(`[role="option"] code`)?.textContent?.includes(query)) return false;
          const el = document.querySelector<HTMLElement>(`.map__canvas a[data-id="${query}"]`);
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
          resolve(el ? { left: el.offsetLeft, top: el.offsetTop } : null);
          return true;
        };
        if (ready()) return;
        const watch = new MutationObserver(() => {
          if (ready()) watch.disconnect();
        });
        watch.observe(document.body, { subtree: true, childList: true, attributes: true });
      }),
    CHOSEN,
  );
  expect(before).not.toBeNull(); // drawn in the old layout when chosen
  await expect(nodes).toHaveCount(SCREENS - Math.ceil(SCREENS / 7), { timeout: 60_000 });
  const chosen = node(page, CHOSEN);
  await expect(chosen).toHaveAttribute("aria-current", "true");
  await expect.poll(() => focused(page)).toBe(CHOSEN);
  // The new layout moved it, so centring on the old place would miss.
  const after = await chosen.evaluate((el) => ({ left: (el as HTMLElement).offsetLeft, top: (el as HTMLElement).offsetTop }));
  expect(after).not.toEqual(before);
  await expectCentred(page, chosen);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});
