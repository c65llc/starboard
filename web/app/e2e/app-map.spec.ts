// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app map (#/map), on the example project: navigation structure only.
// Every to: is an edge, tabs are two-way, a selected screen's links are
// highlighted, the filters hide what they say, nodes are links that the
// keyboard can walk, and a table says everything the drawing does.

import type { Page } from "@playwright/test";

import { expect, test } from "./test.ts";
import { travelApp } from "./fixtures/travel-app.ts";
import { cspViolations, expectNoAxeViolations, openFiles, REGISTRY } from "./helpers.ts";

const map = (page: Page) => page.getByRole("group", { name: "App map" });
const node = (page: Page, id: string) => map(page).getByRole("link", { name: new RegExp(`^${id.replace(/\./g, "\\.")}\\b`) });
const edges = (page: Page) => page.locator("[data-edge]");
const panel = (page: Page) => page.getByRole("region", { name: "Selected screen" });

async function openMap(page: Page): Promise<void> {
  await page.goto("./");
  await openFiles(page, travelApp(), "travel-app");
  await expect(page.getByRole("link", { name: /^Lint:/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "App map" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("App map");
  await expect(node(page, "trip.timeline")).toBeVisible({ timeout: 30_000 });
}

test("renders the map: every screen a link, areas in config order, the map-vs-flow caption, a table of links; axe finds nothing", async ({
  page,
}) => {
  const csp = cspViolations(page);
  await openMap(page);
  await expect(map(page).getByRole("link")).toHaveCount(21);
  // Tab order: area in config order, then ID.
  const order = await map(page).getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect(order.slice(0, 3)).toEqual(["#/screens/auth.sign-in", "#/screens/auth.sign-up", "#/screens/auth.welcome"]);
  expect(order.at(-1)).toBe("#/screens/settings.main");
  await expect(page.getByText("auth", { exact: true }).first()).toBeVisible();
  await expect(edges(page)).toHaveCount(39);
  await expect(page.getByText(/The map shows every place a person can go\. A flow is one path someone does take, in order/)).toBeVisible();
  await expect(page.getByText(/39 links/)).toBeVisible();

  // The text alternative lists every to:, the self links the drawing leaves out included.
  await page.getByText("Every link as a table").click();
  const table = page.getByRole("table", { name: /Every link/ });
  await expect(table.getByRole("row")).toHaveCount(1 + 49);
  await expect(table.getByRole("row").filter({ hasText: "trip.timeline" }).filter({ hasText: "tabs (two-way)" })).toHaveCount(7);

  await expectNoAxeViolations(page);
  await node(page, "trip.timeline").click();
  await expectNoAxeViolations(page);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expectNoAxeViolations(page);
  expect(csp).toEqual([]);
});

test("select highlights only its edges: links in and out of the selected screen, the panel lists them, Escape clears", async ({ page }) => {
  await openMap(page);
  await expect(page.locator('[data-edge][data-on="true"]')).toHaveCount(0);
  await node(page, "trip.timeline").click();
  await expect(page).toHaveURL(/#\/map$/); // a click selects; it does not leave the map
  await expect(node(page, "trip.timeline")).toHaveAttribute("data-selected", "true");
  await expect(map(page).locator('[aria-current="true"]')).toHaveCount(1);

  // Escape belongs to the map: in a filter it leaves the selection alone.
  await page.getByRole("combobox", { name: "Platform" }).focus();
  await page.keyboard.press("Escape");
  await page.getByRole("checkbox", { name: "Show proposed" }).focus();
  await page.keyboard.press("Escape");

  // Only links of selected (on by default): the other edges are hidden.
  await expect(edges(page)).toHaveCount(11);
  await expect(page.locator('[data-edge][data-on="true"]')).toHaveCount(11);
  for (const e of await edges(page).all()) {
    const ends = [await e.getAttribute("data-from"), await e.getAttribute("data-to")];
    expect(ends).toContain("trip.timeline");
  }
  // Tabs are one edge with arrowheads at both ends.
  const tabs = page.locator('[data-edge][data-from="trip.map"][data-to="trip.timeline"]');
  await expect(tabs).toHaveAttribute("data-two-way", "true");
  await expect(tabs.locator("path").first()).toHaveAttribute("marker-start", /url\(#/);

  await page.getByRole("checkbox", { name: "Only links of selected" }).uncheck();
  await expect(edges(page)).toHaveCount(39);
  await expect(page.locator('[data-edge][data-on="true"]')).toHaveCount(11);
  await expect(page.locator('[data-edge][data-on="false"]')).toHaveCount(28);

  await expect(panel(page).getByRole("heading", { name: "trip.timeline" })).toBeVisible();
  await expect(panel(page).getByRole("list", { name: /^Links out/ }).getByRole("listitem")).toHaveCount(7);
  await expect(panel(page).getByRole("list", { name: /^Links in/ }).getByRole("listitem")).toHaveCount(7);
  await expect(panel(page).getByRole("link", { name: "Open in screen editor" })).toHaveAttribute("href", "#/screens/trip.timeline");
  const flows = panel(page).getByRole("list", { name: /^Flows that pass through here/ });
  await expect(flows.getByRole("link", { name: "Add an activity" })).toHaveAttribute("href", "#/flows/add-activity/walk/1");
  await expect(flows.getByRole("listitem").filter({ hasText: "Add an activity" })).toContainText("from step 1");
  await expect(flows.getByRole("link", { name: "Look around a trip" })).toHaveAttribute("href", "#/flows/look-around-a-trip/walk/2");

  // A link out selects its target.
  await panel(page).getByRole("button", { name: /→ activity\.detail/ }).click();
  await expect(node(page, "activity.detail")).toHaveAttribute("data-selected", "true");
  await expect(node(page, "activity.detail")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(map(page).locator('[data-selected="true"]')).toHaveCount(0);
  await expect(page.locator('[data-edge][data-on="true"]')).toHaveCount(0);
  await expect(panel(page)).toContainText("Select a screen");
});

test("proposed toggle hides dashed nodes: a proposed screen and its links are dashed, and Show proposed off hides them", async ({ page }) => {
  await openMap(page);
  const platform = page.getByRole("combobox", { name: "Platform" });
  await expect(platform.getByRole("option")).toHaveText(["All", "ios", "android", "web"]);
  // sharing.invite is shipped on ios and web, proposed on android.
  await expect(node(page, "sharing.invite")).toHaveAttribute("data-proposed", "false");
  await platform.selectOption("android");
  await expect(node(page, "sharing.invite")).toHaveAttribute("data-proposed", "true");
  await expect(node(page, "sharing.invite")).toContainText("proposed");
  const dashed = page.locator('[data-edge][data-proposed="true"]');
  await expect(dashed).toHaveCount(3);
  await expect(dashed.locator("path").first()).toHaveClass(/map-edge__line--proposed/);

  await page.getByRole("checkbox", { name: "Show proposed" }).uncheck();
  await expect(node(page, "sharing.invite")).toHaveCount(0);
  await expect(dashed).toHaveCount(0);
  await expect(edges(page)).toHaveCount(36);
  await expect(map(page).getByRole("link")).toHaveCount(19);

  await page.getByRole("checkbox", { name: "Show proposed" }).check();
  await platform.selectOption("All");
  await expect(node(page, "sharing.invite")).toHaveAttribute("data-proposed", "false");
  await expect(edges(page)).toHaveCount(39);
});

test("platform filter: a screen not on the platform leaves the map with its links", async ({ page }) => {
  const files = travelApp();
  const registry = "docs/flows/screens.yaml";
  files[registry] = (files[registry] ?? "").replace(
    "    purpose: Where each activity is, day by day.\n",
    "    purpose: Where each activity is, day by day.\n    platforms: [web]\n",
  );
  await page.goto("./");
  await openFiles(page, files, "travel-app");
  await page.goto("./#/map");
  await expect(node(page, "trip.map")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("combobox", { name: "Platform" }).selectOption("ios");
  await expect(node(page, "trip.map")).toHaveCount(0);
  await expect(page.locator('[data-edge][data-to="trip.map"], [data-edge][data-from="trip.map"]')).toHaveCount(0);
  await expect(edges(page)).toHaveCount(36);
});

test("cycles: screens in one area that link both ways, in several areas, still lay out", async ({ page }) => {
  // The graph that made ELK throw: two-way links inside three areas, joined
  // by one-way links across areas, plus a link back to an earlier area, a
  // self link and tabs.
  const links: [string, string][] = [
    ["activity.detail", "activity.invite"],
    ["activity.invite", "activity.detail"],
    ["auth.sign-in", "auth.sign-up"],
    ["auth.sign-up", "auth.sign-in"],
    ["auth.sign-up", "home.trips"],
    ["home.trips", "home.trips"],
    ["home.trips", "trip.timeline"],
    ["sharing.invite", "sharing.roster"],
    ["sharing.roster", "auth.sign-in"],
    ["sharing.roster", "sharing.invite"],
    ["trip.day", "activity.detail"],
    ["trip.info", "sharing.roster"],
    ["trip.timeline", "activity.detail"],
    ["trip.timeline", "trip.day"],
    ["trip.timeline", "trip.info"],
  ];
  const ids = [...new Set(links.flat())].sort();
  const screen = (id: string) =>
    [
      `  ${id}:`,
      `    title: ${id}`,
      `    area: ${id.split(".")[0] ?? ""}`,
      `    purpose: A screen.`,
      `    presentation: push`,
      `    layout:`,
      `      - {region: body, kind: text, label: Body}`,
      ...links.filter(([from]) => from === id).map(([, to], i) => `      - {region: go-${i}, kind: action, label: Go, to: ${to}}`),
      ...(id === "trip.day" ? [`      - region: tabs`, `        kind: tabs`, `        items:`, `          - {label: Info, to: trip.info}`] : []),
    ].join("\n");
  // The example's flows are left out: they name screens this registry lacks.
  const files = Object.fromEntries(Object.entries(travelApp()).filter(([path]) => !path.startsWith("docs/flows/flows/")));
  files["starboard.yaml"] = (files["starboard.yaml"] ?? "").replace(/^areas: .*$/m, "areas: [auth, home, trip, activity, sharing]");
  files[REGISTRY] = `screens:\n${ids.map(screen).join("\n")}\n`;
  await page.goto("./");
  await openFiles(page, files, "travel-app");
  await page.goto("./#/map");
  await expect(node(page, "auth.sign-in")).toBeVisible({ timeout: 30_000 });
  // Neither the failure note (now or as it was worded) nor its alert is shown.
  await expect(page.getByText(/could not (draw|lay out) the map/)).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(map(page).getByRole("link")).toHaveCount(ids.length);
  // 15 links: the self link is not drawn; the tabs link is one more edge.
  await expect(edges(page)).toHaveCount(15);
});

test("keyboard traversal: Tab reaches the nodes, focus selects, arrows move to the nearest node, Enter opens the screen", async ({
  page,
  browserName,
}) => {
  // Safari's Tab skips links unless the user turns on "Press Tab to
  // highlight each item"; Option-Tab is its key for every control.
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await openMap(page);
  await page.getByRole("checkbox", { name: "Only links of selected" }).focus();
  await page.keyboard.press(tab);
  await expect(node(page, "auth.sign-in")).toBeFocused();
  await expect(node(page, "auth.sign-in")).toHaveAttribute("data-selected", "true");
  await expect(page.getByRole("status").filter({ hasText: /^Selected auth\.sign-in/ })).toHaveText(/2 links out, 2 in/);
  // The map is one Tab stop: the other nodes are reached with the arrows.
  await expect(map(page).locator('a[tabindex="0"]')).toHaveCount(1);
  await expect(map(page).locator('a[tabindex="-1"]')).toHaveCount(20);

  const focused = page.locator(":focus");
  // The focused node's centre on the map's canvas, as the arrows measure
  // it: nodes differ in width, and the map is wider than the viewport and
  // scrolls to keep focus in view, so viewport coordinates would move.
  const box = async () => {
    const [b, canvas] = [await focused.boundingBox(), await map(page).boundingBox()];
    if (!b || !canvas) throw new Error("nothing focused");
    return { x: b.x + b.width / 2 - canvas.x, y: b.y + b.height / 2 - canvas.y };
  };
  const moves: [string, (was: { x: number; y: number }, now: { x: number; y: number }) => boolean][] = [
    ["ArrowRight", (was, now) => now.x > was.x],
    ["ArrowLeft", (was, now) => now.x < was.x],
    ["ArrowDown", (was, now) => now.y > was.y],
    ["ArrowUp", (was, now) => now.y < was.y],
  ];
  for (const [key, ok] of moves) {
    const was = await box();
    await page.keyboard.press(key);
    await expect(focused).toHaveAttribute("data-selected", "true");
    expect(ok(was, await box()), key).toBe(true);
    await expect(map(page).locator('[data-selected="true"]')).toHaveCount(1);
  }
  // At the map's edge an arrow stays put. The first screen in tab order
  // need not be the leftmost: auth.welcome, which leads to it, is.
  await node(page, "auth.welcome").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(node(page, "auth.welcome")).toBeFocused();

  // End and Home go to the last and first node; Tab leaves the map from any of them.
  await page.keyboard.press("End");
  await expect(node(page, "settings.main")).toBeFocused();
  await expect(node(page, "settings.main")).toHaveAttribute("tabindex", "0");
  await page.keyboard.press(tab);
  await expect(map(page).locator(":focus")).toHaveCount(0);
  await page.keyboard.press(browserName === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab");
  await expect(node(page, "settings.main")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(node(page, "auth.sign-in")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(map(page).locator('[data-selected="true"]')).toHaveCount(0);
  await expect(map(page).locator('[aria-current="true"]')).toHaveCount(0);
  await expect(node(page, "auth.sign-in")).toBeFocused();
  await expect(node(page, "auth.sign-in")).toHaveAttribute("tabindex", "0");

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/screens\/auth\.sign-in$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
});

test("the layout runs off the main thread: opening the map makes no long task", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "PerformanceObserver longtask is Chromium's");
  await page.goto("./");
  await openFiles(page, travelApp(), "travel-app");
  await expect(page.getByRole("link", { name: /^Lint:/ })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => {
    const w = globalThis as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long.push(e.duration);
    }).observe({ type: "longtask" });
  });
  // Driven from inside the page (HTMLElement.click()), through the app's own
  // handlers: Playwright's synthetic click is a page task of its own, which
  // under parallel load passed 100 ms here, before #22's changes as after,
  // as it did in perf.spec.ts.
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "App map" }).evaluate((e) => (e as HTMLElement).click());
  await expect(node(page, "trip.timeline")).toBeVisible({ timeout: 30_000 });
  await node(page, "trip.timeline").evaluate((e) => (e as HTMLElement).click());
  const long = await page.evaluate(() => (globalThis as unknown as { __long: number[] }).__long);
  expect(long.filter((d) => d > 100)).toEqual([]);
});
