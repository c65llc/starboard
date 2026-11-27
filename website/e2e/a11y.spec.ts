// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// WCAG 2.2 AA: axe finds no violation on the landing page, a docs page, a
// rule page, an example gallery and the launch post, in the light and the
// dark colour scheme (the docs follow the visitor's preference).

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/", "/getting-started/install/", "/rules/file-missing/", "/examples/travel-app/", "/blog/introducing-starboard/", "/agpl/"];
// Starlight's search button is left out, and only it: axe's experimental
// label-content-name-mismatch rule flags it because its name, "Search", the
// word it shows, does not also hold the ⌘K shortcut hint beside it. The
// button is Starlight's own component.
const STARLIGHT_SEARCH = "site-search button[data-open-modal]";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} scheme`, () => {
    test.use({ colorScheme });
    for (const path of PAGES) {
      test(`${path} has no axe violations`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        const results = await new AxeBuilder({ page }).withTags(TAGS).exclude(STARLIGHT_SEARCH).analyze();
        const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
        expect(summary).toEqual([]);
      });
    }
  });
}
