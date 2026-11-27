// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Review Focus 5: on a browser without showDirectoryPicker (WebKit,
// Firefox) a folder opens view-only, edits collect as changes not saved to
// disk, and Download changes gives exactly the changed files, formatted: one
// file alone (saved by its base name, its project-relative path shown), or a
// zip of project-relative paths with .starboard-deleted.txt listing what Fix removed.
// The folder is a copy of examples/travel-app, picked with the directory
// input as a user would.
//
// Firefox on macOS: Playwright's Firefox (159, build 1572) crashes its
// content process there (SIGSEGV, a null dereference inside XUL, the same
// frame every time) a few queries after the app's editor has made a change,
// whatever the query (axe, a role locator, allTextContents), with every JIT
// and the accessibility service turned off too; page code cannot cause a
// segfault. The same happens in screens.spec.ts on a memory host, so it is
// not the view-only path. CI runs Firefox on Linux; there this spec runs.
// Tracked in c65llc/starboard#9.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Download, Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import { coreFormat, cspViolations, expectNoAxeViolations, REGISTRY } from "./helpers.ts";
import type { Files } from "./helpers.ts";

const example = fileURLToPath(new URL("../../../examples/travel-app", import.meta.url));
const STALE = "docs/flows/generated/wireframes/retired.phone.svg";

test.skip(({ browserName }) => browserName === "chromium", "Chromium edits in place; view-only is WebKit's and Firefox's path");
test.fixme(
  ({ browserName }) => browserName === "firefox" && process.platform === "darwin",
  "c65llc/starboard#9: Playwright's Firefox crashes its content process on macOS (see the top of this file)",
);

let dir = "";

test.beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "starboard-readonly-")), "travel-app");
  cpSync(example, dir, { recursive: true });
});

test.afterEach(() => {
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

/** onDisk is the copy's text of path, as the project holds it (unchanged by the app). */
const onDisk = (path: string): string | undefined => {
  try {
    return readFileSync(join(dir, path), "utf8");
  } catch {
    return undefined;
  }
};

async function openViewOnly(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Open folder (view only)" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(dir);
  await expect(page.getByRole("banner")).toContainText("View only");
  await expect(page.getByRole("banner")).toContainText("travel-app");
}

async function editTimelineLabel(page: Page, text: string): Promise<void> {
  await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: /^trip\.timeline/ }).click();
  const tree = page.getByRole("tree", { name: /^Layout/ });
  await tree.getByRole("treeitem", { name: /^add-activity / }).click();
  const label = page.getByRole("form", { name: "Region · add-activity" }).getByLabel("Label", { exact: true });
  await label.fill(text);
  await label.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: /kept for download/ })).toBeVisible();
}

/** toFlows leaves the screen editor for the Flows view; the header, and its panel, stay. */
async function toFlows(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "Flows" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Flows");
}

const panel = (page: Page) => page.getByRole("region", { name: /^Changes (not saved to disk|downloaded)$/ });

/** listed is the text of each item of the panel's list named name. */
function listed(page: Page, name: string): Promise<string[]> {
  return panel(page)
    .getByRole("list", { name })
    .getByRole("listitem")
    .evaluateAll((items) => items.map((li) => li.textContent ?? ""));
}

/**
 * expectFormatted checks sources are as core.format leaves them. core.format
 * returns only the files it would change, so first a copy made unformatted
 * (trailing blank lines) must come back changed, proving the hook answers
 * for the files given; then the sources themselves must not come back.
 */
async function expectFormatted(page: Page, sources: Files): Promise<void> {
  const paths = Object.keys(sources);
  const messy = Object.fromEntries(paths.map((p) => [p, `${sources[p] ?? ""}\n\n\n`]));
  const control = await coreFormat(page, projectFiles(["starboard.yaml", REGISTRY], messy));
  expect(Object.keys(control).sort()).toEqual(paths.sort());
  for (const p of paths) expect(control[p], p).toEqual(sources[p]);
  expect(await coreFormat(page, projectFiles(["starboard.yaml", REGISTRY], sources))).toEqual({});
}

async function download(page: Page): Promise<Download> {
  const started = page.waitForEvent("download");
  await panel(page).getByRole("button", { name: /^Download (changes|again)$/ }).click();
  return started;
}

async function readDownload(d: Download): Promise<Buffer> {
  return readFileSync(await d.path());
}

/** projectFiles is the copy's text files as the app reads them, with changes laid over. */
function projectFiles(paths: string[], over: Files): Files {
  const files: Files = {};
  for (const p of paths) files[p] = onDisk(p) ?? "";
  return { ...files, ...over };
}

