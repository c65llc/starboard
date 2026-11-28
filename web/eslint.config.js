// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/",
      // web/app's embed build, and its copy in web/vscode.
      "**/dist-embed/",
      // web/app's desktop build, and what cargo and tauri-build make in web/desktop.
      "**/dist-desktop/",
      "desktop/src-tauri/target/",
      "desktop/src-tauri/gen/",
      "**/node_modules/",
      "**/dev-dist/",
      "**/test-results/",
      "**/playwright-report/",
      // web/vscode: the bundled integration tests, and the VS Code they run in.
      "**/dist-test/",
      "**/.vscode-test/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    // The fixture in test.ts works around a Firefox crash (Mozilla bug
    // 2090055); a spec importing Playwright's own test/expect silently
    // loses it, and fails only on Firefox, only sometimes.
    files: ["app/e2e/**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              importNames: ["test", "expect"],
              allowTypeImports: true,
              message:
                "Import test and expect from ./test.ts: it carries the workaround for Firefox's ARIA-reflection crash (Mozilla bug 2090055).",
            },
          ],
        },
      ],
    },
  },
);
