// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The e2e tests' way into the app, installed only when navigator.webdriver
// is true (browser automation), and its own chunk otherwise never loaded.
// It opens files in a memory host, reads the open memory host's files (and
// no other host's), and runs core.format, so a test can compare what the
// app wrote with core's canonical form. It reaches no file a page script
// could not already have handed the app.

import type { Files } from "@c65llc/starboard-core";

import { getCore } from "./core.ts";
import { MemoryHost } from "./host/memory.ts";
import { app, openMemory } from "./store.ts";

export interface E2EHook {
  open(files: Files, name: string): Promise<void>;
  files(): Promise<Files | null>;
  format(files: Files): Promise<Record<string, string>>;
}

export function install(): void {
  const hook: E2EHook = {
    open: (files, name) => openMemory(files, name),
    files: async () => {
      const host = app.host.value;
      return host instanceof MemoryHost ? host.readAll() : null;
    },
    format: (files) => getCore().format(files),
  };
  (globalThis as unknown as { __starboardE2E: E2EHook }).__starboardE2E = hook;
}
