// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

/// <reference types="node" />

// The worker node.ts spawns: the browser worker's serve loop (worker.ts)
// on a worker_threads port, instantiating the module from disk instead of
// with instantiateStreaming. Run from source, Node strips its types; the
// package's build and a bundler (the VS Code extension's esbuild) make it
// node-worker.js beside node.js.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parentPort } from "node:worker_threads";

import type { ToWorker } from "./protocol.ts";
import { serve } from "./serve.ts";

const port = parentPort;
if (port === null) {
  throw new Error("node-worker must run in a worker thread");
}

serve(
  {
    postMessage: (msg) => port.postMessage(msg),
    onMessage: (handle) => port.on("message", (msg: ToWorker) => handle(msg)),
  },
  async (url, imports) => {
    const bytes = await readFile(fileURLToPath(url));
    return (await WebAssembly.instantiate(bytes, imports)).instance;
  },
);
