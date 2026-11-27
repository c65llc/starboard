// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app's ELK: elkjs's API on this thread, its layout engine in a
// classic Web Worker. The worker script is elkjs's own build, emitted as
// an asset of this origin (worker-src 'self'); it uses no eval. Both load
// only when the map is first shown, and the one worker serves every
// layout after that.

import ELK from "elkjs/lib/elk-api.js";
import workerUrl from "elkjs/lib/elk-worker.min.js?url";

import type { Elk } from "./layout.ts";

let elk: Elk | undefined;

export function workerElk(): Elk {
  elk ??= new ELK({ workerFactory: () => new Worker(workerUrl) });
  return elk;
}
