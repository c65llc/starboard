// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The e2e tests run against `vite preview` of the production build (run
// `pnpm build` first), served under /app/ as it will be deployed, with the
// build's Content-Security-Policy meta tag in force. Chromium edits in
// place; WebKit is the view-only path. Firefox joins in Task 9.

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
  ],
  webServer: {
    command: `pnpm exec vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/app/`,
    reuseExistingServer: !process.env["CI"],
  },
});
