// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The size budgets (Global Constraints), measured on the production build
// in dist/. Without a build there is nothing to measure, so the test skips
// and says so; in CI (CI set) a missing build fails it, so the budgets are
// never skipped there.
//
// - The app shell: at most 250 kB gzip of JS. The shell is the JS every
//   start loads: what the entry loads by static imports, plus the core's
//   worker, wasm_exec.js and the service worker's registration
//   (workbox-window), which load outside that graph.
// - What loads later must not grow unseen: the dynamic imports in the app's
//   chunks are a fixed list, the app's own modules and the libraries alike
//   (a new lazy entry, or a new library loaded lazily, fails until it is
//   added here), and the
//   app-owned code in every chunk outside the shell, which is everything
//   but the libraries Mermaid, CodeMirror, ELK, dagre and DOMPurify and
//   their dependencies, is at most another 250 kB gzip. Modules are told
//   apart by id (dist/.vite/chunk-modules.json, written by vite.config.ts),
//   never by output file name.
// - starboard.wasm: at most 8 MB raw and 2 MB brotli.

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import type { ChunkModule } from "../../vite.config.ts";

const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
const manifestPath = `${dist}.vite/manifest.json`;
const modulesPath = `${dist}.vite/chunk-modules.json`;
const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const built = existsSync(manifestPath);

const SHELL_GZIP_LIMIT = 250_000;
const LAZY_APP_GZIP_LIMIT = 250_000;

/** The libraries that load lazily and are not the app's: their dependencies count with them. */
const LAZY_LIBRARIES = /^(mermaid|elkjs|dompurify|@codemirror\/.*|@lezer\/.*)$/;

/** Every dynamic import the app makes, by source path (a library by package name). */
const EXPECTED_LAZY_ENTRIES = [
  "src/e2e-hook.ts",
  "src/example.ts",
  "src/flows/codemirror.ts",
  "src/flows/mermaid.ts",
  "src/map/engine.ts",
  "src/screens/codemirror.ts",
  "src/views/AppMap.tsx",
  "workbox-window",
];
/**
 * The libraries the app's chunks import dynamically: Mermaid, loaded by
 * src/flows/mermaid.ts's chunk, and what Mermaid itself loads from there.
 */
const EXPECTED_LAZY_LIBRARIES = ["@mermaid-js/parser", "katex", "mermaid"];
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

/** packageOf is the npm package a module id is from, or null for the app's own code. */
function packageOf(id: string): string | null {
  const at = id.lastIndexOf("node_modules/");
  if (at < 0) return null;
  const [first = "", second = ""] = id.slice(at + "node_modules/".length).split("/");
  return first.startsWith("@") ? `${first}/${second}` : first;
}

/**
 * dependencyClosure is roots and every package they depend on, read from
 * package.json files: pnpm keeps a package's dependencies beside it in the
 * node_modules folder that holds it.
 */
function dependencyClosure(roots: string[]): Set<string> {
  const names = new Set<string>();
  const seen = new Set<string>();
  const visit = (dir: string) => {
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      return; // an optional dependency not installed here
    }
    if (seen.has(real)) return;
    seen.add(real);
    const pkg = JSON.parse(readFileSync(join(real, "package.json"), "utf8")) as {
      name: string;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    names.add(pkg.name);
    const modules = real.slice(0, real.lastIndexOf("node_modules/") + "node_modules/".length);
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) visit(join(modules, dep));
  };
  for (const root of roots) visit(join(appRoot, "node_modules", root));
  return names;
}

/**
 * lazyEntries is each dynamic import of the app's own chunks, as a source
 * path or a package name, a library's included; a library's own chunks'
 * imports are its own and left out.
 */
function lazyEntries(manifest: Manifest): string[] {
  const out = new Set<string>();
  for (const [key, chunk] of Object.entries(manifest)) {
    if (packageOf(key) !== null) continue; // a library's chunk: its imports are its own
    for (const target of chunk.dynamicImports ?? []) out.add(packageOf(target) ?? target);
  }
  return [...out].sort();
}