test("one changed file downloads alone, by its base name, with its project path shown", async ({ page }) => {
  const csp = cspViolations(page);
  await openViewOnly(page);
  await expect(page.getByRole("link", { name: /0 errors, 0 warnings/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Not saved to disk/ })).toHaveCount(0);

  await editTimelineLabel(page, "Add a stop");
  await toFlows(page);
  const indicator = page.getByRole("button", { name: /Not saved to disk \(1\)/ });
  await expect(indicator).toBeVisible();
  await expect(indicator).not.toHaveAttribute("aria-controls");
  // Escape and a click outside close the panel; opening moves focus into it.
  await indicator.click();
  await expect(panel(page)).toBeFocused();
  await expect(indicator).toHaveAttribute("aria-controls", "pending-panel");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(indicator).toBeFocused();
  await indicator.click();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(panel(page)).toHaveCount(0);
  await indicator.click();
  await expect(indicator).toHaveAttribute("aria-expanded", "true");
  expect(await listed(page, "Changed")).toEqual([REGISTRY]);
  await expect(panel(page).getByRole("list", { name: "To delete" })).toHaveCount(0);
  await expect(panel(page)).toContainText(`Save as ${REGISTRY} in your project`);
  await expectNoAxeViolations(page);

  const d = await download(page);
  expect(d.suggestedFilename()).toBe("screens.yaml");
  // The button stays, to download the same changes again (the browser may
  // have blocked the download), and keeps focus.
  const again = page.getByRole("button", { name: "Downloaded — download again" });
  await expect(again).toBeFocused();
  const text = (await readDownload(d)).toString("utf8");
  expect(text).not.toEqual(onDisk(REGISTRY));
  expect(text).toContain("label: Add a stop");
  // Formatted: core.format of the project with it laid over leaves it as it is.
  await expectFormatted(page, { [REGISTRY]: text });

  await expect(page.getByRole("status").filter({ hasText: `Save as ${REGISTRY} in your project` })).toBeVisible();
  await expect(page.getByRole("button", { name: /Not saved to disk/ })).toHaveCount(0);
  await again.click();
  await expect(panel(page)).toContainText("Changes downloaded");
  expect(await listed(page, "Changed")).toEqual([REGISTRY]);
  await expectNoAxeViolations(page);
  const started = page.waitForEvent("download");
  await panel(page).getByRole("button", { name: "Download again" }).click();
  const d2 = await started;
  expect(d2.suggestedFilename()).toBe("screens.yaml");
  expect((await readDownload(d2)).toString("utf8")).toEqual(text);
  await expect(again).toBeFocused();
  // The app goes on showing the edit it handed over.
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "Screens" }).click();
  await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: /^trip\.timeline/ }).click();
  await page.getByRole("tree", { name: /^Layout/ }).getByRole("treeitem", { name: /^add-activity / }).click();
  await expect(page.getByRole("form", { name: "Region · add-activity" }).getByLabel("Label", { exact: true })).toHaveValue(
    "Add a stop",
  );
  // The next edit ends the chance to download the last set again.
  await editTimelineLabel(page, "Add a place");
  await expect(page.getByRole("button", { name: "Downloaded — download again" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Not saved to disk \(1\)/ })).toBeVisible();
  expect(csp).toEqual([]);
});

test("Fix automatically's changes and deletions download as one zip of project paths, with the deletions list", async ({
  page,
}) => {
  writeFileSync(join(dir, STALE), onDisk("docs/flows/generated/wireframes/trip.timeline.phone.svg") ?? "");
  await openViewOnly(page);
  await expect(page.getByRole("link", { name: /\d+ errors?, \d+ warnings?/ })).toBeVisible({ timeout: 30_000 });

  await editTimelineLabel(page, "Add a stop");
  const lint = page.getByRole("region", { name: "Lint findings" });
  await lint.getByRole("button", { name: /^Fix \d+ automatically$/ }).click();
  await expect(page.getByRole("link", { name: /0 errors, 0 warnings/ })).toBeVisible({ timeout: 30_000 });
  await toFlows(page);

  await page.getByRole("button", { name: /Not saved to disk/ }).click();
  const changed = await listed(page, "Changed");
  const deleted = await listed(page, "To delete");
  expect(changed).toContain(REGISTRY);
  expect(changed).toContain("docs/flows/generated/wireframes/trip.timeline.phone.svg");
  expect(deleted).toEqual([STALE]);
  await expect(panel(page)).toContainText("travel-app-changes.zip");
  await expectNoAxeViolations(page);

  const d = await download(page);
  expect(d.suggestedFilename()).toBe("travel-app-changes.zip");
  const zip = unzipSync(new Uint8Array(await readDownload(d)));
  const entries = Object.fromEntries(Object.entries(zip).map(([p, b]) => [p, strFromU8(b)]));
  expect(Object.keys(entries).sort()).toEqual([...changed, ".starboard-deleted.txt"].sort());
  expect(entries[".starboard-deleted.txt"]).toBe(`${STALE}\n`);
  // Exactly the changed files: each differs from what the folder holds.
  for (const path of changed) expect(entries[path], path).not.toEqual(onDisk(path));
  // And formatted as core.format would leave them.
  const sources = Object.fromEntries(changed.filter((p) => !p.includes("/generated/")).map((p) => [p, entries[p] as string]));
  expect(Object.keys(sources)).toEqual([REGISTRY]);
  await expectFormatted(page, sources);

  await expect(page.getByRole("status").filter({ hasText: /Unzip travel-app-changes\.zip/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Not saved to disk/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Downloaded — download again" }).click();
  expect(await listed(page, "To delete")).toEqual([STALE]);
  const again = await download(page);
  expect(again.suggestedFilename()).toBe("travel-app-changes.zip");
  const zip2 = unzipSync(new Uint8Array(await readDownload(again)));
  expect(Object.keys(zip2).sort()).toEqual(Object.keys(entries).sort());
});
