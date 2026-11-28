// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Starboard's core in the extension host: starboard.wasm in a
// worker_threads worker (@c65llc/starboard-core/node), behind the same
// client the web app uses. The extension's dist/ holds the worker
// (node-worker.js, bundled by esbuild.mjs), starboard.wasm and Go's
// wasm_exec.js beside it.

import { join } from "node:path";

import type { StarboardCore } from "@c65llc/starboard-core";
import { createNodeCore } from "@c65llc/starboard-core/node";

/**
 * createCore starts a core session on dist's starboard.wasm on the first
 * call. A worker that crashes is replaced on the next call, as in the
 * browser.
 */
export function createCore(dist: string): StarboardCore {
  return createNodeCore({ wasmPath: join(dist, "starboard.wasm") });
}
