// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // The unit tests run outside VS Code, so "vscode" is a small stand-in
  // with an in-memory file system.
  resolve: {
    alias: { vscode: fileURLToPath(new URL("./test/unit/vscode-stub.ts", import.meta.url)) },
  },
  // @c65llc/starboard-core from its sources (its "source" export), as
  // esbuild bundles it, so the tests need no `pnpm build` of it first.
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    include: ["test/unit/**/*.test.ts"],
    // The host tests drive the real starboard.wasm, a 7 MB module.
    testTimeout: 30_000,
  },
});
