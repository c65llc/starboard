// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The site's e2e tests run against the production build (run `pnpm build`
// first) served by e2e/server.mjs, which sends the headers dist/_headers
// gives, as Cloudflare Pages will: the Content-Security-Policy included.
// Chromium only: the PWA's own suite (web/app) covers WebKit and Firefox.

import { defineConfig, devices } from "@playwright/test";

const port = 4321;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env["CI"],
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}/`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node e2e/server.mjs --port ${port}`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env["CI"],
  },
});
