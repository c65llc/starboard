// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A guard on src/styles/starlight.css's colour tokens, as the browser
// resolves them, in both schemes: axe only checks the pairs the audited
// pages happen to render, so a token change that breaks a pair no page shows
// today would pass it. Normal text needs 4.5:1 (WCAG 1.4.3 AA).
//
// One pair is held to 4.1:1 instead: Deep teal (#087F70, the brand's accent
// text on light surfaces, docs/brand/README.md) on Starlight's light gray-6
// chrome is 4.12:1. Raising it to 4.5:1 would mean darkening the brand
// colour or lightening gray-6 to sea mist, erasing the chrome. AA allows 3:1
// for large text, and axe (e2e/a11y.spec.ts) finds no smaller accent text on
// gray-6 on the pages it audits. The floor is pinned just under today's
// ratio, so any change that lowers it fails here. Should axe flag the pair,
// darken the text there, not the brand colour.

import { expect, test } from "@playwright/test";

type Pair = [fg: string, bg: string, min: number];

const NORMAL = 4.5;
/** Deep teal on light gray-6: 4.12:1 today, and no lower. */
const TEAL_ON_GRAY_6 = 4.1;

const PAIRS: Record<"light" | "dark", Pair[]> = {
  light: [
    ["white", "black", NORMAL],
    ["gray-1", "black", NORMAL],
    ["gray-2", "black", NORMAL],
    ["gray-3", "black", NORMAL],
    ["gray-2", "gray-6", NORMAL],
    ["text-accent", "black", NORMAL],
    ["text-accent", "gray-7", NORMAL],
    ["text-accent", "gray-6", TEAL_ON_GRAY_6],
    ["accent-high", "accent-low", NORMAL],
    ["text-invert", "accent", NORMAL],
  ],
  dark: [
    ["white", "black", NORMAL],
    ["gray-1", "black", NORMAL],
    ["gray-2", "black", NORMAL],
    ["gray-3", "black", NORMAL],
    ["gray-2", "gray-6", NORMAL],
    ["text-accent", "black", NORMAL],
    ["text-accent", "gray-6", NORMAL],
    ["accent-high", "accent-low", NORMAL],
    ["text-invert", "accent", NORMAL],
  ],
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test("contrast() matches WCAG's reference values", () => {
  expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrast("#087f70", "#e6ecf0")).toBeCloseTo(4.12, 2);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the ${scheme} scheme's text pairs meet their contrast minimum`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/getting-started/install/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
    const names = [...new Set(PAIRS[scheme].flat().filter((v): v is string => typeof v === "string"))];
    const tokens: Record<string, string> = await page.evaluate((list) => {
      const style = getComputedStyle(document.documentElement);
      return Object.fromEntries(list.map((n) => [n, style.getPropertyValue(`--sl-color-${n}`).trim().toLowerCase()]));
    }, names);
    // The minified stylesheet may shorten #ffffff to #fff.
    for (const [n, v] of Object.entries(tokens)) if (/^#[0-9a-f]{3}$/.test(v)) tokens[n] = "#" + [...v.slice(1)].map((c) => c + c).join("");
    const failures: string[] = [];
    for (const [fg, bg, min] of PAIRS[scheme]) {
      for (const n of [fg, bg]) expect(tokens[n], `--sl-color-${n} is a #rrggbb colour`).toMatch(/^#[0-9a-f]{6}$/);
      const ratio = contrast(tokens[fg]!, tokens[bg]!);
      if (ratio < min) failures.push(`${fg} ${tokens[fg]} on ${bg} ${tokens[bg]}: ${ratio.toFixed(2)}:1, under ${min}:1`);
    }
    expect(failures).toEqual([]);
  });
}
