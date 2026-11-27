// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A TransportFactory over node:worker_threads, so the tests drive the real
// starboard.wasm through the same client the browser uses.

import { Worker } from "node:worker_threads";

import type { Transport, TransportFactory } from "../src/client.ts";

/** dist is where `make wasm` puts starboard.wasm and wasm_exec.js. */
export const dist = new URL("../dist/", import.meta.url);

/**
 * nodeTransport spawns test/node-worker.ts on dist's module. onSpawn, when
 * given, sees each worker, so a test can kill one.
 */
export function nodeTransport(onSpawn?: (worker: Worker) => void): TransportFactory {
  return (events): Transport => {
    const worker = new Worker(new URL("./node-worker.ts", import.meta.url));
    worker.on("message", events.message);
    worker.on("error", events.crash);
    worker.on("exit", (code) => events.crash(new Error(`worker exited with code ${code}`)));
    worker.postMessage({
      type: "init",
      wasmUrl: new URL("starboard.wasm", dist).href,
      wasmExecUrl: new URL("wasm_exec.js", dist).href,
    });
    onSpawn?.(worker);
    return {
      post: (msg) => worker.postMessage(msg),
      terminate: () => void worker.terminate(),
    };
  };
}
