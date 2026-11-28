// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The PWA at /app/ inside the site: it loads under the site's headers, its
// service worker is scoped to /app/ and nothing else, a new deploy of it
// shows the "Update available" prompt, and the site's own pages run under
// their hash-based CSP without a single violation.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Watches the page for CSP violations: console errors that name the policy,
 * and securitypolicyviolation events, which an init script records in the
 * page (it runs before any of the page's own scripts, in every document).
 * Call the returned function once the page has settled; it returns every
 * violation seen so far in the current document plus all console reports.
 */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  const consoleReports: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /Content Security Policy|Content-Security-Policy/i.test(msg.text())) consoleReports.push(msg.text());
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = seen;
    document.addEventListener("securitypolicyviolation", (e) => {
      seen.push(`${e.effectiveDirective} blocked ${e.blockedURI || "inline"} (${e.sourceFile}:${e.lineNumber})`);
    });
  });
  return async () => {
    const events = await page.evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? []);
    return [...consoleReports, ...events];
  };
}

test("/app/ loads the PWA under the site's headers, its worker scoped to /app/", async ({ page }) => {
  const violations = await watchCsp(page);
  const response = await page.goto("/app/");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("worker-src 'self'");
  expect(csp).toContain("'wasm-unsafe-eval'");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Open a Starboard project");

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(scope).pathname).toBe("/app/");
  const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname));
  expect(scopes).toEqual(["/app/"]);
  expect(await violations()).toEqual([]);
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

// The watcher itself: an inline script the CSP has no hash for is reported.
test("the CSP watcher sees a violation", async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto("/");
  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = "window.__notAllowed = 1;";
    document.head.append(s);
  });
  await expect.poll(async () => (await violations()).some((v) => v.startsWith("script-src"))).toBe(true);
});

for (const path of ["/", "/getting-started/install/", "/rules/file-missing/", "/examples/travel-app/", "/blog/introducing-starboard/"]) {
  test(`${path} runs under the CSP with no violation`, async ({ page }) => {
    const violations = await watchCsp(page);
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-security-policy"] ?? "").toContain("default-src 'self'");
    await page.waitForLoadState("networkidle");
    expect(await violations()).toEqual([]);
  });
}

test("docs search (Pagefind) works under the CSP", async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto("/getting-started/install/");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("dialog", { name: "Search" }).getByRole("textbox", { name: "Search" }).fill("file-missing");
  await expect(page.locator(".pagefind-ui__result").first()).toBeVisible();
  expect(await violations()).toEqual([]);
});

// Cloudflare Web Analytics: Cloudflare adds its beacon to HTML at the edge,
// so the local server never sends it. These tests add it as Cloudflare does
// and stand in for Cloudflare's two origins.
const BEACON = "https://static.cloudflareinsights.com/beacon.min.js";
const REPORTS = "https://cloudflareinsights.com/cdn-cgi/rum";

/** Adds Cloudflare's beacon tag to every HTML document, and stubs the beacon and its reports. */
async function injectBeacon(page: Page): Promise<void> {
  await page.route(BEACON, (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `fetch(${JSON.stringify(REPORTS)}, { method: "POST", body: "{}" }).then(() => { window.__beaconReported = true; });`,
    }),
  );
  await page.route(REPORTS, (route) => route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.route(
    (url) => url.origin === new URL(page.url() || "http://localhost").origin || url.hostname === "localhost" || url.hostname === "127.0.0.1",
    async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const response = await route.fetch();
      const html = await response.text();
      const tag = `<script defer src="${BEACON}" data-cf-beacon='{"token":"test"}'></script>`;
      await route.fulfill({ response, body: html.replace("</body>", `${tag}</body>`) });
    },
  );
}

test("the site's pages allow Cloudflare Web Analytics' beacon and its reports", async ({ page }) => {
  const violations = await watchCsp(page);
  await injectBeacon(page);
  await page.goto("/getting-started/install/");
  await page.waitForFunction(() => (window as unknown as { __beaconReported?: boolean }).__beaconReported === true);
  expect(await violations()).toEqual([]);
});

test("/app/ asks Cloudflare not to add the beacon, and its policy blocks it if added anyway", async ({ page }) => {
  const response = await page.request.get("/app/");
  expect(response.headers()["cache-control"]).toContain("no-transform");

  const violations = await watchCsp(page);
  await injectBeacon(page);
  await page.goto("/app/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Open a Starboard project");
  await expect.poll(async () => (await violations()).some((v) => v.includes("cloudflareinsights"))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __beaconReported?: boolean }).__beaconReported)).toBeUndefined();
});
