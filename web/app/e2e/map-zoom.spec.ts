// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Zoom and pan, on the app map: the header's zoom controls, the canvas's
// zoom keys, Ctrl/⌘+wheel around the pointer, dragging the background to
// pan, and the new-view rule (a pick, or the first show, opens at 100% or
// fits, never below 50%). Every scroll is the map box's own: the page never
// scrolls (window.scrollY stays 0).

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./test.ts";
import { largeProject, SCREENS } from "./fixtures/large-project.ts";
import { travelApp } from "./fixtures/travel-app.ts";
import { cspViolations, expectNoAxeViolations, openFiles } from "./helpers.ts";

const map = (page: Page) => page.getByRole("group", { name: "App map" });
const node = (page: Page, id: string) => map(page).locator(`a[data-id="${id}"]`);
// The percentage shown, and the live status that says it once it settles.
const level = (page: Page) => page.locator(".map-zoom__level");
const announcer = (page: Page) => page.locator('.map-zoom [role="status"]');
const percent = async (page: Page) => Number((await level(page).innerText()).replace("%", ""));
const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("data-id") ?? document.activeElement?.tagName);
const pageScroll = (page: Page) => page.evaluate(() => window.scrollY);
const boxScroll = (page: Page) =>
  page.evaluate(() => {
    const b = document.querySelector(".map__scroll") as HTMLElement;
    return { left: b.scrollLeft, top: b.scrollTop };
  });
const CENTRE = "trip.timeline";

/** Opens the example's full map (nothing centred) at its first view. */
async function openMap(page: Page, hash = "#/map"): Promise<void> {
  await page.goto("./");
  await openFiles(page, travelApp(), "travel-app");
  await expect(page.getByRole("link", { name: /^Lint:/ })).toBeVisible({ timeout: 30_000 });
  if (hash === "#/map") await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "App map" }).click();
  else await page.evaluate((h) => (location.hash = h), hash);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("App map");
  await expect(node(page, CENTRE)).toBeVisible({ timeout: 30_000 });
}

/** Counts every message to a worker, the layout's among them: a layout is asked for with one. */
async function countPosts(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const w = globalThis as unknown as { __posts: number };
    w.__posts = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, ...args: Parameters<Worker["postMessage"]>) {
      w.__posts++;
      return post.apply(this, args);
    } as Worker["postMessage"];
  });
  return () => page.evaluate(() => (globalThis as unknown as { __posts: number }).__posts);
}

/** The screen sits in the middle of the map's scroll box, on each axis where the box could scroll that far. */
async function expectCentred(el: Locator): Promise<void> {
  await expect
    .poll(() =>
      el.evaluate((a) => {
        const box = a.closest(".map__scroll") as HTMLElement;
        const r = a.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        const axis = (centre: number, boxCentre: number, scrolled: number, max: number) => {
          const gap = centre - boxCentre;
          if ((gap < 0 && scrolled <= 0) || (gap > 0 && scrolled >= max - 1)) return 0;
          return Math.round(Math.abs(gap));
        };
        return Math.max(
          axis(r.left + r.width / 2, b.left + box.clientLeft + box.clientWidth / 2, box.scrollLeft, box.scrollWidth - box.clientWidth),
          axis(r.top + r.height / 2, b.top + box.clientTop + box.clientHeight / 2, box.scrollTop, box.scrollHeight - box.clientHeight),
        );
      }),
    )
    .toBeLessThanOrEqual(2);
}

/** The screen is wholly inside the map box's visible area. */
const inView = (el: Locator) =>
  el.evaluate((a) => {
    const box = a.closest(".map__scroll") as HTMLElement;
    const r = a.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const left = b.left + box.clientLeft;
    const top = b.top + box.clientTop;
    return r.left >= left - 1 && r.top >= top - 1 && r.right <= left + box.clientWidth + 1 && r.bottom <= top + box.clientHeight + 1;
  });

/**
 * A point on the box's background (no screen, lane or edge under it), in
 * the page's coordinates; from at least `inset` px inside the box's left
 * edge, so a drag to the left from it stays inside the box (and the
 * window: Gecko reports no buttons held for a move outside it).
 */
