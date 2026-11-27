// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// examples/travel-app, bundled at build time for "Explore the example
// project". Loaded with a dynamic import, so it is its own chunk: the shell
// does not carry it, and the service worker precaches it for offline use.

import type { Files } from "@c65llc/starboard-core";

const PREFIX = "../../../examples/travel-app/";

const raw = import.meta.glob<string>(["../../../examples/travel-app/**/*", "!**/README.md"], {
  query: "?raw",
  import: "default",
  eager: true,
});

export const EXAMPLE_NAME = "travel-app";

export const exampleFiles: Files = Object.fromEntries(
  Object.entries(raw).map(([path, text]) => [path.slice(PREFIX.length), text]),
);
