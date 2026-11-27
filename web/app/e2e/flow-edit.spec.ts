// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The flow editor (#/flows/<id>/edit), on the example project with a
// diagram added to add-activity: the flow list, @ autocomplete, live lint
// markers, the Mermaid diagram and its links, the reference chips'
// wireframe previews, and saving (⌘/Ctrl-S and autosave) through core.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { FLOW, travelApp } from "./fixtures/travel-app.ts";
import { changedPaths, coreFormat, cspViolations, expectNoAxeViolations, hostFiles, openFiles } from "./helpers.ts";

const editor = (page: Page) => page.getByRole("textbox", { name: "Markdown of add-activity.md" });
const status = (page: Page) => page.getByRole("status").filter({ hasText: /Saved|Not saved|Saving|kept/ });
const completion = (page: Page, name: RegExp) => page.getByRole("listbox").getByRole("option", { name });
/** body is the editor's text, line breaks kept (textContent joins the lines). */
const body = (page: Page) => editor(page).evaluate((e) => (e as HTMLElement).innerText);

async function openFlow(page: Page, files = travelApp()): Promise<void> {
  await page.goto("./");
  await openFiles(page, files, "travel-app");
  await expect(page.getByRole("link", { name: /^Lint:/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "Flows" }).click();
  await expect(page).toHaveURL(/#\/flows$/);
  await page.getByRole("link", { name: "Add an activity" }).click();
  await expect(page).toHaveURL(/#\/flows\/add-activity\/edit$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Add an activity");
  await expect(editor(page)).toBeVisible();
}

/**
 * accept takes the selected completion with Enter, once the list has been
 * showing for longer than CodeMirror's interactionDelay (75 ms, in which
 * Enter is still a newline, so a fast typist does not pick by accident).
 * The wait is on the page's clock, measured from when the list was seen.
 */
async function accept(page: Page): Promise<void> {
  const shown = await page.evaluate(() => performance.now());
  await page.waitForFunction((since) => performance.now() - since > 100, shown);
  await page.keyboard.press("Enter");
}

/** typeAtEnd puts the cursor at the end of the body and types text. */
async function typeAtEnd(page: Page, text: string): Promise<void> {
  await editor(page).focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
}

test("the flow list and the editor: diagram, chips and modes; axe finds nothing, the CSP refuses nothing", async ({ page }) => {
  const csp = cspViolations(page);
  await page.goto("./");
  await openFiles(page, travelApp(), "travel-app");
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "Flows" }).click();
  const list = page.getByRole("list", { name: "Flows" });
  await expect(list.getByRole("link")).toHaveText(["Add an activity", "Invite a traveller", "Look around a trip", "Plan a trip"]);
  await expect(list).toContainText("5 steps");
  await expect(list).toContainText("proposed");
  await expectNoAxeViolations(page);

  await page.getByRole("link", { name: "Add an activity" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Add an activity");
  const modes = page.getByRole("navigation", { name: "Mode" });
  await expect(modes.getByRole("link", { name: "Edit" })).toHaveAttribute("aria-current", "page");
  await expect(editor(page)).toContainText("## Steps");
  await expect(editor(page)).not.toContainText("title: Add an activity"); // the front matter is in the fields
  await expect(page.getByRole("group", { name: "Front matter" }).getByLabel("Title", { exact: true })).toHaveValue("Add an activity");

  const diagram = page.getByRole("figure", { name: "Diagram" });
  await expect(diagram.getByRole("link", { name: "Open screen activity.add" })).toBeVisible({ timeout: 30_000 });
  await expect(diagram.locator("style, script, foreignObject")).toHaveCount(0);

  const chips = page.getByRole("list", { name: "References" });
  await expect(chips.getByRole("link", { name: "@trip.timeline#add-activity" })).toBeVisible();

  await expectNoAxeViolations(page);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expectNoAxeViolations(page);

  await modes.getByRole("link", { name: "Walk through" }).click();
  await expect(page).toHaveURL(/#\/flows\/add-activity\/walk$/);
  await expect(modes.getByRole("link", { name: "Walk through" })).toHaveAttribute("aria-current", "page");
  await modes.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(/#\/flows\/add-activity\/edit$/);
  expect(csp).toEqual([]);
});

test("every script a flowchart loads is precached, so diagrams draw offline; other diagram types are not", async ({ page }) => {
  await openFlow(page);
  await expect(page.getByRole("figure", { name: "Diagram" }).getByRole("link").first()).toBeVisible();
  const loaded = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((e) => new URL(e.name).pathname)
      .filter((p) => /\/assets\/[^/]+\.js$/.test(p))
      .map((p) => p.slice(p.indexOf("assets/"))),
  );
  expect(loaded.some((p) => p.startsWith("assets/flowDiagram-"))).toBe(true);
  const sw = await page.evaluate(() => fetch("sw.js").then((r) => r.text()));
  expect(loaded.filter((p) => !sw.includes(`"${p}"`))).toEqual([]);
  // Mermaid's own elk layout is not precached; the app map's ELK worker is, so the map works offline.
  expect(sw).not.toMatch(/assets\/(elk-(?!worker\.min-)|cytoscape|katex|sequenceDiagram)[^"]*\.js/);
  expect(sw).toMatch(/"assets\/elk-worker\.min-[^"]*\.js"/);
});

test("autocomplete inserts ref", async ({ page }) => {
  await openFlow(page);
  await typeAtEnd(page, "6. Back on @trip.ti");
  await expect(completion(page, /trip\.timeline/)).toBeVisible();
  await accept(page);
  await page.keyboard.type("#add-");
  await expect(completion(page, /add-activity/)).toBeVisible();
  await accept(page);
  await expect(editor(page)).toContainText("6. Back on @trip.timeline#add-activity");
});

test("unresolved ref underlined", async ({ page }) => {
  await openFlow(page);
  await typeAtEnd(page, "6. Then @trip.timeline#nowhere");
  await page.keyboard.press("Escape"); // close the completion list
  const marked = editor(page).locator(".cm-lintRange-error");
  await expect(marked).toHaveText("@trip.timeline#nowhere");
  const findings = page.getByRole("region", { name: "Findings in this file" });
  await expect(findings).toContainText("ref-unresolved");
  await expect(findings).toContainText("trip.timeline has no region nowhere");
  // Live: nothing was saved for it.
  expect((await hostFiles(page))[FLOW]).not.toContain("nowhere");
});

test("diagram node navigates", async ({ page }) => {
  await openFlow(page);
  const diagram = page.getByRole("figure", { name: "Diagram" });
  // By keyboard: the node is a link, and Enter follows it.
  await diagram.getByRole("link", { name: "Open screen activity.add" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/screens\/activity\.add$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Add activity");
  await page.goBack();
  // And by pointer.
  await diagram.getByRole("link", { name: "Open screen activity.place-search" }).click();
  await expect(page).toHaveURL(/#\/screens\/activity\.place-search$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Find a place");
});

test("a reference chip previews its wireframe on hover and focus, and Escape dismisses it", async ({ page }) => {
  await openFlow(page);
  const chip = page.getByRole("list", { name: "References" }).getByRole("link", { name: "@activity.add#title" });
  await chip.hover();
  const preview = page.getByRole("tooltip");
  await expect(preview.getByRole("img", { name: /Wireframe of activity\.add/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await chip.focus();
  await expect(chip).toHaveAccessibleDescription(/Wireframe of activity\.add/);
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();
  await expect(chip).toBeFocused();
  // A new hover shows it again, though focus never left.
  await page.getByRole("heading", { level: 1 }).hover();
  await chip.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
});

test("save writes formatted file", async ({ page }) => {
  await openFlow(page);
  const before = await hostFiles(page);
  await page.getByRole("group", { name: "Front matter" }).getByLabel("Title", { exact: true }).fill("Add an activity to a day");
  await typeAtEnd(page, "\n\n\n6. Check @trip.timeline#days again.   ");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(status(page)).toHaveText("Saved · formatted");
  const after = await hostFiles(page);
  expect(changedPaths(before, after)).toEqual([FLOW]);
  const text = after[FLOW] ?? "";
  expect(text).toContain("title: Add an activity to a day");
  expect(text).toContain("6. Check @trip.timeline#days again.");
  expect(text).toEqual((await coreFormat(page, { ...after }))[FLOW] ?? text);
  expect(text).not.toMatch(/ +\n/);
  // The editor shows what was written.
  await expect.poll(() => body(page)).toContain("6. Check @trip.timeline#days again.\n");
  expect(await body(page)).not.toMatch(/again\. +/);
});

test("autosaves after 1.5 s idle, and not before", async ({ page }) => {
  await openFlow(page);
  await typeAtEnd(page, "6. Check @trip.timeline#days.");
  const typed = Date.now();
  await page.keyboard.press("Escape");
  expect((await hostFiles(page))[FLOW]).not.toContain("6. Check");
  await page.waitForTimeout(1_000);
  expect((await hostFiles(page))[FLOW], "nothing is written within 1.5 s of the last keystroke").not.toContain("6. Check");
  await expect.poll(async () => (await hostFiles(page))[FLOW], { timeout: 5_000, intervals: [50] }).toContain("6. Check @trip.timeline#days.");
  expect(Date.now() - typed).toBeGreaterThanOrEqual(1_450);
  await expect(status(page)).toHaveText("Saved · formatted");
});

test("⌘/Ctrl-S saves from anywhere in the view, not only the editor", async ({ page }) => {
  await openFlow(page);
  await typeAtEnd(page, "6. Check @trip.timeline#days.");
  await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "Flows" }).getByRole("link", { name: "Plan a trip" }).focus();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(status(page)).toHaveText("Saved · formatted");
  expect((await hostFiles(page))[FLOW]).toContain("6. Check @trip.timeline#days.");
});

test("every front matter key has a field; lists save as lists; an emptied required field is held back", async ({ page }) => {
  await openFlow(page);
  const fields = page.getByRole("group", { name: "Front matter" });
  for (const label of ["ID", "Title", "Status", "Entry screen", "Actors", "Platforms"]) {
    await expect(fields.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(fields.getByLabel("ID", { exact: true })).toHaveValue("add-activity");
  await fields.getByLabel("Actors", { exact: true }).fill("organizer, member");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(status(page)).toHaveText("Saved · formatted");
  expect((await hostFiles(page))[FLOW]).toMatch(/actors: \[organizer, member\]/);

  const title = fields.getByLabel("Title", { exact: true });
  await title.fill("");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(title).toHaveAccessibleDescription(/Title is required/);
  await page.waitForTimeout(2_000); // past the autosave: still not written
  expect((await hostFiles(page))[FLOW]).toContain("title: Add an activity");
  await expectNoAxeViolations(page);
  await title.fill("Add an activity, again");
  await expect(title).not.toHaveAttribute("aria-invalid", "true");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(status(page)).toHaveText("Saved · formatted");
  expect((await hostFiles(page))[FLOW]).toContain("title: Add an activity, again");
});
