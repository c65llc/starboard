// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The PWA, served from /app/. Preact's JSX is compiled by Vite itself
// (tsconfig's jsxImportSource), so no Preact plugin is needed. The build
// adds the Content-Security-Policy the deployment sends (Plan 4) as a meta
// tag, and `vite preview` also sends it as a header, as the deployment
// will: a meta tag does not reach workers, so only the header puts the
// core's and ELK's workers under it in the e2e tests.

import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { defineConfig } from "vite";
import type { Plugin, Rollup } from "vite";
import { VitePWA } from "vite-plugin-pwa";

import { appVersion, coreAssets } from "./vite.shared.ts";

const base = "/app/";

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

/** The Mermaid chunks a flowchart needs besides its core: the diagram and its layout. */
const FLOWCHART_CHUNKS = /^(flowDiagram|dagre)-/;

/** Chunks to leave out of the precache: Mermaid's other diagram types and layouts. */
const deferredChunks = new Set<string>();

/**
 * deferMermaid works out which chunks only Mermaid's other diagram types
 * need, so the service worker precaches the app, the core, Mermaid and its
 * flowchart (every flow's diagram works offline) and caches the rest on
 * first use. A chunk stays in the precache if it is reachable from the app
 * by static imports, by the app's own dynamic imports, or from the
 * flowchart chunks; a dynamic import Mermaid itself makes (from a chunk
 * holding Mermaid, of a library chunk) is followed only for the flowchart.
 */
function deferMermaid(): Plugin {
  return {
    name: "starboard-defer-mermaid",
    apply: "build",
    generateBundle(_, bundle: Rollup.OutputBundle) {
      const chunks = new Map<string, Rollup.OutputChunk>();
      for (const item of Object.values(bundle)) if (item.type === "chunk") chunks.set(item.fileName, item);
      const keep = new Set<string>();
      const visit = (file: string) => {
        const c = chunks.get(file);
        if (!c || keep.has(file)) return;
        keep.add(file);
        c.imports.forEach(visit);
        const fromMermaid = c.moduleIds.some((id) => id.includes("/node_modules/mermaid/"));
        for (const d of c.dynamicImports) {
          const target = chunks.get(d);
          const library = target?.facadeModuleId?.includes("/node_modules/") ?? false;
          if (!(fromMermaid && library) || FLOWCHART_CHUNKS.test(target?.name ?? "")) visit(d);
        }
      };
      for (const c of chunks.values()) if (c.isEntry || FLOWCHART_CHUNKS.test(c.name)) visit(c.fileName);
      deferredChunks.clear();
      for (const file of chunks.keys()) if (!keep.has(file)) deferredChunks.add(file);
    },
  };
}

/** One module of a chunk as chunkModules records it. */
export interface ChunkModule {
  /** The module's id relative to web/app, e.g. "src/store.ts" or "../node_modules/.pnpm/…". */
  id: string;
  /** The gzip size of the module's code as rendered into the chunk. */
  gzip: number;
}

/**
 * chunkModules writes dist/.vite/chunk-modules.json: for each JS chunk, the
 * modules in it and the gzip size of each one's rendered code, so
 * test/unit/budget.test.ts can tell app code from a library's by module id
 * (the Vite manifest names only a chunk's entry module). Ids are relative,
 * so no local path ships. Each module gzipped alone overstates its share
 * slightly, which errs toward the budget.
 */
function chunkModules(): Plugin {
  const root = fileURLToPath(new URL(".", import.meta.url));
  return {
    name: "starboard-chunk-modules",
    apply: "build",
    generateBundle(_, bundle: Rollup.OutputBundle) {
      const out: Record<string, ChunkModule[]> = {};
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        out[item.fileName] = Object.entries(item.modules)
          .filter(([, m]) => m.code)
          .map(([id, m]) => ({ id: relative(root, id.replace(/^\0/, "")), gzip: gzipSync(m.code ?? "", { level: 9 }).length }));
      }
      this.emitFile({ type: "asset", fileName: ".vite/chunk-modules.json", source: JSON.stringify(out) });
    },
  };
}

export default defineConfig({
  base,
  // A stable release tag or dev: a pre-release STARBOARD_VERSION is refused (vite.shared.ts).
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  // examples/travel-app is bundled from outside web/app.
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  preview: { headers: { "Content-Security-Policy": CSP } },
  worker: { format: "es" },
  // assetsInlineLimit 0: no asset becomes a data: URL, which the CSP's
  // font-src 'self' would refuse. The manifest (dist/.vite/manifest.json)
  // is what test/unit/budget.test.ts measures the app shell by.
  build: { target: "es2022", sourcemap: true, assetsInlineLimit: 0, manifest: true },
  plugins: [
    cspMeta(),
    coreAssets(base),
    deferMermaid(),
    chunkModules(),
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
        // Mermaid's other diagram types are cached when first drawn (deferMermaid).
        // The page is precached as the URL the server answers, ./ (that is
        // /app/), not index.html: the site redirects /app/index.html to
        // /app/, and a redirect drops the precache's cache-busting
        // __WB_REVISION__ query, so the entry could hold another build's
        // page (issue #18).
        manifestTransforms: [
          (entries) => ({ manifest: entries.filter((e) => !deferredChunks.has(e.url)), warnings: [] }),
          (entries) => ({ manifest: entries.map((e) => (e.url === "index.html" ? { ...e, url: "./" } : e)), warnings: [] }),
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith(`${base}assets/`) && url.pathname.endsWith(".js"),
            handler: "CacheFirst",
            options: { cacheName: "starboard-diagram-chunks", expiration: { maxEntries: 300 } },
          },
        ],
        navigateFallback: base,
      },
    }),
  ],
});
