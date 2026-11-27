// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// @c65llc/starboard-core: Starboard's core compiled to WebAssembly, run in
// a module Worker behind a typed, promise-based client.

import { createClient } from "./client.ts";
import type { ClientOptions, StarboardCore } from "./client.ts";
import type { FromWorker, InitMessage } from "./protocol.ts";

export { createClient, DEFAULT_TIMEOUT_MS, StarboardCrashError, StarboardError } from "./client.ts";
export type { ClientOptions, StarboardCore, Transport, TransportEvents, TransportFactory } from "./client.ts";
export type * from "./types.ts";

export interface CoreOptions extends ClientOptions {
  /** starboard.wasm; Go's wasm_exec.js is loaded from beside it. */
  wasmUrl: URL;
  /** The worker script; defaults to this package's worker.js. */
  workerUrl?: URL;
}

/**
 * createCore starts Starboard's core in a module Worker on the first call.
 * The worker loads wasm_exec.js and the module once; a worker that crashes
 * is replaced on the next call, and the calls it held are rejected; so is
 * one silent for opts.timeoutMs with calls in flight (ClientOptions).
 */
export function createCore(opts: CoreOptions): StarboardCore {
  const init: InitMessage = {
    type: "init",
    wasmUrl: opts.wasmUrl.href,
    wasmExecUrl: new URL("wasm_exec.js", opts.wasmUrl).href,
  };
  return createClient((events) => {
    // The default is written inline, as Vite needs to find and bundle it.
    const worker = opts.workerUrl
      ? new Worker(opts.workerUrl, { type: "module" })
      : new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<FromWorker>) => events.message(event.data));
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      events.crash(new Error(event.message || "the worker failed to start"));
    });
    worker.addEventListener("messageerror", () => events.crash(new Error("a worker message could not be read")));
    worker.postMessage(init);
    return {
      post: (msg) => worker.postMessage(msg),
      terminate: () => worker.terminate(),
    };
  }, opts);
}
