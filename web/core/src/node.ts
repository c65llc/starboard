// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

/// <reference types="node" />

// @c65llc/starboard-core/node: Starboard's core for Node hosts (the VS Code
// extension, the tests), in a node:worker_threads worker behind the same
// client the browser uses. The browser entry (index.ts) is unchanged.
//
// The worker script and the module are found beside this file: from source
// (src/node.ts) the worker is node-worker.ts, which Node runs with its type
// stripping, and the module is in ../dist/, where `make wasm` puts it; built
// (dist/node.js) or bundled (an extension's dist/extension.js, with
// import.meta.url defined as its own file), both are in the same folder.

import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import { createClient } from "./client.ts";
import type { ClientOptions, StarboardCore, Transport, TransportFactory } from "./client.ts";
import type { InitMessage } from "./protocol.ts";

const fromSource = import.meta.url.endsWith(".ts");

/** dist is the folder holding starboard.wasm and wasm_exec.js, which `make wasm` builds. */
export const dist = new URL(fromSource ? "../dist/" : "./", import.meta.url);

/** The worker script beside this module. */
const workerUrl = new URL(fromSource ? "./node-worker.ts" : "./node-worker.js", import.meta.url);

/** The default starboard.wasm: dist's. */
const defaultWasm = fileURLToPath(new URL("starboard.wasm", dist));

/**
 * nodeTransport spawns a worker on the module at wasmPath (dist's
 * starboard.wasm by default), loading Go's wasm_exec.js from beside it.
 * onSpawn, when given, sees each worker, so a test can kill one.
 */
export function nodeTransport(onSpawn?: (worker: Worker) => void, wasmPath: string = defaultWasm): TransportFactory {
  const wasmUrl = pathToFileURL(wasmPath);
  const init: InitMessage = {
    type: "init",
    wasmUrl: wasmUrl.href,
    wasmExecUrl: new URL("wasm_exec.js", wasmUrl).href,
  };
  return (events): Transport => {
    const worker = new Worker(workerUrl);
    worker.on("message", events.message);
    worker.on("error", events.crash);
    worker.on("exit", (code) => events.crash(new Error(`worker exited with code ${code}`)));
    worker.postMessage(init);
    onSpawn?.(worker);
    return {
      post: (msg) => worker.postMessage(msg),
      terminate: () => void worker.terminate(),
    };
  };
}

export interface NodeCoreOptions extends ClientOptions {
  /** starboard.wasm on disk; Go's wasm_exec.js is loaded from beside it. Defaults to dist's. */
  wasmPath?: string;
}

/**
 * createNodeCore starts Starboard's core in a worker thread on the first
 * call. As in the browser, a worker that crashes, or goes silent for
 * opts.timeoutMs with calls in flight, is replaced on the next call.
 */
export function createNodeCore(opts: NodeCoreOptions = {}): StarboardCore {
  const client: ClientOptions = opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs };
  return createClient(nodeTransport(undefined, opts.wasmPath), client);
}
