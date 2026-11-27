// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The browser's module worker: serve on self, with the module streamed and
// compiled as it downloads (instantiateStreaming, which a CSP allows with
// 'wasm-unsafe-eval'). It fetches only the two URLs its InitMessage names.

import type { FromWorker, ToWorker } from "./protocol.ts";
import { serve } from "./serve.ts";

interface WorkerScope {
  postMessage(msg: FromWorker): void;
  addEventListener(type: "message", listener: (event: MessageEvent<ToWorker>) => void): void;
}

const self = globalThis as unknown as WorkerScope;

serve(
  {
    postMessage: (msg) => self.postMessage(msg),
    onMessage: (handle) => self.addEventListener("message", (event) => handle(event.data)),
  },
  async (url, imports) => (await WebAssembly.instantiateStreaming(fetch(url), imports)).instance,
);