describe("module ids", () => {
  it("packageOf names the package, scoped or not, through pnpm's folders", () => {
    expect(packageOf("../node_modules/.pnpm/mermaid@12.3.0/node_modules/mermaid/dist/x.mjs")).toBe("mermaid");
    expect(packageOf("../node_modules/.pnpm/@codemirror+view@6/node_modules/@codemirror/view/dist/i.js")).toBe(
      "@codemirror/view",
    );
    expect(packageOf("src/store.ts")).toBeNull();
    expect(packageOf("../../examples/travel-app/starboard.yaml")).toBeNull();
  });

  it("lazyEntries lists the app's dynamic imports, of libraries too, and skips what libraries' chunks import", () => {
    const manifest: Manifest = {
      "index.html": {
        file: "a.js",
        isEntry: true,
        dynamicImports: ["src/x.ts", "../node_modules/.pnpm/w@1/node_modules/w/i.mjs", "../node_modules/m/i.js"],
      },
      "src/x.ts": { file: "x.js", dynamicImports: ["src/y.ts"] },
      "../node_modules/m/i.js": { file: "m.js", dynamicImports: ["../node_modules/m/z.js"] },
    };
    expect(lazyEntries(manifest)).toEqual(["m", "src/x.ts", "src/y.ts", "w"]);
  });
});

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
  // The skipped suite's title says why; no console warning on every local run.
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
      expect(total, `shell: ${sizes.map(([f, s]) => `${f} ${s}`).join(", ")}`).toBeLessThanOrEqual(SHELL_GZIP_LIMIT);
    });

    const appPackage = JSON.parse(readFileSync(`${appRoot}package.json`, "utf8")) as { dependencies: Record<string, string> };
    const libraries = dependencyClosure(Object.keys(appPackage.dependencies).filter((d) => LAZY_LIBRARIES.test(d)));

    it("the lazy libraries include Mermaid's, CodeMirror's and ELK's dependencies, and not the shell's", () => {
      for (const name of ["mermaid", "dagre-d3-es", "dompurify", "katex", "cytoscape", "elkjs", "@codemirror/view", "@lezer/lr"]) {
        expect(libraries, name).toContain(name);
      }
      for (const name of ["preact", "@preact/signals", "fflate", "idb-keyval", "workbox-window"]) {
        expect(libraries, name).not.toContain(name);
      }
    });

    it("the app's dynamic imports are the expected ones; a new one, of a library too, must be added to these lists", () => {
      expect(lazyEntries(manifest)).toEqual([...EXPECTED_LAZY_ENTRIES, ...EXPECTED_LAZY_LIBRARIES].sort());
    });

    it("the app-owned code outside the shell is at most 250 kB gzip", () => {
      expect(existsSync(modulesPath), `${modulesPath} (vite.config.ts chunkModules)`).toBe(true);
      const chunks = JSON.parse(readFileSync(modulesPath, "utf8")) as Record<string, ChunkModule[]>;
      // The shell, workbox-window included, is measured above.
      const registration = Object.values(manifest).filter((c) => c.src?.includes("/workbox-window/"));
      const shell = new Set([...shellFiles(manifest), ...registration.map((c) => c.file)]);
      const owned = new Map<string, number>();
      for (const [file, modules] of Object.entries(chunks)) {
        if (shell.has(file)) continue;
        for (const m of modules) {
          const pkg = packageOf(m.id);
          if (pkg !== null && libraries.has(pkg)) continue;
          owned.set(m.id, (owned.get(m.id) ?? 0) + m.gzip);
        }
      }
      // Something is measured: the app's lazy views are in there.
      expect([...owned.keys()]).toContain("src/views/AppMap.tsx");
      const total = [...owned.values()].reduce((n, g) => n + g, 0);
      const largest = [...owned].sort((a, b) => b[1] - a[1]).slice(0, 8);
      expect(total, `lazy app code; largest: ${largest.map(([id, g]) => `${id} ${g}`).join(", ")}`).toBeLessThanOrEqual(
        LAZY_APP_GZIP_LIMIT,
      );
    });

    it("starboard.wasm is at most 8 MB raw and 2 MB with brotli", () => {
      const wasm = readFileSync(`${dist}core/starboard.wasm`);
      expect(wasm.length).toBeLessThanOrEqual(WASM_RAW_LIMIT);
      expect(brotliCompressSync(wasm).length).toBeLessThanOrEqual(WASM_BROTLI_LIMIT);
    }, 60_000); // brotli at its default quality takes several seconds on 7 MB
  });
}
