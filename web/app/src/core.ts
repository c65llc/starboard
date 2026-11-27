// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The one StarboardCore the app uses. Its worker starts on the first call;
// starboard.wasm and wasm_exec.js are served from <base>core/ (vite.config.ts
// copies them there and the service worker precaches them).

import { createCore } from "@c65llc/starboard-core";
import type { StarboardCore } from "@c65llc/starboard-core";

let core: StarboardCore | undefined;

export function getCore(): StarboardCore {
  core ??= createCore({ wasmUrl: new URL(`${import.meta.env.BASE_URL}core/starboard.wasm`, location.href) });
  return core;
}
