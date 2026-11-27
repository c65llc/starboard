// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The flow editor (#/flows/<id>/edit), on the example project with a
// diagram added to add-activity: the flow list, @ autocomplete, live lint
// markers, the Mermaid diagram and its links, the reference chips'
// wireframe previews, and saving (⌘/Ctrl-S and autosave) through core.

import type { Page } from "@playwright/test";

import { expect, test } from "./test.ts";
import { FLOW, travelApp } from "./fixtures/travel-app.ts";
import { changedPaths, coreFormat, cspViolations, expectNoAxeViolations, hostFiles, openFiles, putFile, REGISTRY } from "./helpers.ts";

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
  // CodeMirror loads on first use; under a full parallel run that can pass 5 s.
  await expect(editor(page)).toBeVisible({ timeout: 15_000 });
}

/**
 * settledChip is the @activity.add#title chip once the diagram above it is
 * drawn. The diagram draws after a delay and pushes the chips down, so a
 * pointer placed on a chip before then is left off it, and the browser
 * reports the pointer leaving.
 */
async function settledChip(page: Page) {
  await expect(page.getByRole("figure", { name: "Diagram" }).getByRole("link", { name: "Open screen activity.add" })).toBeVisible({ timeout: 30_000 });
  return page.getByRole("list", { name: "References" }).getByRole("link", { name: "@activity.add#title" });
}

/** nextFrame resolves once the page has painted twice: any render an event queued has run. */
const nextFrame = (page: Page) =>
  page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

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
  await expect(list.getByRole("link")).toHaveText([
    "Add an activity",
    "Answer the inbox",
    "Invite a traveller",
    "Join a trip",
    "Look around a trip",
    "Pack for a trip",
    "Plan a trip",
    "Sign up, sign in and sign out",
  ]);
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
  // On the page's clock, which stands still from the typing on and moves
  // 1 s: past the linter's 300 ms delay, short of the 1.5 s autosave, so
  // the findings below are the live lint's, whatever the machine's speed.
  await page.clock.install();
  await openFlow(page);
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
  await typeAtEnd(page, "6. Then @trip.timeline#nowhere");
  await page.clock.runFor(1_000);
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
  const chip = await settledChip(page);
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

test("a dismissed preview stays dismissed when hover or focus ends while the other holds", async ({ page }) => {
  await openFlow(page);
  const chip = await settledChip(page);
  const tooltip = page.getByRole("tooltip");
  // Focused and hovered; Escape; the pointer leaves, focus stays.
  await chip.focus();
  await chip.hover();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await page.getByRole("heading", { level: 1 }).hover();
  await nextFrame(page);
  await expect(chip).toBeFocused();
  await expect(tooltip).toBeHidden();
  // Hovered and focused; Escape; focus leaves, the pointer stays.
  await chip.hover();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await chip.blur();
  await nextFrame(page);
  await expect(tooltip).toBeHidden();
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
  // Timed on the page's clock, not the wall's: on a slow runner the round
  // trips between the last keystroke and a wall-clock check can take longer
  // than the 1.5 s itself. The clock runs freely while the project loads,
  // then stands still from just before the typing, so the save's timer
  // (session.ts, AUTOSAVE_MS) is due exactly 1.5 s after the last keystroke
  // and moves only when runFor moves it.
  await page.clock.install();
  await openFlow(page);
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
  await typeAtEnd(page, "6. Check @trip.timeline#days.");
  const unsaved = page.getByRole("status").filter({ hasText: "Unsaved changes" });
  await expect(unsaved).toHaveCount(1);

  await page.clock.runFor(1_499);
  await page.keyboard.press("Escape"); // close the completion list, which opened on the way
  // The save sets "Saving…" in its timer's own task, so a save already begun would show here.
  await expect(unsaved, "nothing is written within 1.5 s of the last keystroke").toHaveCount(1);
  expect((await hostFiles(page))[FLOW], "nothing is written within 1.5 s of the last keystroke").not.toContain("6. Check");

  await page.clock.runFor(1);
  await expect(unsaved, "the save starts at 1.5 s").toHaveCount(0);
  await page.clock.resume();
  await expect.poll(async () => (await hostFiles(page))[FLOW], { timeout: 5_000, intervals: [50] }).toContain("6. Check @trip.timeline#days.");
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

test("a diagram that stops parsing keeps the last drawing under the error", async ({ page }) => {
  await openFlow(page);
  const diagram = page.getByRole("figure", { name: "Diagram" });
  await expect(diagram.getByRole("link", { name: "Open screen activity.add" })).toBeVisible({ timeout: 30_000 });
  const text = (await hostFiles(page))[FLOW] ?? "";
  await putFile(page, FLOW, text.replace("  search --> add\n", "  search --> add\n  ((( -->\n"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(diagram).toContainText("The diagram could not be drawn", { timeout: 30_000 });
  await expect(diagram).toContainText("The last drawing that worked is shown.");
  await expect(diagram.getByRole("link", { name: "Open screen activity.add" })).toBeVisible();
});

test("the diagram is drawn again when the screens it links to change", async ({ page }) => {
  await openFlow(page);
  const diagram = page.getByRole("figure", { name: "Diagram" });
  await expect(diagram.getByRole("link", { name: "Open screen activity.place-search" })).toBeVisible({ timeout: 30_000 });
  const registry = (await hostFiles(page))[REGISTRY] ?? "";
  await putFile(page, REGISTRY, registry.replace("  activity.place-search:\n", "  activity.place-find:\n"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(diagram.getByRole("link", { name: "Open screen activity.place-search" })).toHaveCount(0, { timeout: 30_000 });
  await expect(diagram.getByRole("link", { name: "Open screen activity.add" })).toBeVisible();
});
