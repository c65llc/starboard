// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The PWA at /app/ inside the site: it loads under the site's headers, its
// service worker is scoped to /app/ and nothing else, a new deploy of it
// shows the "Update available" prompt, and the site's own pages run under
// their hash-based CSP without a single violation.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Collects the page's CSP violations (console errors and securitypolicyviolation events). */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /Content Security Policy|Content-Security-Policy/i.test(msg.text())) violations.push(msg.text());
  });
  return violations;
}

test("/app/ loads the PWA under the site's headers, its worker scoped to /app/", async ({ page }) => {
  const violations = watchCsp(page);
  const response = await page.goto("/app/");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("worker-src 'self'");
  expect(csp).toContain("'wasm-unsafe-eval'");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Open a Starboard project");

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(scope).pathname).toBe("/app/");
  const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname));
  expect(scopes).toEqual(["/app/"]);
  expect(violations).toEqual([]);
});

test("the PWA's WebAssembly core is served as application/wasm", async ({ request }) => {
  const response = await request.get("/app/core/starboard.wasm");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/wasm");
});

test("a docs page registers no service worker and is not controlled by one", async ({ page }) => {
  await page.goto("/getting-started/install/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Install");
  // Give any registration a chance to happen before looking.
  await page.waitForLoadState("networkidle");
  const state = await page.evaluate(async () => ({
    registrations: (await navigator.serviceWorker.getRegistrations()).length,
    controlled: navigator.serviceWorker.controller !== null,
  }));
  expect(state).toEqual({ registrations: 0, controlled: false });
});

test("the PWA's worker does not control the site's pages after /app/ was opened", async ({ page }) => {
  await page.goto("/app/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.goto("/getting-started/install/");
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  expect(controlled).toBe(false);
});

test("a new deploy of the PWA's service worker shows the Update available prompt", async ({ page, request }) => {
  await page.goto("/app/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.getByText("Update available")).toHaveCount(0);

  // The server now sends a changed sw.js, as after a deploy; the app's
  // update check finds it, the new worker installs and waits (registerType
  // "prompt"), and the toast asks before reloading.
  expect((await request.get("/__test/bump-sw")).status()).toBe(204);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
  await expect(page.getByText("Update available")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
});

for (const path of ["/", "/getting-started/install/", "/rules/file-missing/", "/examples/travel-app/", "/blog/introducing-starboard/"]) {
  test(`${path} runs under the CSP with no violation`, async ({ page }) => {
    const violations = watchCsp(page);
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-security-policy"] ?? "").toContain("default-src 'self'");
    await page.waitForLoadState("networkidle");
    expect(violations).toEqual([]);
  });
}

test("docs search (Pagefind) works under the CSP", async ({ page }) => {
  const violations = watchCsp(page);
  await page.goto("/getting-started/install/");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("dialog", { name: "Search" }).getByRole("textbox", { name: "Search" }).fill("file-missing");
  await expect(page.locator(".pagefind-ui__result").first()).toBeVisible();
  expect(violations).toEqual([]);
});
