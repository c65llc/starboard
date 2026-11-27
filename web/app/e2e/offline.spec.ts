// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Works offline: after one load the service worker holds the app, the
// WebAssembly core and the example, so with the network gone a reload still
// shows the app, and the example project opens and lints clean.

import { expect, test } from "@playwright/test";

import { openExample } from "./helpers.ts";

test("after one load, the app reloads and lints the example with the network off", async ({ page, context }) => {
  await page.goto("./");
  // The first visit installs the worker (precaching everything); ready
  // resolves once it is active. The page it installed from is not yet
  // controlled, so one reload brings it under the worker.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Open a Starboard project");
  await openExample(page);
  await expect(page.getByRole("main")).toContainText("trip.timeline");
});
