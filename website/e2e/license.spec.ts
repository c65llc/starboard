// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The license page shows the LICENSE file in a code block. That block must
// wrap, never scroll: a <pre> that scrolls sideways is a scrollable region,
// and axe's scrollable-region-focusable rule fails it unless the region is
// keyboard-focusable. Whether the block overflowed used to depend on when
// the web font loaded, so e2e/a11y.spec.ts failed on /agpl/ intermittently
// (issue #4). Checking the widths at a phone width, where an unwrapped
// licence line is always wider than the column, makes the failure certain
// rather than a race.

import { expect, test } from "@playwright/test";

for (const width of [320, 375, 1440]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`the license text wraps instead of scrolling at ${width}px (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/agpl/");
      await page.evaluate(() => document.fonts.ready);
      const block = page.locator("pre", { hasText: "GNU AFFERO GENERAL PUBLIC LICENSE" });
      await expect(block).toHaveCount(1);
      const overflow = await block.evaluate((pre) => pre.scrollWidth - pre.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
