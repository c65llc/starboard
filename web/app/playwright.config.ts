// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The e2e tests run against `vite preview` of the production build (run
// `pnpm build` first), served under /app/ as it will be deployed, with the
// build's Content-Security-Policy meta tag in force. Chromium edits in
// place; WebKit and Firefox are the view-only path. WebKit runs every spec;
// Firefox runs the specs of what it is supported for (Global Constraints:
// read-only viewing): opening, the view-only download and offline, the
// app map's Find, Focus and zoom and pan, and the spec pinning
// e2e/test.ts's workaround for a Gecko crash under Playwright
// (e2e/firefox-aria-reflection.spec.ts).

import { defineConfig, devices } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env["CI"],
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}/app/`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testMatch: [
        "open.spec.ts",
        "readonly-download.spec.ts",
        "offline.spec.ts",
        "map-find.spec.ts",
        "map-focus.spec.ts",
        "map-zoom.spec.ts",
        "firefox-aria-reflection.spec.ts",
      ],
    },
  ],
  webServer: {
    command: `pnpm exec vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/app/`,
    reuseExistingServer: !process.env["CI"],
  },
});
