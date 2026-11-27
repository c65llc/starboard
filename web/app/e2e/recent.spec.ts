// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Recent on Chromium. Playwright cannot drive the native folder picker, so
// a real directory handle (from the origin-private file system) is put in
// IndexedDB as Recent stores it, and the permission answers are stubbed on
// FileSystemHandle's prototype to play a reload's "prompt", a "denied"
// site setting, and the user's answer to the request.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "./test.ts";

test.skip(({ browserName }) => browserName !== "chromium", "Recent needs the File System Access API");

type Permission = "granted" | "prompt" | "denied";

async function withRecent(page: Page, query: Permission, request: Permission): Promise<void> {
  await page.addInitScript(
    ([q, r]) => {
      const proto = (globalThis as unknown as { FileSystemHandle: { prototype: Record<string, unknown> } })
        .FileSystemHandle.prototype;
      proto["queryPermission"] = () => Promise.resolve(q);
      proto["requestPermission"] = () => Promise.resolve(r);
    },
    [query, request] as const,
  );
  await page.goto("./");
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("travel-app", { create: true });
    const record = { id: "r1", name: "travel-app", handle: dir, openedAt: Date.now() };
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("keyval-store");
      open.onupgradeneeded = () => open.result.createObjectStore("keyval");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("keyval", "readwrite");
        tx.objectStore("keyval").put([record], "starboard.recent");
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

test("a remembered folder needing permission has its own Reconnect folder button", async ({ page }) => {
  await withRecent(page, "prompt", "denied");
  const recent = page.getByRole("region", { name: "Recent" });
  await expect(recent).toContainText("travel-app");
  const reconnect = recent.getByRole("button", { name: "Reconnect folder travel-app" });
  await expect(reconnect).toBeVisible();
  await expect(recent.getByRole("button", { name: /^Open travel-app/ })).toHaveCount(0);
  await expectNoAxeViolations(page);

  // Refused: say so, and show Recent as it now stands.
  await reconnect.click();
  await expect(page.getByRole("alert")).toContainText("Reconnect folder");
  await expect(recent.getByRole("button", { name: "Reconnect folder travel-app" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("a denied folder explains how to allow it instead of offering a button", async ({ page }) => {
  await withRecent(page, "denied", "denied");
  const recent = page.getByRole("region", { name: "Recent" });
  await expect(recent).toContainText("travel-app");
  await expect(recent.getByRole("button")).toHaveCount(0);
  await expect(recent).toContainText("site settings");
  await expectNoAxeViolations(page);
});

test("a granted folder opens with its Open button", async ({ page }) => {
  await withRecent(page, "granted", "granted");
  const recent = page.getByRole("region", { name: "Recent" });
  await expect(recent.getByRole("button", { name: "Open travel-app" })).toBeVisible();
  await expectNoAxeViolations(page);
});