const background = (page: Page, inset = 40) =>
  page.evaluate((from) => {
    const box = document.querySelector(".map__scroll") as HTMLElement;
    const b = box.getBoundingClientRect();
    for (let y = b.top + 40; y < b.top + box.clientHeight - 10; y += 15)
      for (let x = b.left + from; x < b.left + box.clientWidth - 40; x += 15) {
        const at = document.elementFromPoint(x, y);
        if (at && (at === box || at.classList.contains("map__canvas") || at.classList.contains("map__sizer") || at.classList.contains("map__edges"))) return { x, y };
      }
    throw new Error("no background point in view");
  }, inset);

/** Waits until the canvas shows the zoom the status says: any eased step has ended. */
async function settle(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const z = (await percent(page)) / 100;
      return page.evaluate((want) => {
        const m = new DOMMatrix(getComputedStyle(document.querySelector(".map__canvas") as HTMLElement).transform);
        return Math.abs(m.a - want) < 0.006;
      }, z);
    })
    .toBe(true);
}

/** The transforms the canvas shows, frame by frame, from the next keydown until ms have passed. */
async function sampleTransforms(page: Page, ms: number): Promise<void> {
  await page.evaluate((span) => {
    const w = globalThis as unknown as { __transforms: string[] };
    w.__transforms = [];
    addEventListener(
      "keydown",
      () => {
        const start = performance.now();
        const canvas = document.querySelector(".map__canvas") as HTMLElement;
        const tick = () => {
          w.__transforms.push(getComputedStyle(canvas).transform);
          if (performance.now() - start < span) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { capture: true, once: true },
    );
  }, ms);
}
const transforms = (page: Page) => page.evaluate(() => (globalThis as unknown as { __transforms: string[] }).__transforms);

test("the zoom buttons and keys step the percentage", async ({ page }) => {
  const csp = cspViolations(page);
  const posts = await countPosts(page);
  await openMap(page);
  await expect(level(page)).toHaveText("100%");
  await expect(level(page)).not.toHaveAttribute("aria-live", /.*/);
  await expect(announcer(page)).toHaveAttribute("aria-live", "polite");
  await expect(announcer(page)).toHaveText("100%");
  await expectNoAxeViolations(page);
  await page.waitForTimeout(250);
  const sent = await posts();

  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(level(page)).toHaveText("125%");
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(level(page)).toHaveText("80%");
  await page.getByRole("button", { name: "100%" }).click();
  await expect(level(page)).toHaveText("100%");

  // The keys, from a screen on the map.
  await node(page, CENTRE).focus();
  await page.keyboard.press("+");
  await expect(level(page)).toHaveText("125%");
  await page.keyboard.press("-");
  await page.keyboard.press("-");
  await expect(level(page)).toHaveText("80%");
  await page.keyboard.press("=");
  await expect(level(page)).toHaveText("100%");
  await page.keyboard.press("-");
  await page.keyboard.press("0");
  await expect(level(page)).toHaveText("100%");
  // The example's map is far wider than the box, so Fit shrinks it, to 25% at the least.
  await page.keyboard.press("f");
  await expect.poll(() => percent(page)).toBeLessThan(100);
  const fitted = await level(page).innerText();
  // The example is over four times as wide as the box: Fit goes far down.
  expect(await percent(page)).toBeLessThanOrEqual(33);
  await page.getByRole("button", { name: "100%" }).click();
  await expect(level(page)).toHaveText("100%");
  await page.getByRole("button", { name: "Fit" }).click();
  await expect(level(page)).toHaveText(fitted);
  await page.getByRole("button", { name: "100%" }).click();

  // With Alt, Ctrl or ⌘ the keys are the browser's, and outside the map they are text.
  await node(page, CENTRE).focus();
  await page.keyboard.press("Alt+=");
  await page.keyboard.press("Alt+-");
  await expect(level(page)).toHaveText("100%");
  const findBox = page.getByRole("combobox", { name: "Find a screen" });
  await findBox.focus();
  await page.keyboard.type("-0f+");
  await expect(findBox).toHaveValue("-0f+");
  await expect(level(page)).toHaveText("100%");
  // Arrow keys move between screens; they never pan or zoom.
  await node(page, CENTRE).focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => focused(page)).not.toBe(CENTRE);
  await expect(level(page)).toHaveText("100%");

  // No layout runs on zoom, and the page never scrolls.
  expect(await posts()).toBe(sent);
  expect(await pageScroll(page)).toBe(0);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("the zoom controls sit between Focus and the filters in the Tab order", async ({ page, browserName }) => {
  // Safari's Tab skips links and buttons unless the user turns on "Press Tab
  // to highlight each item"; Option-Tab is its key for every control.
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  const csp = cspViolations(page);
  await openMap(page);
  await page.getByRole("combobox", { name: "Find a screen" }).focus();
  const names: string[] = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press(tab);
    const at = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      if (el.closest(".map__canvas")) return "map";
      return el.getAttribute("aria-label") ?? el.closest("label")?.textContent?.trim() ?? el.textContent?.trim() ?? el.tagName;
    });
    names.push(at);
    if (at === "map") break;
  }
  const zoom = ["Zoom out", "Zoom in", "Fit", "100%"];
  const at = names.indexOf("Zoom out");
  expect(names.slice(at, at + 4)).toEqual(zoom);
  expect(names.findIndex((n) => n.startsWith("Re-centre on"))).toBeLessThan(at);
  expect(names.findIndex((n) => n.startsWith("Platform"))).toBeGreaterThan(at + 3);
  expect(names[names.length - 1]).toBe("map");
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("Ctrl+wheel zooms around the pointer", async ({ page }) => {
  const csp = cspViolations(page);
  const posts = await countPosts(page);
  await openMap(page);
  await page.waitForTimeout(250);
  const sent = await posts();
  // A screen near the middle of the box, so the zoom is not held by an end of the scroll range.
  const target = await page.evaluate(() => {
    const box = (document.querySelector(".map__scroll") as HTMLElement).getBoundingClientRect();
    const mid = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    let best: { id: string; d: number } | null = null;
    for (const a of document.querySelectorAll<HTMLElement>("a.map-node")) {
      const r = a.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - mid.x, r.top + r.height / 2 - mid.y);
      if (!best || d < best.d) best = { id: a.getAttribute("data-id") ?? "", d };
    }
    return best?.id ?? "";
  });
  const el = node(page, target);
  const r = await el.boundingBox();
  if (!r) throw new Error("no box");
  const at = { x: r.x + r.width / 3, y: r.y + r.height / 2 };
  // Where the pointer sits on the screen, as a fraction of it: the same after the zoom.
  const fraction = async () => {
    const b = await el.boundingBox();
    if (!b) throw new Error("no box");
    return { x: b.x + ((at.x - r.x) / r.width) * b.width, y: b.y + ((at.y - r.y) / r.height) * b.height };
  };
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect.poll(() => percent(page)).toBeGreaterThan(100);
  let p = await fraction();
  expect(Math.abs(p.x - at.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(p.y - at.y)).toBeLessThanOrEqual(2);
  const zoomed = await percent(page);
  // ⌘ does the same, and zooming out comes back around the same point.
  await page.keyboard.down("Meta");
  await page.mouse.wheel(0, 50);
  await page.keyboard.up("Meta");
  await expect.poll(() => percent(page)).toBeLessThan(zoomed);
  p = await fraction();
  expect(Math.abs(p.x - at.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(p.y - at.y)).toBeLessThanOrEqual(2);

  // A plain wheel scrolls the box, which pans; it does not zoom.
  const was = await percent(page);
  const before = await boxScroll(page);
  await page.mouse.wheel(200, 200);
  await expect.poll(async () => {
    const after = await boxScroll(page);
    return after.left !== before.left || after.top !== before.top;
  }).toBe(true);
  expect(await percent(page)).toBe(was);
  expect(await posts()).toBe(sent);
  expect(await pageScroll(page)).toBe(0);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("dragging the background pans; dragging a screen does not", async ({ page }) => {
  const csp = cspViolations(page);
  await openMap(page);
  await expect(page.locator(".map__scroll")).toHaveCSS("cursor", "grab");
  // 340 px in, so the 300 px drag to the left below ends inside the box.
  const start = await background(page, 340);
  const before = await boxScroll(page);
  // A press that moves under 4 px is a click: nothing pans.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 2, start.y - 1);
  await page.mouse.up();
  expect(await boxScroll(page)).toEqual(before);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 100, start.y - 10, { steps: 5 });
  await page.mouse.move(start.x - 300, start.y - 10, { steps: 5 });
  await expect(page.locator(".map__scroll")).toHaveCSS("cursor", "grabbing");
  await page.mouse.up();
  await expect(page.locator(".map__scroll")).toHaveCSS("cursor", "grab");
  const after = await boxScroll(page);
  expect(Math.abs(after.left - before.left - 300)).toBeLessThanOrEqual(2);

  // A drag that starts on a screen does nothing new.
  const r = await node(page, CENTRE).boundingBox();
  if (!r) throw new Error("no box");
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 - 200, r.y + r.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await boxScroll(page)).toEqual(after);
  // A click on a screen still selects it.
  await node(page, CENTRE).click();
  await expect(node(page, CENTRE)).toHaveAttribute("aria-current", "true");
  expect(await pageScroll(page)).toBe(0);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("at 50% an arrow key scrolls the next screen into view", async ({ page }) => {
  const csp = cspViolations(page);
  await openMap(page);
  const first = map(page).locator("a.map-node").first();
  await first.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("-");
  await expect(level(page)).toHaveText("50%");
  await page.evaluate(() => {
    const b = document.querySelector(".map__scroll") as HTMLElement;
    b.scrollLeft = 0;
    b.scrollTop = 0;
  });
  let scrolled = false;
  let prev = await focused(page);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("ArrowRight");
    const now = await focused(page);
    if (now === prev) break; // the right-most screen
    prev = now;
    await expect.poll(() => inView(node(page, now ?? ""))).toBe(true);
    if ((await boxScroll(page)).left > 0) scrolled = true;
    expect(await pageScroll(page)).toBe(0);
  }
  // The example is wider than the box at 50%, so some screen had to be scrolled to.
  expect(scrolled).toBe(true);
  await page.keyboard.press("Home");
  await expect.poll(async () => inView(node(page, (await focused(page)) ?? ""))).toBe(true);
  await expect(level(page)).toHaveText("50%");
  expect(await pageScroll(page)).toBe(0);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("a pick opens at 100% or fits, never below 50%", async ({ page }) => {
  const csp = cspViolations(page);
  // The first show of a focused view is a new view too: its neighbourhood is wider than the box, so it fits, at 50% at the least.
  await openMap(page, `#/map/${CENTRE}?steps=1`);
  await expect.poll(() => percent(page)).toBeGreaterThanOrEqual(50);
  expect(await percent(page)).toBeLessThan(100);
  await expectCentred(node(page, CENTRE));
  // Zoomed right out, a pick of a neighbour opens its view again, at 50% at the least, centred on it.
  await node(page, CENTRE).focus();
  await page.keyboard.press("f");
  await page.keyboard.press("-");
  await page.keyboard.press("-");
  await expect(level(page)).toHaveText("25%");
  await settle(page);
  await node(page, "trip.map").click();
  await expect(page).toHaveURL(/#\/map\/trip\.map\?steps=1$/);
  await expect.poll(() => percent(page)).toBeGreaterThanOrEqual(50);
  await expectCentred(node(page, "trip.map"));
  expect(await pageScroll(page)).toBe(0);

  // A box the neighbourhood fits in opens at 100%.
  await page.setViewportSize({ width: 3800, height: 900 });
  await node(page, "trip.map").focus();
  await page.keyboard.press("-");
  await settle(page);
  await node(page, CENTRE).click();
  await expect(page).toHaveURL(/#\/map\/trip\.timeline\?steps=1$/);
  await expect(page.locator(".map__count")).toHaveText(/: 1 step from trip\.timeline$/);
  const fits = await page.evaluate(() => {
    const c = document.querySelector(".map__canvas") as HTMLElement;
    const b = document.querySelector(".map__scroll") as HTMLElement;
    return c.offsetWidth <= b.clientWidth && c.offsetHeight <= b.clientHeight;
  });
  expect(fits).toBe(true);
  await expect(level(page)).toHaveText("100%");
  await expectCentred(node(page, CENTRE));

  // A box far smaller than the neighbourhood still opens at 50%.
  await page.setViewportSize({ width: 600, height: 400 });
  // The map is below the fold here: a click would scroll the page to it, so the keyboard picks (Space), from a focus that does not scroll.
  await node(page, "trip.map").evaluate((a) => (a as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press(" ");
  await expect(page).toHaveURL(/#\/map\/trip\.map\?steps=1$/);
  await expect.poll(() => percent(page)).toBeLessThan(100);
  expect(await percent(page)).toBeGreaterThanOrEqual(50);
  expect(await pageScroll(page)).toBe(0);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("Every selection keeps the zoom on an arrow re-centre", async ({ page }) => {
  const csp = cspViolations(page);
  await openMap(page);
  await page.getByRole("combobox", { name: "Re-centre on" }).selectOption({ label: "Every selection" });
  await node(page, CENTRE).click();
  await expect(page).toHaveURL(/#\/map\/trip\.timeline\?steps=1$/);
  await expect(page.locator(".map__count")).toHaveText(/: 1 step from trip\.timeline$/);
  await page.keyboard.press("+");
  const kept = await level(page).innerText();
  await page.keyboard.press("ArrowRight");
  const moved = (await focused(page)) ?? "";
  expect(moved).not.toBe(CENTRE);
  await expect(page.locator(".map__count")).toHaveText(new RegExp(`: 1 step from ${moved.replace(/\./g, "\\.")}$`));
  await expect(level(page)).toHaveText(kept);
  await expect(node(page, moved)).toBeFocused();
  await expect.poll(() => inView(node(page, moved))).toBe(true);
  expect(await pageScroll(page)).toBe(0);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("a Find choice at 50% is centred in the box", async ({ page }) => {
  const csp = cspViolations(page);
  await openMap(page);
  const all = page.getByRole("radio", { name: "All" });
  await all.focus();
  await page.keyboard.press(" ");
  await expect(all).toBeChecked();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(level(page)).toHaveText("50%");
  // No waiting for the step to end: a choice made while it eases is centred all the same.
  // The right-most screen: far from where the box is scrolled now.
  const far = await page.evaluate(() => {
    let best: [string, number] = ["", -1];
    for (const a of document.querySelectorAll<HTMLElement>("a.map-node")) if (a.offsetLeft > best[1]) best = [a.getAttribute("data-id") ?? "", a.offsetLeft];
    return best[0];
  });
  const find = page.getByRole("combobox", { name: "Find a screen" });
  await find.fill(far);
  await page.keyboard.press("Enter");
  await expect.poll(() => focused(page)).toBe(far);
  await expectCentred(node(page, far));
  // A middle screen, not held by an end of the range: centred exactly.
  const mid = await page.evaluate(() => {
    const as = [...document.querySelectorAll<HTMLElement>("a.map-node")].sort((a, b) => a.offsetLeft - b.offsetLeft);
    return as[Math.floor(as.length / 2)]?.getAttribute("data-id") ?? "";
  });
  await find.fill(mid);
  await page.keyboard.press("Enter");
  await expect.poll(() => focused(page)).toBe(mid);
  const gap = await node(page, mid).evaluate((a) => {
    const box = a.closest(".map__scroll") as HTMLElement;
    const r = a.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    return Math.abs(r.left + r.width / 2 - (b.left + box.clientLeft + box.clientWidth / 2));
  });
  expect(gap).toBeLessThanOrEqual(2);
  await expect(level(page)).toHaveText("50%");
  expect(await pageScroll(page)).toBe(0);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("with reduced motion no transition runs", async ({ page }) => {
  const csp = cspViolations(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openMap(page);
  const canvas = page.locator(".map__canvas");
  // Steps ease in script, which reduced motion turns off; this guards against a CSS transition added later easing them anyway.
  await expect(canvas).toHaveCSS("transition-duration", "0s");
  await node(page, CENTRE).focus();
  await sampleTransforms(page, 300);
  await page.keyboard.press("+");
  await page.waitForTimeout(400);
  // Every frame from the key on shows the new zoom: it jumps.
  const reduced = await transforms(page);
  expect(reduced.length).toBeGreaterThan(0);
  expect(new Set(reduced)).toEqual(new Set(["matrix(1.25, 0, 0, 1.25, 0, 0)"]));

  // Without the preference a step eases, within 150 ms.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await sampleTransforms(page, 300);
  await page.keyboard.press("+");
  await page.waitForTimeout(400);
  const eased = await transforms(page);
  expect(eased.some((t) => t !== "matrix(1.5, 0, 0, 1.5, 0, 0)")).toBe(true);
  expect(eased[eased.length - 1]).toBe("matrix(1.5, 0, 0, 1.5, 0, 0)");
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("the zoom is announced once a wheel burst settles, and at once for a key", async ({ page }) => {
  const csp = cspViolations(page);
  await openMap(page);
  await page.evaluate(() => {
    const w = globalThis as unknown as { __said: string[] };
    w.__said = [];
    const live = document.querySelector('.map-zoom [role="status"]') as HTMLElement;
    new MutationObserver(() => w.__said.push(live.textContent ?? "")).observe(live, { childList: true, characterData: true, subtree: true });
  });
  const said = () => page.evaluate(() => [...(globalThis as unknown as { __said: string[] }).__said]);
  // Ten notches of a pinch, a frame apart: the shown percentage follows each, the status waits for the end.
  const shown = await page.evaluate(async () => {
    const box = document.querySelector(".map__scroll") as HTMLElement;
    const r = box.getBoundingClientRect();
    const out: string[] = [];
    for (let i = 0; i < 10; i++) {
      box.dispatchEvent(new WheelEvent("wheel", { deltaY: -20, ctrlKey: true, clientX: r.left + 200, clientY: r.top + 100, bubbles: true, cancelable: true }));
      await new Promise((res) => requestAnimationFrame(res));
      out.push((document.querySelector(".map-zoom__level") as HTMLElement).textContent ?? "");
    }
    return out;
  });
  expect(new Set(shown).size).toBeGreaterThan(5);
  expect(await said()).toEqual([]);
  await expect.poll(said).toHaveLength(1);
  await page.waitForTimeout(500);
  expect(await said()).toEqual([shown[shown.length - 1]]);
  await expect(announcer(page)).toHaveText(shown[shown.length - 1] ?? "");

  // A key is announced at once.
  await node(page, CENTRE).focus();
  await page.keyboard.press("0");
  expect(await announcer(page).innerText()).toBe("100%");
  await page.getByRole("button", { name: "Zoom in" }).click();
  expect(await announcer(page).innerText()).toBe("125%");
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("a press released outside the box leaves no drag behind", async ({ page }) => {
  const csp = cspViolations(page);
  await openMap(page);
  const start = await background(page);
  const before = await boxScroll(page);
  const outside = await page.evaluate(() => {
    const b = (document.querySelector(".map__scroll") as HTMLElement).getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.bottom + 40 };
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 2, start.y);
  await page.mouse.move(outside.x, outside.y);
  await page.mouse.up();
  // Hovering back across the box with no button held does not pan.
  await page.mouse.move(start.x + 200, start.y, { steps: 5 });
  await page.mouse.move(start.x - 200, start.y, { steps: 5 });
  expect(await boxScroll(page)).toEqual(before);
  // Nor does a move with no button that arrives without a pointerleave (a release the box never saw).
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 2, start.y);
  await page.evaluate(() => {
    const box = document.querySelector(".map__scroll") as HTMLElement;
    const r = box.getBoundingClientRect();
    box.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 0, clientX: r.left + 20, clientY: r.top + 20, bubbles: true }));
  });
  await page.mouse.up();
  await page.mouse.move(start.x - 200, start.y, { steps: 5 });
  expect(await boxScroll(page)).toEqual(before);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("a Safari pinch (gesture events) zooms around its point", async ({ page, browserName }) => {
  test.skip(browserName !== "webkit", "gesture events are WebKit's (macOS Safari's pinch)");
  const csp = cspViolations(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openMap(page);
  const hasGestures = await page.evaluate(() => "GestureEvent" in globalThis);
  test.skip(!hasGestures, "this WebKit build has no GestureEvent: src/map/zoom.ts's pinchZoom is unit-tested instead");
  const r = await node(page, CENTRE).boundingBox();
  if (!r) throw new Error("no box");
  const at = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  // WebKit offers no GestureEvent constructor to pages, so the events are plain ones carrying a gesture's scale and point.
  const pinch = (type: string, scale: number) =>
    page.evaluate(
      ([t, sc, x, y]) => {
        const box = document.querySelector(".map__scroll") as HTMLElement;
        const e = new Event(t as string, { bubbles: true, cancelable: true });
        Object.assign(e, { scale: sc, clientX: x, clientY: y });
        box.dispatchEvent(e);
        return e.defaultPrevented;
      },
      [type, scale, at.x, at.y] as const,
    );
  expect(await pinch("gesturestart", 1)).toBe(true);
  expect(await pinch("gesturechange", 1.2)).toBe(true);
  expect(await pinch("gesturechange", 1.5)).toBe(true);
  expect(await pinch("gestureend", 1.5)).toBe(true);
  await expect(level(page)).toHaveText("150%");
  const b = await node(page, CENTRE).boundingBox();
  if (!b) throw new Error("no box");
  expect(Math.abs(b.x + b.width / 2 - at.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(b.y + b.height / 2 - at.y)).toBeLessThanOrEqual(2);
  await expect(announcer(page)).toHaveText("150%");
  expect(await pageScroll(page)).toBe(0);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("a Safari pinch ignores Ctrl+wheel while it lasts", async ({ page, browserName }) => {
  test.skip(browserName !== "webkit", "gesture events are WebKit's (macOS Safari's pinch)");
  const csp = cspViolations(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openMap(page);
  const start = await percent(page);
  const prevented = await page.evaluate(async () => {
    const box = document.querySelector(".map__scroll") as HTMLElement;
    const r = box.getBoundingClientRect();
    const at = { clientX: r.left + 200, clientY: r.top + 100 };
    const gesture = (t: string, scale: number) => {
      const e = new Event(t, { bubbles: true, cancelable: true });
      Object.assign(e, { scale, ...at });
      box.dispatchEvent(e);
    };
    gesture("gesturestart", 1);
    // The same pinch as a Ctrl+wheel, as a Safari might send it too: stopped, and no zoom.
    const wheel = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, ...at, bubbles: true, cancelable: true });
    box.dispatchEvent(wheel);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const between = (document.querySelector(".map-zoom__level") as HTMLElement).textContent;
    gesture("gesturechange", 1.5);
    gesture("gestureend", 1.5);
    return { stopped: wheel.defaultPrevented, between };
  });
  expect(prevented.stopped).toBe(true);
  expect(prevented.between).toBe(`${start}%`);
  await expect(level(page)).toHaveText(`${Math.round(Math.min(200, start * 1.5))}%`);
  // Once the pinch has ended, Ctrl+wheel zooms again.
  await page.evaluate(() => {
    const box = document.querySelector(".map__scroll") as HTMLElement;
    const r = box.getBoundingClientRect();
    box.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, clientX: r.left + 200, clientY: r.top + 100, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => percent(page)).toBeGreaterThan(150);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("Back to a focused view is a new view; a level change and All screens keep the zoom", async ({ page }) => {
  const csp = cspViolations(page);
  await openMap(page);
  const out = async () => {
    await node(page, (await focused(page)) ?? CENTRE).focus();
    for (let i = 0; i < 9 && (await level(page).innerText()) !== "25%"; i++) await page.keyboard.press("-");
    await expect(level(page)).toHaveText("25%");
    await settle(page);
  };
  await node(page, CENTRE).click();
  await expect(page.locator(".map__count")).toHaveText(/: 1 step from trip\.timeline$/);
  await out();
  await node(page, "trip.map").click();
  await expect(page.locator(".map__count")).toHaveText(/: 1 step from trip\.map$/);
  await expect.poll(() => percent(page)).toBeGreaterThanOrEqual(50);
  await out();
  // Back to the focused view before: a new view, as a pick is.
  await page.goBack();
  await expect(page).toHaveURL(/#\/map\/trip\.timeline\?steps=1$/);
  await expect(page.locator(".map__count")).toHaveText(/: 1 step from trip\.timeline$/);
  await expect.poll(() => percent(page)).toBeGreaterThanOrEqual(50);
  await expectCentred(node(page, CENTRE));

  // A level change is no pick: the zoom stays.
  await out();
  const two = page.getByRole("radio", { name: "2 steps" });
  await two.focus();
  await page.keyboard.press(" ");
  await expect(page.locator(".map__count")).toHaveText(/: 2 steps from trip\.timeline$/);
  await page.waitForTimeout(300); // any new view would have come with the layout just counted
  await expect(level(page)).toHaveText("25%");
  // Nor is All screens: the whole map, at the same zoom.
  await page.getByRole("link", { name: "All screens" }).click();
  await expect(page).toHaveURL(/#\/map$/);
  await expect(page.locator(".map__count")).toHaveText(/^\d+ screens · \d+ links$/);
  await page.waitForTimeout(300);
  await expect(level(page)).toHaveText("25%");
  expect(await pageScroll(page)).toBe(0);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("a zoom chosen while a pick's layout is made survives the new view", async ({ page }) => {
  test.slow(); // a 300-screen project to open, lint and lay out
  const csp = cspViolations(page);
  await page.goto("./");
  await openFiles(page, largeProject(), "large");
  await expect(page.getByRole("link", { name: /errors?, \d+ warnings?/ })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "App map" }).click();
  await expect(map(page).locator("a.map-node")).toHaveCount(SCREENS, { timeout: 60_000 });
  await expect(level(page)).toHaveText("100%");
  const count = page.locator(".map__count");
  const whole = await count.innerText();
  // A pick at 1 step, then two zoom steps, in one task: the pick's layout, made in the worker, cannot have come yet.
  const at = await page.evaluate(() => {
    const box = document.querySelector(".map__scroll") as HTMLElement;
    const b = box.getBoundingClientRect();
    const a = [...document.querySelectorAll<HTMLElement>(".map__canvas a.map-node")].find((n) => {
      const r = n.getBoundingClientRect();
      return r.left > b.left && r.right < b.right && r.top > b.top && r.bottom < b.bottom;
    }) as HTMLElement;
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, button: 0 }));
    for (let i = 0; i < 2; i++) (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "-", bubbles: true, cancelable: true }));
    return { id: a.getAttribute("data-id") ?? "", count: (document.querySelector(".map__count") as HTMLElement).textContent };
  });
  expect(at.count).toBe(whole);
  await expect(count).toHaveText(new RegExp(`of ${SCREENS} screens: 1 step from ${at.id.replace(/\./g, "\\.")}$`), { timeout: 60_000 });
  await settle(page);
  // The viewer's zoom, not the new view's: centred on the pick all the same.
  await expect(level(page)).toHaveText("67%");
  await expectCentred(node(page, at.id));
  expect(await pageScroll(page)).toBe(0);

  // A later pick is a new view again, free to set its own zoom.
  const next = await page.evaluate(() => {
    const sel = document.querySelector('.map__canvas a.map-node[aria-current="true"]')?.getAttribute("data-id");
    return [...document.querySelectorAll<HTMLElement>(".map__canvas a.map-node")].map((n) => n.getAttribute("data-id") ?? "").find((id) => id !== sel) ?? "";
  });
  await node(page, next).evaluate((a) => (a as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press(" ");
  await expect(count).toHaveText(new RegExp(`1 step from ${next.replace(/\./g, "\\.")}$`), { timeout: 60_000 });
  await expect.poll(() => percent(page)).not.toBe(67);
  expect(await percent(page)).toBeGreaterThanOrEqual(50);
  await expectCentred(node(page, next));
  expect(await pageScroll(page)).toBe(0);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});
