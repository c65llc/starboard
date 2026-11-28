// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Review Focus 4: 300 screens and 60 flows stay responsive. Lint and
// model run in the worker; the main thread never holds a task for 100 ms
// or more while the project loads and a screen is opened, and the screen
// list renders only the rows in view. Long tasks are a Chromium API. Each
// spec runs at the CI runner's speed (e2e/cpu.ts), so a budget met here is
// met there.

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./test.ts";
import { largeProject, SCREENS } from "./fixtures/large-project.ts";
import { runAtRunnerSpeed } from "./cpu.ts";
import { openFiles } from "./helpers.ts";
import { EDGE_BATCH, NODE_BATCH } from "../src/map/draw.ts";

test.skip(({ browserName }) => browserName !== "chromium", "PerformanceObserver longtask is Chromium-only");

test("a 300-screen project loads without a long task of 100 ms, into a virtualised list", async ({ page }) => {
  await page.goto("./");
  await page.waitForFunction(() => "__starboardE2E" in globalThis);
  await runAtRunnerSpeed(page, test.info());
  // The budget is the app's: every main-thread task from opening the
  // project to the screen shown and the filter cleared, at 100 ms, at the
  // runner's speed. Playwright's own work is not the app's: its fill and
  // click, and resolving role locators, run as page tasks of 50 to 130 ms
  // at the runner's speed (#22), and the observer counted them: a 118 ms
  // task failed this test in CI after #27 and #28, while the app's own
  // tasks on load measured the same before those as after. So, as in the
  // map test below, the page is driven from inside (the filter's value and
  // its input event, activate), what is waited for while the observer runs
  // is found by CSS selector, and the roles are checked once it has
  // stopped. Each task's start, from opening the project, and what each
  // long frame ran go into the annotations. The budget is not eased.
  await watchMainThread(page);

  const started = Date.now();
  await openFiles(page, largeProject(), "large");
  await expect(page.locator('a.pill[aria-label^="Lint: "]')).toBeVisible({ timeout: 60_000 });
  const list = page.locator('nav[aria-label="Screens"]');
  const rows = list.locator("a.screen-list__link");
  await expect(rows.first()).toBeVisible();
  const loadMs = Date.now() - started;

  // Open a screen far down the list, through the filter.
  const filter = list.locator('input[type="search"]');
  await setValue(filter, "screen-299");
  await activate(list.locator("a.screen-list__link", { hasText: /^area9\.screen-299/ }));
  await expect(page.locator("h1")).toHaveText("Screen 299");
  await expect(page.locator('img.wireframe__image[alt^="Wireframe of area9.screen-299 "]')).toBeVisible();
  await setValue(filter, "");
  await expect(rows.nth(1)).toBeVisible();
  const rendered = await rows.count();

  const { longTasks, frames } = await mainThread(page);
  const said = longTasks.map(([at, ms]) => `${ms} ms at +${at} ms`).join(", ");
  test.info().annotations.push({ type: "perf", description: `load ${loadMs} ms; long tasks [${said}]; ${rendered} rows rendered` });
  if (frames.length > 0) test.info().annotations.push({ type: "long frames", description: frames.join(" | ") });

  // The measured window is over: the budget, then the roles.
  expect(Math.max(0, ...longTasks.map(([, ms]) => ms)), `long tasks: ${said}`).toBeLessThan(100);
  await expect(page.getByRole("link", { name: /errors?, \d+ warnings?/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Screen 299");
  await expect(page.getByRole("img", { name: /Wireframe of area9\.screen-299/ })).toBeVisible();
  const screens = page.getByRole("navigation", { name: "Screens" });
  await expect(screens.getByRole("searchbox", { name: "Filter screens" })).toHaveValue("");
  const links = await screens.getByRole("link").count();
  expect(links).toBe(rendered);
  expect(links).toBeGreaterThan(0);
  expect(links).toBeLessThan(SCREENS / 2);
});

/**
 * watchMainThread records, from now, each long task's start (from now) and
 * duration, and what each long animation frame of 50 ms or more was: its
 * scripts, then its render and its style and layout (long-animation-frame,
 * Chromium). mainThread reads them.
 */
async function watchMainThread(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: [number, number][] = [];
    const frames: string[] = [];
    const start = performance.now();
    const w = globalThis as unknown as { __longTasks: [number, number][]; __longFrames: string[] };
    w.__longTasks = seen;
    w.__longFrames = frames;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) seen.push([Math.round(entry.startTime - start), Math.round(entry.duration)]);
    }).observe({ type: "longtask" });
    interface Script {
      invoker: string;
      sourceFunctionName: string;
      duration: number;
    }
    interface Frame extends PerformanceEntry {
      renderStart: number;
      styleAndLayoutStart: number;
      scripts: Script[];
    }
    new PerformanceObserver((list) => {
      for (const f of list.getEntries() as Frame[]) {
        if (f.duration < 50) continue;
        const end = f.startTime + f.duration;
        const scripts = f.scripts.map((sc) => `${sc.invoker}${sc.sourceFunctionName ? ` ${sc.sourceFunctionName}` : ""} ${Math.round(sc.duration)}`);
        const layout = f.styleAndLayoutStart > 0 ? Math.round(end - f.styleAndLayoutStart) : 0;
        const render = f.renderStart > 0 ? Math.round(end - f.renderStart) : 0;
        frames.push(`+${Math.round(f.startTime - start)} ${Math.round(f.duration)} ms: scripts [${scripts.join("; ")}], render ${render}, style and layout ${layout}`);
      }
    }).observe({ type: "long-animation-frame" });
  });
}

