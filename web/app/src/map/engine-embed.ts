// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// map/engine.ts as the embed build has it (vite.config.embed.ts swaps it
// in): the VS Code panel's page starts no worker, so ELK's layout engine
// runs on this thread, as elkjs's own fake worker. It uses no eval.

import ELK from "elkjs/lib/elk-api.js";
import { Worker as FakeWorker } from "elkjs/lib/elk-worker.min.js";

import type { Elk } from "./layout.ts";

let elk: Elk | undefined;

export function workerElk(): Elk {
  elk ??= new ELK({ workerFactory: () => new FakeWorker() });
  return elk;
}
