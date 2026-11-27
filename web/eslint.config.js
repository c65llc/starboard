// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/", "**/node_modules/", "**/dev-dist/", "**/test-results/", "**/playwright-report/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
);
