// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The desktop build: the web app with src/desktop.tsx as its entry, into
// dist-desktop/, which web/desktop's tauri.conf.json names as frontendDist
// and Tauri embeds in the app. It is a build of its own, so the PWA's
// bundle is untouched. index.html is the PWA's, its module script swapped
// for desktop.tsx's; the page is served from / with no CSP meta tag (the
// policy is tauri.conf.json's, which Tauri sends with the page), no web
// app manifest and no service worker: virtual:pwa-register is a stub, as
// the app is already local and never offers an update. Core runs in its
// worker from core/, as in the browser.

import { defineConfig } from "vite";
import type { Plugin } from "vite";

import { appVersion, coreAssets } from "./vite.config.ts";

const PWA_STUB = "\0starboard-desktop-pwa-register";
const BROWSER_ENTRY = '<script type="module" src="/src/main.tsx"></script>';
const DESKTOP_ENTRY = '<script type="module" src="/src/desktop.tsx"></script>';

/** desktopEntry makes desktop.tsx the page's script, and the service worker's registration a stub. */
function desktopEntry(): Plugin {
  return {
    name: "starboard-desktop-entry",
    enforce: "pre",
    resolveId(source) {
      return source === "virtual:pwa-register" ? PWA_STUB : null;
    },
    load(id) {
      // No service worker in the desktop app, so there is never an update to offer.
      return id === PWA_STUB ? "export function registerSW() { return () => Promise.resolve(); }\n" : null;
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (!html.includes(BROWSER_ENTRY)) throw new Error(`index.html no longer loads the app with ${BROWSER_ENTRY}`);
        return html.replace(BROWSER_ENTRY, DESKTOP_ENTRY);
      },
    },
  };
}

export default defineConfig({
  base: "/",
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  worker: { format: "es" },
  plugins: [desktopEntry(), coreAssets()],
  build: {
    target: "es2022",
    outDir: "dist-desktop",
    emptyOutDir: true,
    // No data: URLs for fonts (font-src 'self').
    assetsInlineLimit: 0,
    // ELK and Mermaid's diagram chunks are large and load only when drawn.
    chunkSizeWarningLimit: 2048,
  },
});
