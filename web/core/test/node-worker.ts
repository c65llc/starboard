// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The Node stand-in for src/worker.ts: the same serve loop on a
// worker_threads port, instantiating the module from disk instead of with
// instantiateStreaming. Node runs it with its built-in type stripping.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parentPort } from "node:worker_threads";

import type { ToWorker } from "../src/protocol.ts";
import { serve } from "../src/serve.ts";

const port = parentPort;
if (port === null) {
  throw new Error("node-worker.ts must run in a worker thread");
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
