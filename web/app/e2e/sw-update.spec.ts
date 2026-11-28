// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Issue #18: an update left the app blank. The precache held the page under
// index.html, which the site redirects to /app/ (dropping the cache-busting
// query), and it ended up holding a page from another build whose module
// script the server no longer had. The page is now precached as /app/
// itself, and public/recover.js recovers from a precached page whose
// script is gone.

import type { Page } from "@playwright/test";

import { expect, test } from "./test.ts";

const PRECACHE = /^workbox-precache/;

/** Loads the app and reloads it once the service worker controls it. */
async function installWorker(page: Page): Promise<void> {
  await page.goto("./");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** The paths of every entry in the precache. */
function precachedPaths(page: Page): Promise<string[]> {
  return page.evaluate(async (source) => {
    const name = (await caches.keys()).find((k) => new RegExp(source).test(k));
    if (!name) return [];
    const keys = await (await caches.open(name)).keys();
    return keys.map((r) => new URL(r.url).pathname);
  }, PRECACHE.source);
}

test("the page is precached as /app/, the URL the server answers, not index.html", async ({ page }) => {
  await installWorker(page);
  const paths = await precachedPaths(page);
  expect(paths).toContain("/app/");
  expect(paths).not.toContain("/app/index.html");
});

test("a precached page whose script no longer exists recovers instead of staying blank", async ({ page }) => {
  await installWorker(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Open a Starboard project");

  // Make the precache hold what #18 found: a page naming another build's
  // entry script, which the server does not have.
  const replaced = await page.evaluate(async (source) => {
    const name = (await caches.keys()).find((k) => new RegExp(source).test(k));
    if (!name) return false;
    const cache = await caches.open(name);
    const key = (await cache.keys()).find((r) => new URL(r.url).pathname === "/app/");
    const res = key && (await cache.match(key));
    if (!key || !res) return false;
    const html = await res.text();
    const stale = html.replace(/assets\/index-[\w-]+\.js/, "assets/index-gone.js");
    if (stale === html) return false;
    await cache.put(key, new Response(stale, { headers: { "Content-Type": "text/html" } }));
    return true;
  }, PRECACHE.source);
  expect(replaced).toBe(true);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Open a Starboard project");
  const entry = await page.evaluate(() => [...document.scripts].map((s) => s.src).find((src) => /\/assets\/index-/.test(src)));
  expect(entry).not.toContain("index-gone");
});
