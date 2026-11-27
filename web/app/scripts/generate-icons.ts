// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Renders the PWA's PNG icons from docs/brand/starboard-mark.svg with
// Playwright's Chromium, and copies the brand SVGs into public/. The output
// is committed; run `pnpm icons` again only when the brand mark changes.

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const brand = new URL("../../../docs/brand/", import.meta.url);
const pub = new URL("../public/", import.meta.url);
const icons = new URL("icons/", pub);

copyFileSync(new URL("starboard-mark.svg", brand), new URL("starboard-mark.svg", pub));
copyFileSync(new URL("starboard-favicon.svg", brand), new URL("favicon.svg", pub));
mkdirSync(icons, { recursive: true });

const mark = readFileSync(new URL("starboard-mark.svg", brand), "utf8");
const midnight = "#101E30";

// Each icon: its size, and how much of it the mark fills. Maskable and
// Apple icons are full-bleed Midnight with the mark inside the safe zone.
const targets: { file: string; size: number; fill: number; bleed: boolean }[] = [
  { file: "icon-192.png", size: 192, fill: 1, bleed: false },
  { file: "icon-512.png", size: 512, fill: 1, bleed: false },
  { file: "icon-maskable-512.png", size: 512, fill: 0.72, bleed: true },
  { file: "apple-touch-icon.png", size: 180, fill: 0.86, bleed: true },
];

const browser = await chromium.launch();
try {
  for (const t of targets) {
    const page = await browser.newPage({ viewport: { width: t.size, height: t.size } });
    const inner = Math.round(t.size * t.fill);
    await page.setContent(
      `<html><body style="margin:0;display:grid;place-items:center;width:${t.size}px;height:${t.size}px;` +
        `background:${t.bleed ? midnight : "transparent"}">` +
        `<div style="width:${inner}px;height:${inner}px">${mark.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div>` +
        `</body></html>`,
    );
    await page.screenshot({ path: fileURLToPath(new URL(t.file, icons)), omitBackground: !t.bleed });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("wrote", targets.map((t) => `public/icons/${t.file}`).join(", "));