/** mainThread is what watchMainThread has recorded so far. */
function mainThread(page: Page): Promise<{ longTasks: [number, number][]; frames: string[] }> {
  return page.evaluate(() => {
    const w = globalThis as unknown as { __longTasks: [number, number][]; __longFrames: string[] };
    return { longTasks: [...w.__longTasks], frames: [...w.__longFrames] };
  });
}

/** setValue types value into an input from inside the page: its value, then the input event a user's typing fires. */
const setValue = (el: Locator, value: string) =>
  el.evaluate((e, v) => {
    (e as HTMLInputElement).value = v;
    e.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);

/** activate clicks el from inside the page (HTMLElement.click()): the app's handlers run, without Playwright's synthetic mouse input. */
const activate = (el: Locator) => el.evaluate((e) => (e as HTMLElement).click());

test("the app map of a 300-screen project is laid out in the worker, without a long task of 100 ms", async ({ page }) => {
  await page.goto("./");
  await openFiles(page, largeProject(), "large");
  await expect(page.getByRole("link", { name: /errors?, \d+ warnings?/ })).toBeVisible({ timeout: 60_000 });
  await runAtRunnerSpeed(page, test.info());
  // The budget is the app's: every main-thread task from opening the map to
  // the table's last batch, at 100 ms, at the runner's speed, wherever it
  // runs. What is not the app's is Playwright's own work. Its click on the
  // App map link once measured 134 ms in CI (#22), and resolving a role
  // locator (getByRole, which computes the accessible name of every link
  // on a page of some 5,000 elements) ran as page tasks of 50 to 150 ms at
  // the runner's speed, some of which the observer counted. So the page is
  // driven from inside (activate, focus), through the app's own handlers,
  // what is waited for while the observer runs is found by CSS selector,
  // and the roles are checked once it has stopped. The budget is not eased.
  // Each task's start, from opening the map, goes into the annotation so a
  // failure says which it was.
  await watchMainThread(page);
  await page.evaluate(() => {
    const w = globalThis as unknown as { __mapBatch: { nodes: number; edges: number } };
    // The most screens and edges any one commit adds (src/map/draw.ts).
    w.__mapBatch = { nodes: 0, edges: 0 };
    // Each Batch's renders, by kind (src/components/Batch.ts): memoisation that
    // breaks renders every batch drawn so far again each frame, and shows here.
    (globalThis as unknown as { __starboardRenders: Record<string, number> }).__starboardRenders = {};
    new MutationObserver((records) => {
      let nodes = 0;
      let edges = 0;
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (!(n instanceof Element)) continue;
          nodes += (n.matches(".map-node") ? 1 : 0) + n.querySelectorAll(".map-node").length;
          edges += (n.matches("[data-edge]") ? 1 : 0) + n.querySelectorAll("[data-edge]").length;
        }
      }
      w.__mapBatch = { nodes: Math.max(w.__mapBatch.nodes, nodes), edges: Math.max(w.__mapBatch.edges, edges) };
    }).observe(document.body, { childList: true, subtree: true });
  });
  const started = Date.now();
  await activate(page.locator('nav[aria-label="Project"] a', { hasText: "App map" }));
  const nodes = page.locator(".map__canvas a.map-node");
  await expect(nodes).toHaveCount(SCREENS, { timeout: 60_000 });
  const shownMs = Date.now() - started;
  // The edges follow the screens a batch per frame (src/map/draw.ts): wait
  // for every one, so each batch's task is inside the measured window. Each
  // screen has three to:, all to other screens, none of them tabs.
  await expect(page.locator(".map__canvas [data-edge]")).toHaveCount(SCREENS * 3, { timeout: 60_000 });
  const drawnMs = Date.now() - started;
  const mapRenders = await page.evaluate(() => ({ ...(globalThis as unknown as { __starboardRenders: Record<string, number> }).__starboardRenders }));
  // The text alternative's rows are made only when it is opened (MapTable).
  const rows = page.locator(".map-table tbody tr");
  await expect(rows).toHaveCount(0);
  await nodes.first().evaluate((e) => (e as HTMLElement).focus()); // focus selects a screen, as a plain click does
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
  const summary = page.locator(".map-table summary");
  const filled = page.locator('.map-table [role="status"]', { hasText: `${SCREENS * 3} of ${SCREENS * 3} links shown` });
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
  const { longTasks, frames } = await mainThread(page);
  const batch = await page.evaluate(() => (globalThis as unknown as { __mapBatch: { nodes: number; edges: number } }).__mapBatch);
  const said = longTasks.map(([at, ms]) => `${ms} ms at +${at} ms`).join(", ");
  test.info().annotations.push({
    type: "perf",
    description: `map shown in ${shownMs} ms, every edge by ${drawnMs} ms; at most ${batch.nodes} screens and ${batch.edges} edges a commit; long tasks [${said}]`,
  });
  if (frames.length > 0) test.info().annotations.push({ type: "long frames", description: frames.join(" | ") });

  // The measured window is over: what the observers saw, then the roles.
  expect(batch.nodes, "screens added in one commit").toBeLessThanOrEqual(NODE_BATCH);
  expect(batch.edges, "edges added in one commit").toBeLessThanOrEqual(EDGE_BATCH);
  // Drawing the map rendered each screen and each batch of edges once; the table's two openings, each batch of rows once.
  expect(mapRenders, "renders while the map was drawn").toEqual({ node: SCREENS, edges: Math.ceil((SCREENS * 3) / EDGE_BATCH) });
  const renders = await page.evaluate(() => (globalThis as unknown as { __starboardRenders: Record<string, number> }).__starboardRenders);
  expect(renders["rows"], "rows batches rendered").toBe(2 * Math.ceil((SCREENS * 3) / 100));
  expect(await page.evaluate(() => (globalThis as unknown as { __rowBatch: number }).__rowBatch)).toBeLessThanOrEqual(100); // MapTable's TABLE_BATCH
  expect(Math.max(0, ...longTasks.map(([, ms]) => ms)), `long tasks: ${said}`).toBeLessThan(100);
  await expect(page.getByRole("group", { name: "App map" }).getByRole("link")).toHaveCount(SCREENS);
  await expect(page.getByRole("status").filter({ hasText: `${SCREENS * 3} of ${SCREENS * 3} links shown` })).toHaveCount(1);
});

