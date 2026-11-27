// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The docs sidebar's generated groups: Blog lists every post under
// src/content/docs/blog/ (scripts/blog-sidebar.mjs), and Community the pages
// sync-content.sh makes from CONTRIBUTING.md, SECURITY.md and CODE_OF_CONDUCT.md.

import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { blogPosts } from "../scripts/blog-sidebar.mjs";

const blogDir = fileURLToPath(new URL("../src/content/docs/blog/", import.meta.url));

/** The hrefs of the links in the sidebar group with this label. */
async function groupLinks(page: import("@playwright/test").Page, label: string): Promise<string[]> {
  const group = page.locator("#starlight__sidebar details").filter({ has: page.locator("summary", { hasText: new RegExp(`^\\s*${label}\\s*$`) }) });
  await expect(group).toHaveCount(1);
  return group.getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
}

test("the Blog group links every published post in the blog directory, newest first", async ({ page }) => {
  await page.goto("/getting-started/install/");
  // The generator's own rule (drafts left out, newest first), unit-tested in
  // scripts/blog-sidebar.test.mjs; here, that the built sidebar shows it.
  const posts = blogPosts(blogDir).map((p: { slug: string }) => `/blog/${p.slug}/`);
  expect(posts.length).toBeGreaterThan(0);
  expect(await groupLinks(page, "Blog")).toEqual(["/blog/", ...posts]);
});

test("the Community group links the contributing, security and code of conduct pages", async ({ page }) => {
  await page.goto("/getting-started/install/");
  expect(await groupLinks(page, "Community")).toEqual(["/contributing/", "/security/", "/code-of-conduct/"]);
  await page.goto("/security/");
  await expect(page.locator("h1")).toHaveText("Security Policy");
  await expect(page.getByRole("link", { name: "Edit page" })).toHaveAttribute("href", "https://github.com/c65llc/starboard/edit/main/SECURITY.md");
});
