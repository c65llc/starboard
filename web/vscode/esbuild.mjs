// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Bundles the extension into dist/: extension.js (the entry point VS Code
// loads), node-worker.js (@c65llc/starboard-core/node's worker thread), and
// starboard.wasm with Go's wasm_exec.js, copied from web/core/dist where
// `make wasm` puts them; and dist-embed/, the panel's page, which is web/app's
// embed build (vite.config.embed.ts), run here with web/app's own Vite and
// copied in. With --tests it also bundles the integration tests into
// dist-test/.

import { copyFileSync, cpSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

import { build } from "esbuild";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const coreDist = here("../core/dist/");

/** @type {import("esbuild").BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  // VS Code 1.105's extension host runs Node 22.
  target: "node22",
  // Bundle @c65llc/starboard-core from its TypeScript sources.
  conditions: ["source"],
  external: ["vscode"],
  logLevel: "warning",
  // @c65llc/starboard-core/node finds its worker and starboard.wasm beside
  // its own module (import.meta.url). In this CommonJS bundle that module
  // is the bundle's own file, in dist/, beside node-worker.js and the wasm.
  define: { "import.meta.url": "__starboardModuleUrl" },
  banner: { js: 'const __starboardModuleUrl = require("node:url").pathToFileURL(__filename).href;' },
};

rmSync(here("dist"), { recursive: true, force: true });
await build({
  ...common,
  entryPoints: { extension: here("src/extension.ts"), "node-worker": here("../core/src/node-worker.ts") },
  outdir: here("dist"),
});
for (const name of ["starboard.wasm", "wasm_exec.js"]) {
  if (!existsSync(coreDist + name)) throw new Error(`web/core/dist/${name} is missing: run make wasm first`);
  copyFileSync(coreDist + name, here(`dist/${name}`));
}

// web/app's Vite, resolved from web/app, so the extension takes no
// dependency of its own on it.
const vite = await import(pathToFileURL(createRequire(here("../app/package.json")).resolve("vite")).href);
await vite.build({ configFile: here("../app/vite.config.embed.ts"), root: here("../app"), logLevel: "warn" });
rmSync(here("dist-embed"), { recursive: true, force: true });
cpSync(here("../app/dist-embed"), here("dist-embed"), { recursive: true });

if (process.argv.includes("--tests")) {
  rmSync(here("dist-test"), { recursive: true, force: true });
  await build({
    ...common,
    entryPoints: [here("test/integration/runTest.ts"), here("test/integration/suite/*.ts")],
    outbase: here("test/integration"),
    outdir: here("dist-test"),
    external: ["vscode", "mocha", "@vscode/test-electron"],
  });
}
