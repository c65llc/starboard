// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Focus, on the app map: with a level of 1 or 2 steps and a centred screen,
// the map shows only that screen's neighbourhood. A pick (a click, Space, a
// panel link, a Find result) re-centres and pushes the address; under
// Picks, arrow keys select without re-laying out; under Every selection
// they re-centre too and replace the address. All screens and Escape show
// the full map. The address carries the view (#/map/<id>?steps=n).

import type { Page } from "@playwright/test";

import { expect, test } from "./test.ts";
import { travelApp } from "./fixtures/travel-app.ts";
import { cspViolations, expectNoAxeViolations, hostFiles, openFiles, putFile, REGISTRY } from "./helpers.ts";

const map = (page: Page) => page.getByRole("group", { name: "App map" });
const node = (page: Page, id: string) => map(page).locator(`a[data-id="${id}"]`);
const find = (page: Page) => page.getByRole("combobox", { name: "Find a screen" });
const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("data-id") ?? document.activeElement?.tagName);
const drawn = (page: Page) => map(page).locator("a.map-node").evaluateAll((as) => as.map((a) => a.getAttribute("data-id") ?? "").sort());
const historyLength = (page: Page) => page.evaluate(() => history.length);
const CENTRE = "trip.timeline";

type Links = [string, string][];

