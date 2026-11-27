// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The service worker, registered with registerType "prompt": a new version
// waits until the user chooses Reload in the "Update available" toast, so
// an edit in progress is never cut off by a reload.

import { signal } from "@preact/signals";
import { registerSW } from "virtual:pwa-register";

export const updateAvailable = signal(false);

let update: ((reload?: boolean) => Promise<void>) | undefined;

export function startPwa(): void {
  if (!("serviceWorker" in navigator)) return;
  update = registerSW({
    onNeedRefresh() {
      updateAvailable.value = true;
    },
  });
}

export function applyUpdate(): void {
  updateAvailable.value = false;
  void update?.(true);
}

export function dismissUpdate(): void {
  updateAvailable.value = false;
}
