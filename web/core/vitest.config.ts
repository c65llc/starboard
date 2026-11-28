// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { defineConfig } from "vitest/config";

export default defineConfig({
  // The tests import @c65llc/starboard-core/node by name, from its sources
  // (the "source" export), so they need no `pnpm build` first.
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    include: ["test/**/*.test.ts"],
    // Instantiating the 7 MB module takes a moment on a cold runner.
    testTimeout: 30_000,
  },
});
