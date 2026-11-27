// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The PWA, served from /app/. Preact's JSX is compiled by Vite itself
// (tsconfig's jsxImportSource), so no Preact plugin is needed. The build
// adds the Content-Security-Policy the deployment sends (Plan 4) as a meta
// tag, so `vite preview` and the e2e tests run under it too.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const base = "/app/";
const pkg = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as { version: string };

export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
].join("; ");

/** cspMeta puts the CSP first in <head> of the built page. */
function cspMeta(): Plugin {
  return {
    name: "starboard-csp-meta",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html) =>
        html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  };
}

/**
 * coreAssets serves and emits starboard.wasm and wasm_exec.js as
 * <base>core/…, side by side as @c65llc/starboard-core expects: wasm_exec.js
 * must sit beside the module, so neither is content-hashed (the service
 * worker's precache revisions version them instead).
 */
function coreAssets(): Plugin {
  const files: Record<string, string> = {
    "starboard.wasm": "application/wasm",
    "wasm_exec.js": "text/javascript",
  };
  const source = (name: string) => fileURLToPath(import.meta.resolve(`@c65llc/starboard-core/${name}`));
  return {
    name: "starboard-core-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.startsWith(`${base}core/`) ? req.url.slice(`${base}core/`.length).split("?")[0] : undefined;
        const type = name ? files[name] : undefined;
        if (!name || !type) return next();
        res.setHeader("Content-Type", type);
        res.end(readFileSync(source(name)));
      });
    },
    generateBundle() {
      for (const name of Object.keys(files)) {
        this.emitFile({ type: "asset", fileName: `core/${name}`, source: readFileSync(source(name)) });
      }
    },
  };
}

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // examples/travel-app is bundled from outside web/app.
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  worker: { format: "es" },
  // assetsInlineLimit 0: no asset becomes a data: URL, which the CSP's
  // font-src 'self' would refuse.
  build: { target: "es2022", sourcemap: true, assetsInlineLimit: 0 },
  plugins: [
    cspMeta(),
    coreAssets(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "starboard-mark.svg", "icons/*.png"],
      manifest: {
        name: "Starboard",
        short_name: "Starboard",
        description: "View and edit a product's screens and flows, kept as plain text in its repository.",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "#F6F6F3",
        theme_color: "#101E30",
        icons: [
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The app, the WebAssembly core, and the Latin fonts; other
        // scripts' font subsets load on demand from this origin.
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest,wasm}", "assets/*-latin-*.woff2"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
});
