// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The PWA, served from /app/. Preact's JSX is compiled by Vite itself
// (tsconfig's jsxImportSource), so no Preact plugin is needed. The build
// adds the Content-Security-Policy the deployment sends (Plan 4) as a meta
// tag, and `vite preview` also sends it as a header, as the deployment
// will: a meta tag does not reach workers, so only the header puts the
// core's and ELK's workers under it in the e2e tests.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { defineConfig } from "vite";
import type { Plugin, Rollup } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const base = "/app/";

// The version the header shows, the same one the website shows
// (website/scripts/version.mjs): STARBOARD_VERSION, which the site and
// publish workflows set to the release tag; else the newest stable release
// tag reachable from HEAD; else "dev". Never package.json's version, which
// no release bumps.
const RELEASE = /^v\d+\.\d+\.\d+$/;
function appVersion(): string {
  const env = process.env.STARBOARD_VERSION?.trim();
  if (env) {
    if (!RELEASE.test(env) && env !== "dev") throw new Error(`STARBOARD_VERSION must be vX.Y.Z or dev, got ${env}`);
    return env;
  }
  try {
    const tag = execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*", "--exclude", "*-*"], {
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (RELEASE.test(tag)) return tag;
  } catch {
    // No tag reachable (a shallow clone, or a fork without tags).
  }
  return "dev";
}

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
    coreAssets(),
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
        manifestTransforms: [
          (entries) => ({ manifest: entries.filter((e) => !deferredChunks.has(e.url)), warnings: [] }),
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith(`${base}assets/`) && url.pathname.endsWith(".js"),
            handler: "CacheFirst",
            options: { cacheName: "starboard-diagram-chunks", expiration: { maxEntries: 300 } },
          },
        ],
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
});
