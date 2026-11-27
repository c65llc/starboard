// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The size budgets (Global Constraints), measured on the production build
// in dist/: the app shell at most 250 kB gzip of JS, and starboard.wasm, at
// most 8 MB raw and 2 MB brotli. The shell is the JS every start loads: what
// the entry loads by static imports, plus the core's worker and
// wasm_exec.js and the service worker's registration (workbox-window), which
// load outside that graph. Mermaid, CodeMirror, ELK and the example load by
// the app's own dynamic imports, when a view needs them, so they are not the
// shell. starboard.wasm: at most
// 8 MB raw and 2 MB brotli. Without a build there is nothing to measure,
// so the test skips and says so; in CI (CI set) a missing build fails it,
// so the budget is never skipped there.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
const manifestPath = `${dist}.vite/manifest.json`;
const built = existsSync(manifestPath);

const SHELL_GZIP_LIMIT = 250_000;
const WASM_RAW_LIMIT = 8 * 1024 * 1024; // as web/core's own budget test reads 8 MB
const WASM_BROTLI_LIMIT = 2_000_000;

interface ManifestChunk {
  file: string;
  src?: string;
  name?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}
type Manifest = Record<string, ManifestChunk>;

/** shellFiles is every JS file the entries load by static imports, and no further. */
function shellFiles(manifest: Manifest): string[] {
  const seen = new Set<string>();
  const visit = (key: string) => {
    const chunk = manifest[key];
    if (!chunk || seen.has(key)) return;
    seen.add(key);
    chunk.imports?.forEach(visit);
  };
  for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) visit(key);
  return [...seen].map((k) => (manifest[k] as ManifestChunk).file).filter((f) => f.endsWith(".js"));
}

describe("shellFiles", () => {
  it("follows static imports from the entries and never a dynamic import", () => {
    const manifest: Manifest = {
      "index.html": { file: "assets/index.js", isEntry: true, imports: ["_a"], dynamicImports: ["mermaid"] },
      _a: { file: "assets/a.js", imports: ["_b"] },
      _b: { file: "assets/b.js", imports: ["_a"] },
      mermaid: { file: "assets/mermaid.js", isDynamicEntry: true, imports: ["_c"] },
      _c: { file: "assets/c.js" },
      "index.css": { file: "assets/index.css" },
    };
    expect(shellFiles(manifest).sort()).toEqual(["assets/a.js", "assets/b.js", "assets/index.js"]);
  });
});

if (!built && process.env["CI"]) {
  describe("size budget", () => {
    it("has a build to measure", () => {
      expect.fail(`no build at ${manifestPath}: CI must run \`pnpm build\` before the tests`);
    });
  });
} else if (!built) {
  console.warn(`size budget skipped: no build at ${manifestPath}; run \`pnpm build\` in web/app first`);
  describe.skip(`size budget: skipped, no build at ${manifestPath} (run \`pnpm build\` in web/app first)`, () => {
    it("measures nothing without a build", () => undefined);
  });
} else {
  describe("size budget", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

    it("the app shell without Mermaid is at most 250 kB of JS, gzipped", () => {
      const graph = shellFiles(manifest);
      expect(graph.length).toBeGreaterThan(0);
      const coreWorker = readdirSync(`${dist}assets`).filter((f) => /^worker-[\w-]+\.js$/.test(f));
      expect(coreWorker, "the core's worker chunk").toHaveLength(1);
      const registration = Object.values(manifest).filter((c) => c.src?.includes("/workbox-window/"));
      expect(registration, "workbox-window's chunk").toHaveLength(1);
      const files = [
        ...graph,
        ...coreWorker.map((f) => `assets/${f}`),
        "core/wasm_exec.js",
        ...registration.map((c) => c.file),
      ];
      const sizes = files.map((f) => [f, gzipSync(readFileSync(`${dist}${f}`), { level: 9 }).length] as const);
      const total = sizes.reduce((n, [, s]) => n + s, 0);
      // The shell must not have taken in a lazy library by a static import.
      for (const [file] of sizes) expect(file).not.toMatch(/mermaid|elk|codemirror/i);
      expect(total, `shell: ${sizes.map(([f, s]) => `${f} ${s}`).join(", ")}`).toBeLessThanOrEqual(SHELL_GZIP_LIMIT);
    });

    it("starboard.wasm is at most 8 MB raw and 2 MB with brotli", () => {
      const wasm = readFileSync(`${dist}core/starboard.wasm`);
      expect(wasm.length).toBeLessThanOrEqual(WASM_RAW_LIMIT);
      expect(brotliCompressSync(wasm).length).toBeLessThanOrEqual(WASM_BROTLI_LIMIT);
    }, 60_000); // brotli at its default quality takes several seconds on 7 MB
  });
}
