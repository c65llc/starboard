// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
  },
});
