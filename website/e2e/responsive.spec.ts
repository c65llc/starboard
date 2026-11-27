// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// docs/brand/marketing-site.md's responsive and interaction rules: no
// horizontal scrolling from 320 to 1440 px, one H1, a keyboard-operable
// menu on narrow screens, visible focus, and no smooth scrolling or
// animation when the visitor asks for reduced motion.

import { expect, test } from "@playwright/test";

const WIDTHS = [320, 375, 768, 1024, 1440];

for (const width of WIDTHS) {
  for (const path of ["/", "/getting-started/install/", "/examples/travel-app/"]) {
    test(`${path} has no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}

test("the landing page has one H1 and the brand's section anchors", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveCount(1);
  for (const id of ["features", "workflow", "platforms"]) await expect(page.locator(`#${id}`)).toHaveCount(1);
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
});

test("on a phone the navigation is a menu button that the keyboard opens and Escape closes", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Menu" });
  await expect(button).toHaveAttribute("aria-expanded", "false");
  const docs = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Docs" });
  await expect(docs).toBeHidden();
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(docs).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(docs).toBeHidden();
  await expect(button).toBeFocused();
});

test("keyboard focus is visible on the landing page's links and buttons", async ({ page }) => {
  await page.goto("/");
  // The first Tab reaches the skip link, the next ones the header.
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return "none";
      const s = getComputedStyle(el);
      return s.outlineStyle === "none" || s.outlineWidth === "0px" ? "none" : `${s.outlineStyle} ${s.outlineWidth}`;
    });
    expect(outline).not.toBe("none");
  }
});

test("keyboard focus on a link in a light section shows the Deep teal ring", async ({ page }) => {
  await page.goto("/");
  // One Tab puts the page in keyboard mode, so focusing a link then shows :focus-visible.
  await page.keyboard.press("Tab");
  const link = page.locator("#features").getByRole("link", { name: "file-missing" });
  await link.focus();
  const ring = await link.evaluate((el) => {
    const s = getComputedStyle(el);
    return { visible: el.matches(":focus-visible"), style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor };
  });
  expect(ring).toEqual({ visible: true, style: "solid", width: "3px", color: "rgb(8, 127, 112)" });
});

test("with reduced motion, nothing animates or scrolls smoothly", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const moving = await page.evaluate(() => {
    const found: string[] = [];
    if (getComputedStyle(document.documentElement).scrollBehavior === "smooth") found.push("html scroll-behavior");
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const s = getComputedStyle(el);
      const longest = (v: string) => Math.max(...v.split(",").map((t) => parseFloat(t) * (t.trim().endsWith("ms") ? 1 : 1000)));
      if (s.animationName !== "none" && longest(s.animationDuration) > 10) found.push(`${el.tagName}.${el.className} animation`);
      if (longest(s.transitionDuration) > 10) found.push(`${el.tagName}.${el.className} transition`);
    }
    return found;
  });
  expect(moving).toEqual([]);
});