test("zooming and panning the 300-screen map holds no long task of 100 ms", async ({ page }) => {
  await page.goto("./");
  await openFiles(page, largeProject(), "large");
  await expect(page.getByRole("link", { name: /errors?, \d+ warnings?/ })).toBeVisible({ timeout: 60_000 });
  await activate(page.locator('nav[aria-label="Project"] a', { hasText: "App map" }));
  // Every screen and edge drawn first: this measures zoom and pan, not the drawing (the test above).
  await expect(page.locator(".map__canvas a.map-node")).toHaveCount(SCREENS, { timeout: 60_000 });
  await expect(page.locator(".map__canvas [data-edge]")).toHaveCount(SCREENS * 3, { timeout: 60_000 });
  await runAtRunnerSpeed(page, test.info());
  // Counts each message to a worker from now: a layout is asked for with one, and zoom must ask for none.
  await page.evaluate(() => {
    const w = globalThis as unknown as { __posts: number };
    w.__posts = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, ...args: Parameters<Worker["postMessage"]>) {
      w.__posts++;
      return post.apply(this, args);
    } as Worker["postMessage"];
  });
  // Driven from inside the page, as above: the keys and the wheel are the
  // app's handlers' own events, each step given two frames to ease and paint.
  await watchMainThread(page);
  const status = await page.evaluate(async () => {
    const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 140))));
    const box = document.querySelector(".map__scroll") as HTMLElement;
    const first = document.querySelector<HTMLElement>(".map__canvas a.map-node") as HTMLElement;
    first.focus({ preventScroll: true });
    const key = async (k: string) => {
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
      await frames();
    };
    const level = () => (document.querySelector(".map-zoom [role=status]") as HTMLElement).textContent ?? "";
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      await key("-");
      seen.push(level());
    }
    for (let i = 0; i < 6; i++) {
      await key("+");
      seen.push(level());
    }
    await key("f");
    seen.push(level());
    await key("0");
    seen.push(level());
    // Ctrl+wheel, as a trackpad pinch sends it: many small notches, out then in, around the box's middle.
    const r = box.getBoundingClientRect();
    for (const dy of [...Array<number>(12).fill(40), ...Array<number>(12).fill(-40)]) {
      box.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
      await new Promise((res) => requestAnimationFrame(res));
    }
    await frames();
    seen.push(level());
    // Pan across the map by its scroll.
    for (let x = 0; x <= box.scrollWidth - box.clientWidth; x += Math.max(200, (box.scrollWidth - box.clientWidth) / 10)) {
      box.scrollLeft = x;
      box.scrollTop = (x / Math.max(1, box.scrollWidth)) * box.scrollHeight;
      await new Promise((res) => requestAnimationFrame(res));
    }
    await frames();
    return seen;
  });
  const { longTasks, frames } = await mainThread(page);
  const posts = await page.evaluate(() => (globalThis as unknown as { __posts: number }).__posts);
  const said = longTasks.map(([at, ms]) => `${ms} ms at +${at} ms`).join(", ");
  test.info().annotations.push({ type: "perf", description: `zoom ${status.join(" ")}; long tasks [${said}]` });
  if (frames.length > 0) test.info().annotations.push({ type: "long frames", description: frames.join(" | ") });

  expect(status.slice(0, 6)).toEqual(["80%", "67%", "50%", "33%", "25%", "25%"]);
  expect(status.slice(6, 12)).toEqual(["33%", "50%", "67%", "80%", "100%", "125%"]);
  expect(status[12]).toBe("25%");
  expect(status[13]).toBe("100%");
  expect(posts, "layouts asked for while zooming").toBe(0);
  expect(Math.max(0, ...longTasks.map(([, ms]) => ms)), `long tasks: ${said}`).toBeLessThan(100);
});
