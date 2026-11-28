// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The embed build: src/embed.tsx, the Screens, Flows and App map views for
// the VS Code extension's panel, into dist-embed/ as embed.js and
// embed.css (fixed names, which the panel's page links) with the lazy
// chunks and fonts under assets/. It is a build of its own, so the PWA's
// bundle is untouched. Three modules are swapped in: src/core.ts becomes
// src/core-proxy.ts (the extension's core, over postMessage, so no wasm
// and no core worker ship here), src/map/engine.ts becomes
// src/map/engine-embed.ts (ELK on the page's own thread: the panel starts
// no worker), and virtual:pwa-register a stub (a webview has no service
// worker). web/vscode's esbuild.mjs runs this build and copies dist-embed/
// into the extension.

import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import type { Plugin } from "vite";

const src = (path: string) => fileURLToPath(new URL(`src/${path}`, import.meta.url));

const PWA_STUB = "\0starboard-embed-pwa-register";

/** embedModules swaps the PWA's core, map engine and service-worker modules for the embed's. */
function embedModules(): Plugin {
  const swaps = new Map([
    [src("core.ts"), src("core-proxy.ts")],
    [src("map/engine.ts"), src("map/engine-embed.ts")],
  ]);
  return {
    name: "starboard-embed-modules",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source === "virtual:pwa-register") return PWA_STUB;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return (resolved && swaps.get(resolved.id)) ?? null;
    },
    load(id) {
      // A webview has no service worker, so there is never an update to offer.
      return id === PWA_STUB ? "export function registerSW() { return () => Promise.resolve(); }\n" : null;
    },
  };
}

export default defineConfig({
  base: "./",
  // The panel shows no version; the PWA's header is not in the embed.
  define: { __APP_VERSION__: JSON.stringify("dev") },
  publicDir: false,
  plugins: [embedModules()],
  build: {
    target: "es2022",
    outDir: "dist-embed",
    emptyOutDir: true,
    // No data: URLs for fonts, and no modulepreload polyfill, which would fetch.
    assetsInlineLimit: 0,
    modulePreload: false,
    // One stylesheet, embed.css, for the views and their lazy chunks alike.
    cssCodeSplit: false,
    // ELK and Mermaid's diagram chunks are large and load only when drawn.
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      input: src("embed.tsx"),
      output: {
        entryFileNames: "embed.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (info) => (info.names.some((n) => n.endsWith(".css")) ? "embed.css" : "assets/[name]-[hash][extname]"),
      },
    },
  },
});