/** Opens the example on the full map (nothing centred), and reads every link it draws; all is every screen's ID, as the full map shows them. */
async function openMap(page: Page): Promise<Links> {
  await page.goto("./");
  await openFiles(page, travelApp(), "travel-app");
  await expect(page.getByRole("link", { name: /^Lint:/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "App map" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("App map");
  await expect(node(page, CENTRE)).toBeVisible({ timeout: 30_000 });
  const links = Number((await page.locator(".map__count").innerText()).match(/(\d+) links?/)?.[1]);
  await expect(page.locator("[data-edge]")).toHaveCount(links);
  everyId.set(page, await drawn(page));
  return page.locator("[data-edge]").evaluateAll((es) => es.map((e) => [e.getAttribute("data-from") ?? "", e.getAttribute("data-to") ?? ""] as [string, string]));
}

/** The screens within steps links of id, either way: what graph.ts's neighbourhood keeps. */
function hood(links: Links, id: string, steps: number): string[] {
  const seen = new Set([id]);
  let ring = [id];
  for (let i = 0; i < steps; i++) {
    const next: string[] = [];
    for (const u of ring)
      for (const [a, b] of links) {
        const v = a === u ? b : b === u ? a : null;
        if (v !== null && !seen.has(v)) {
          seen.add(v);
          next.push(v);
        }
      }
    ring = next;
  }
  return [...seen].sort();
}

const everyId = new WeakMap<Page, string[]>();
/** Every screen on the full map, as openMap found it. */
const allIds = (page: Page) => everyId.get(page) ?? [];

test("focus at 1 step shows exactly the neighbourhood", async ({ page }) => {
  const csp = cspViolations(page);
  const links = await openMap(page);
  const total = await map(page).locator("a.map-node").count();
  // At 1 step (the default) with nothing centred, the map is whole and says why.
  await expect(page.getByRole("radio", { name: "1 step" })).toBeChecked();
  await expect(page.getByText("Select a screen to focus on it")).toBeVisible();
  await expect(page.locator(".map__count")).toHaveText(`${total} screens · ${links.length} links`);
  await expectNoAxeViolations(page);

  await node(page, CENTRE).click();
  await expect(page).toHaveURL(/#\/map\/trip\.timeline\?steps=1$/);
  const want = hood(links, CENTRE, 1);
  await expect.poll(() => drawn(page)).toEqual(want);
  await expect(node(page, CENTRE)).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".map__count")).toHaveText(`${want.length} of ${total} screens: 1 step from trip.timeline`);
  await expect(page.getByText("Select a screen to focus on it")).toHaveCount(0);
  // The table says what is drawn: only the kept screens' links.
  await page.getByText("Every link as a table").click();
  const rows = page.locator(".map-table tbody tr");
  await expect(rows.first()).toBeVisible();
  const froms = await rows.locator("td:first-child").evaluateAll((tds) => tds.map((t) => t.textContent ?? ""));
  for (const f of froms) expect(want).toContain(f);

  // 2 steps, from the control: it replaces the address and is remembered.
  const before = await historyLength(page);
  await page.getByRole("radio", { name: "2 steps" }).check();
  await expect(page).toHaveURL(/#\/map\/trip\.timeline\?steps=2$/);
  await expect.poll(() => drawn(page)).toEqual(hood(links, CENTRE, 2));
  expect(await historyLength(page)).toBe(before);
  expect(await page.evaluate(() => localStorage.getItem("starboard.map.focusLevel"))).toBe("2");
  // All: the whole map, the centre still selected.
  await page.getByRole("radio", { name: "All" }).check();
  await expect(page).toHaveURL(/#\/map\/trip\.timeline\?steps=0$/);
  await expect.poll(() => drawn(page)).toEqual(allIds(page));
  await expect(node(page, CENTRE)).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".map__count")).toHaveText(`${total} screens · ${links.length} links`);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("clicking a neighbour or Space on it re-centres; Back returns", async ({ page }) => {
  const csp = cspViolations(page);
  const links = await openMap(page);
  await node(page, CENTRE).click();
  await expect.poll(() => drawn(page)).toEqual(hood(links, CENTRE, 1));
  const next = "trip.map";
  expect(hood(links, CENTRE, 1)).toContain(next);
  await node(page, next).click();
  await expect(page).toHaveURL(/#\/map\/trip\.map\?steps=1$/);
  await expect.poll(() => drawn(page)).toEqual(hood(links, next, 1));
  await expect(node(page, next)).toHaveAttribute("aria-current", "true");

  // Space on a screen reached by Tab (focus), not by a click: the keyboard's pick.
  const third = hood(links, next, 1).find((id) => id !== next && id !== CENTRE) ?? "";
  await node(page, third).focus();
  await expect(node(page, third)).toHaveAttribute("aria-current", "true");
  await expect(page).toHaveURL(/#\/map\/trip\.map\?steps=1$/); // focus alone does not re-centre
  await page.keyboard.press(" ");
  await expect(page).toHaveURL(new RegExp(`#/map/${third.replace(/\./g, "\\.")}\\?steps=1$`));
  await expect.poll(() => drawn(page)).toEqual(hood(links, third, 1));
  await expect(node(page, third)).toBeFocused();
  await expectNoAxeViolations(page);

  // Back and Forward retrace the walk, and with focus in the map it follows the centre.
  await page.goBack();
  await expect(page).toHaveURL(/#\/map\/trip\.map\?steps=1$/);
  await expect.poll(() => drawn(page)).toEqual(hood(links, next, 1));
  await expect(node(page, next)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => focused(page)).toBe(next);
  await page.goForward();
  await expect(node(page, third)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => focused(page)).toBe(third);
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(/#\/map\/trip\.timeline\?steps=1$/);
  await expect.poll(() => drawn(page)).toEqual(hood(links, CENTRE, 1));
  await expect(node(page, CENTRE)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => focused(page)).toBe(CENTRE);
  expect(csp).toEqual([]);
});

test("Back to another centre with focus outside the map leaves focus where it is", async ({ page }) => {
  const csp = cspViolations(page);
  const links = await openMap(page);
  await node(page, CENTRE).click();
  await node(page, "trip.map").click();
  await expect.poll(() => drawn(page)).toEqual(hood(links, "trip.map", 1));
  await find(page).focus();
  await page.goBack();
  await expect(node(page, CENTRE)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => drawn(page)).toEqual(hood(links, CENTRE, 1));
  await expect(find(page)).toBeFocused();
  expect(csp).toEqual([]);
});

test("under Picks arrow keys select without re-laying out", async ({ page }) => {
  const csp = cspViolations(page);
  // Every message to a worker, the layout's (ELK's) among them: a new layout is asked for with one.
  await page.addInitScript(() => {
    const w = globalThis as unknown as { __posts: number };
    w.__posts = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, ...args: Parameters<Worker["postMessage"]>) {
      w.__posts++;
      return post.apply(this, args);
    } as Worker["postMessage"];
  });
  const posts = () => page.evaluate(() => (globalThis as unknown as { __posts: number }).__posts);
  const links = await openMap(page);
  await node(page, CENTRE).click();
  await expect.poll(() => drawn(page)).toEqual(hood(links, CENTRE, 1));
  const boxes = () => map(page).locator("a.map-node").evaluateAll((as) => as.map((a) => `${a.getAttribute("data-id")} ${(a as HTMLElement).style.cssText}`).sort());
  const was = await boxes();
  const length = await historyLength(page);
  // Settled: the click's layout is in, so any later message is the arrow's doing.
  await page.waitForTimeout(250);
  const sent = await posts();
  expect(sent).toBeGreaterThan(0);
  await page.keyboard.press("ArrowRight");
  const moved = await focused(page);
  expect(moved).not.toBe(CENTRE);
  await expect(node(page, moved ?? "")).toHaveAttribute("aria-current", "true");
  await expect(node(page, CENTRE)).not.toHaveAttribute("aria-current", "true");
  // Long enough for a layout from the worker to have come, had one been asked for.
  await page.waitForTimeout(750);
  expect(await posts()).toBe(sent);
  expect(await boxes()).toEqual(was);
  await expect(page).toHaveURL(/#\/map\/trip\.timeline\?steps=1$/);
  expect(await historyLength(page)).toBe(length);
  await expect(page.locator(".map__count")).toHaveText(/: 1 step from trip\.timeline$/);
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("under Every selection an arrow key re-centres and keeps focus", async ({ page }) => {
  const csp = cspViolations(page);
  const links = await openMap(page);
  const recentre = page.getByRole("combobox", { name: "Re-centre on" });
  await expect(recentre).toHaveValue("picks");
  await recentre.selectOption({ label: "Every selection" });
  expect(await page.evaluate(() => localStorage.getItem("starboard.map.recentre"))).toBe("every");
  await node(page, CENTRE).click();
  await expect.poll(() => drawn(page)).toEqual(hood(links, CENTRE, 1));
  const length = await historyLength(page);
  await page.keyboard.press("ArrowRight");
  const moved = (await focused(page)) ?? "";
  expect(moved).not.toBe(CENTRE);
  // The arrow replaces the address: moving around does not flood history.
  await expect(page).toHaveURL(new RegExp(`#/map/${moved.replace(/\./g, "\\.")}\\?steps=1$`));
  expect(await historyLength(page)).toBe(length);
  await expect.poll(() => drawn(page)).toEqual(hood(links, moved, 1));
  await expect(node(page, moved)).toHaveAttribute("aria-current", "true");
  await expect(node(page, moved)).toBeFocused();
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("All screens and Escape show the full map; Back returns to the focused view", async ({ page }) => {
  const csp = cspViolations(page);
  const links = await openMap(page);
  const all = allIds(page);
  await expect(page.getByRole("link", { name: "All screens" })).toHaveCount(0);
  await node(page, CENTRE).click();
  await expect.poll(() => drawn(page)).toEqual(hood(links, CENTRE, 1));
  await page.getByRole("link", { name: "All screens" }).click();
  await expect(page).toHaveURL(/#\/map$/);
  await expect.poll(() => drawn(page)).toEqual(all);
  await expect(map(page).locator('[aria-current="true"]')).toHaveCount(0);
  // The level is kept for the next centre.
  await expect(page.getByRole("radio", { name: "1 step" })).toBeChecked();
  await page.goBack();
  await expect(page).toHaveURL(/#\/map\/trip\.timeline\?steps=1$/);
  await expect.poll(() => drawn(page)).toEqual(hood(links, CENTRE, 1));
  await expect(node(page, CENTRE)).toHaveAttribute("aria-current", "true");

  // Escape pushes the full map too.
  await node(page, CENTRE).focus();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/map$/);
  await expect.poll(() => drawn(page)).toEqual(all);
  await expect(map(page).locator('[aria-current="true"]')).toHaveCount(0);
  // Escape pushed: Back is the focused view, not the full map All screens left behind.
  await page.goBack();
  await expect(page).toHaveURL(/#\/map\/trip\.timeline\?steps=1$/);
  await expect.poll(() => drawn(page)).toEqual(hood(links, CENTRE, 1));
  await expect(node(page, CENTRE)).toHaveAttribute("aria-current", "true");
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("a shared #/map/<id>?steps=2 shows 2 steps and leaves the saved level", async ({ page }) => {
  const csp = cspViolations(page);
  const links = await openMap(page);
  // 1 step is the default: choosing it means choosing another first.
  await page.getByRole("radio", { name: "2 steps" }).check();
  await page.getByRole("radio", { name: "1 step" }).check();
  expect(await page.evaluate(() => localStorage.getItem("starboard.map.focusLevel"))).toBe("1");
  await page.goto(`./#/map/${CENTRE}?steps=2`);
  await expect.poll(() => drawn(page)).toEqual(hood(links, CENTRE, 2));
  await expect(page.getByRole("radio", { name: "2 steps" })).toBeChecked();
  await expect(page.locator(".map__count")).toHaveText(/: 2 steps from trip\.timeline$/);
  expect(await page.evaluate(() => localStorage.getItem("starboard.map.focusLevel"))).toBe("1");
  // Typed without steps, the address takes the saved level.
  await page.goto(`./#/map/${CENTRE}`);
  await expect.poll(() => drawn(page)).toEqual(hood(links, CENTRE, 1));
  await expect(page.getByRole("radio", { name: "1 step" })).toBeChecked();
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("Find reaches a screen outside the neighbourhood and re-centres on it", async ({ page }) => {
  const csp = cspViolations(page);
  const links = await openMap(page);
  await node(page, CENTRE).click();
  const near = hood(links, CENTRE, 1);
  await expect.poll(() => drawn(page)).toEqual(near);
  const far = allIds(page).find((id) => !hood(links, CENTRE, 1).includes(id) && !hood(links, CENTRE, 1).some((n) => hood(links, n, 1).includes(id)));
  if (!far) throw new Error("every screen is within 2 steps of the centre");
  await expect(node(page, far)).toHaveCount(0);
  await find(page).fill(far);
  await page
    .getByRole("listbox", { name: "Find a screen" })
    .getByRole("option")
    .filter({ has: page.locator("code", { hasText: new RegExp(`^${far.replace(/\./g, "\\.")}$`) }) })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/map/${far.replace(/\./g, "\\.")}\\?steps=1$`));
  await expect.poll(() => drawn(page)).toEqual(hood(links, far, 1));
  await expect(node(page, far)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => focused(page)).toBe(far);
  await expectNoAxeViolations(page);
  await page.goBack();
  await expect(page).toHaveURL(/#\/map\/trip\.timeline\?steps=1$/);
  await expect.poll(() => drawn(page)).toEqual(near);
  await expect(node(page, CENTRE)).toHaveAttribute("aria-current", "true");
  expect(csp).toEqual([]);
});

test("a centred screen that disappears falls back to all screens", async ({ page }) => {
  const csp = cspViolations(page);
  const links = await openMap(page);
  const gone = "trip.map";
  await node(page, gone).click();
  await expect.poll(() => drawn(page)).toEqual(hood(links, gone, 1));
  // Under Picks an arrow moves the selection away from the centre.
  await page.keyboard.press("ArrowRight");
  const moved = (await focused(page)) ?? "";
  expect(moved).not.toBe(gone);
  await expect(node(page, moved)).toHaveAttribute("aria-current", "true");

  const registry = (await hostFiles(page))[REGISTRY] ?? "";
  const start = registry.indexOf(`  ${gone}:\n`);
  const end = registry.indexOf("\n  trip.packing:\n");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const length = await historyLength(page);
  await putFile(page, REGISTRY, registry.slice(0, start) + registry.slice(end + 1));
  // The app looks for changes on disk when the window gains focus.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveURL(/#\/map$/);
  const rest = allIds(page).filter((id) => id !== gone);
  await expect.poll(() => drawn(page)).toEqual(rest);
  expect(await historyLength(page)).toBe(length);
  // The selection the arrow made is still on the map, so it stays.
  await expect(node(page, moved)).toHaveAttribute("aria-current", "true");
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

/** The panel's link counts, from its headings, and the status line's announcement. */
async function panelSays(page: Page, id: string): Promise<{ out: string; into: string; status: string }> {
  const panel = page.getByRole("region", { name: "Selected screen" });
  await expect(panel.getByRole("heading", { name: id })).toBeVisible();
  const status = page.getByRole("status").filter({ hasText: new RegExp(`^Selected ${id.replace(/\./g, "\\.")}`) });
  await expect(status).toHaveCount(1);
  return {
    out: await panel.locator("#map-out").innerText(),
    into: await panel.locator("#map-in").innerText(),
    status: await status.innerText(),
  };
}

test("the panel describes the screen, not the view; its link out of the view re-centres there", async ({ page }) => {
  const csp = cspViolations(page);
  const links = await openMap(page);
  const near = hood(links, CENTRE, 1);
  // A screen at the neighbourhood's edge: in it, with a link out to a screen outside it.
  const edge = near.find((n) => n !== CENTRE && links.some(([a, b]) => a === n && !near.includes(b)));
  const out = links.find(([a, b]) => a === edge && !near.includes(b))?.[1];
  if (!edge || !out) throw new Error("no screen at the edge of the neighbourhood");
  // On the full map (nothing centred), selecting it by focus, which does not re-centre.
  await node(page, edge).focus();
  const full = await panelSays(page, edge);

  await node(page, CENTRE).click();
  await expect.poll(() => drawn(page)).toEqual(near);
  // Selected without re-centring, as an arrow under Picks does.
  await node(page, edge).focus();
  await expect(node(page, edge)).toHaveAttribute("aria-current", "true");
  await expect(page).toHaveURL(/#\/map\/trip\.timeline\?steps=1$/);
  expect(await panelSays(page, edge)).toEqual(full);
  await expectNoAxeViolations(page);

  // Its link to a screen outside the view is a pick: the map re-centres there and focuses it.
  await expect(node(page, out)).toHaveCount(0);
  await page
    .getByRole("region", { name: "Selected screen" })
    .getByRole("list", { name: /^Links out/ })
    .getByRole("button", { name: new RegExp(`→ ${out.replace(/\./g, "\\.")}$`) })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`#/map/${out.replace(/\./g, "\\.")}\\?steps=1$`));
  await expect.poll(() => drawn(page)).toEqual(hood(links, out, 1));
  await expect(node(page, out)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => focused(page)).toBe(out);
  expect(csp).toEqual([]);
});

test("an arrow pressed while a pick's layout is made does not lose keyboard focus", async ({ page }) => {
  const csp = cspViolations(page);
  const links = await openMap(page);
  // A screen whose right-hand neighbour on the full map is outside its own neighbourhood, so the new layout drops it.
  let from = "";
  for (const id of allIds(page)) {
    await node(page, id).focus();
    await page.keyboard.press("ArrowRight");
    const to = (await focused(page)) ?? "";
    if (to !== id && !hood(links, id, 1).includes(to)) {
      from = id;
      break;
    }
  }
  if (!from) throw new Error("no screen whose right-hand neighbour is two steps away");
  await expect(page).toHaveURL(/#\/map$/);
  await node(page, from).focus();
  // Space, then the arrow in the same task: before the address changes, while the old layout is drawn.
  const movedTo = await node(page, from).evaluate((a) => {
    const key = (k: string, el: Element) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    key(" ", a);
    key("ArrowRight", a);
    return document.activeElement?.getAttribute("data-id") ?? "";
  });
  expect(hood(links, from, 1)).not.toContain(movedTo);
  await expect.poll(() => drawn(page)).toEqual(hood(links, from, 1));
  // Focus is on a drawn screen, the selected one, not lost to the page.
  await expect.poll(() => focused(page)).toBe(from);
  await expect(node(page, from)).toHaveAttribute("aria-current", "true");
  await expect(page).toHaveURL(new RegExp(`#/map/${from.replace(/\./g, "\\.")}\\?steps=1$`));
  expect(csp).toEqual([]);
});

test("a lower level that drops the selected screen selects the centre and leaves focus on the control", async ({ page }) => {
  const csp = cspViolations(page);
  const links = await openMap(page);
  await node(page, CENTRE).click();
  await page.getByRole("radio", { name: "2 steps" }).check();
  await expect.poll(() => drawn(page)).toEqual(hood(links, CENTRE, 2));
  const far = hood(links, CENTRE, 2).find((id) => !hood(links, CENTRE, 1).includes(id));
  if (!far) throw new Error("nothing two steps from the centre");
  await node(page, far).focus(); // selected, not centred
  await expect(node(page, far)).toHaveAttribute("aria-current", "true");
  // From the keyboard, so the radio has focus in every browser (Safari does not focus a clicked radio).
  const one = page.getByRole("radio", { name: "1 step" });
  await one.focus();
  await page.keyboard.press(" ");
  await expect(one).toBeChecked();
  await expect.poll(() => drawn(page)).toEqual(hood(links, CENTRE, 1));
  await expect(node(page, CENTRE)).toHaveAttribute("aria-current", "true");
  await expect(one).toBeFocused();
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});
