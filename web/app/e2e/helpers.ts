// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// What the e2e specs share: axe, the CSP report collector, opening the
// example, and the app's e2e hook (src/e2e-hook.ts), which exists only
// when navigator.webdriver is true, as under Playwright.

import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export type Files = Record<string, string>;

export const REGISTRY = "docs/flows/screens.yaml";

interface Hook {
  open(files: Files, name: string): Promise<void>;
  files(): Promise<Files | null>;
  format(files: Files): Promise<Record<string, string>>;
}

/** cspViolations collects the page's Content-Security-Policy reports. */
export function cspViolations(page: Page): string[] {
  const seen: string[] = [];
  page.on("console", (msg) => {
    if (/Content[- ]Security[- ]Policy|Refused to/i.test(msg.text())) seen.push(msg.text());
  });
  return seen;
}

export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} (${n.failureSummary ?? ""})`).join(", ")}`),
  ).toEqual([]);
}

/** openExample opens travel-app from the Open screen and waits for its lint. */
export async function openExample(page: Page): Promise<void> {
  await page.goto("./");
  await page.getByRole("button", { name: "Explore the example project" }).click();
  await expect(page.getByRole("link", { name: /0 errors, 0 warnings/ })).toBeVisible({ timeout: 30_000 });
}

async function waitForHook(page: Page): Promise<void> {
  await page.waitForFunction(() => "__starboardE2E" in globalThis);
}

/** openFiles opens files in a memory host through the e2e hook. */
export async function openFiles(page: Page, files: Files, name = "fixture"): Promise<void> {
  await waitForHook(page);
  await page.evaluate(
    ([f, n]) => (globalThis as unknown as { __starboardE2E: Hook }).__starboardE2E.open(f, n),
    [files, name] as const,
  );
}

/** hostFiles is the open memory host's files as they are now. */
export async function hostFiles(page: Page): Promise<Files> {
  await waitForHook(page);
  const files = await page.evaluate(() => (globalThis as unknown as { __starboardE2E: Hook }).__starboardE2E.files());
  if (!files) throw new Error("no memory host is open");
  return files;
}

/** coreFormat is core.format of files, run by the app's own core. */
export async function coreFormat(page: Page, files: Files): Promise<Record<string, string>> {
  await waitForHook(page);
  return page.evaluate((f) => (globalThis as unknown as { __starboardE2E: Hook }).__starboardE2E.format(f), files);
}

/** changedPaths lists the paths whose text differs between before and after, or that only one holds. */
export function changedPaths(before: Files, after: Files): string[] {
  const all = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...all].filter((p) => before[p] !== after[p]).sort();
}
