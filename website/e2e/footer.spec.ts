// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The C65 credit (src/components/C65Credit.astro): the landing page's
// footer and every Starlight page's footer link to https://c65llc.com with
// C65's mark, the mark hidden from assistive technology and the link named
// for C65 LLC. Its ember "65" is a non-text graphic, so it needs 3:1 against
// the ground behind it (WCAG 1.4.11) in both colour schemes.

import { expect, test, type Page } from "@playwright/test";

const PAGES = ["/", "/getting-started/install/", "/blog/introducing-starboard/"];

function luminance([r, g, b]: number[]): number {
  const [R, G, B] = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(a: number[], b: number[]): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** The ember fill and the first opaque background behind the credit, as RGB. */
async function emberAndGround(page: Page): Promise<{ ember: number[]; ground: number[] }> {
  return page.evaluate(() => {
    const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
    const link = document.querySelector('a.c65-credit[href="https://c65llc.com"]')!;
    const ember = rgb(getComputedStyle(link.querySelector(".c65-ember")!).fill);
    let el: Element | null = link;
    let ground = [255, 255, 255];
    while (el) {
      const bg = rgb(getComputedStyle(el).backgroundColor);
      if (bg.length === 3 || (bg.length === 4 && bg[3] === 1)) {
        ground = bg.slice(0, 3);
        break;
      }
      el = el.parentElement;
    }
    return { ember: ember.slice(0, 3), ground };
  });
}

for (const path of PAGES) {
  test(`${path} credits C65 LLC in its footer, with the mark`, async ({ page }) => {
    await page.goto(path);
    const credit = page.locator('footer a[href="https://c65llc.com"], .c65-footer a[href="https://c65llc.com"]');
    await expect(credit).toHaveCount(1);
    await expect(credit).toBeVisible();
    await expect(credit).toHaveAccessibleName(/C65 LLC/);
    await expect(credit).toHaveAttribute("rel", /noopener/);
    const mark = credit.locator("svg.c65-mark");
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute("aria-hidden", "true");
    await expect(mark).toHaveAttribute("viewBox", "89.8 156 280.4 148.4");
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`${path}'s C65 mark has 3:1 contrast in the ${colorScheme} scheme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto(path);
      const { ember, ground } = await emberAndGround(page);
      expect(contrast(ember, ground)).toBeGreaterThanOrEqual(3);
    });
  }
}
