// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Polite announcements in the corner: "Reloaded: changed on disk" and the
// service worker's "Update available".

import { app } from "../store.ts";
import { applyUpdate, dismissUpdate, updateAvailable } from "../pwa.ts";

export function Toasts() {
  const notice = app.notice.value;
  return (
    <div class="toasts" role="status" aria-live="polite">
      {notice ? (
        <div class="toast">
          <span class="toast__text">{notice}</span>
          <button
            type="button"
            class="button button--small"
            onClick={() => {
              app.notice.value = null;
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {updateAvailable.value ? (
        <div class="toast">
          <span class="toast__text">Update available</span>
          <button type="button" class="button button--small button--primary" onClick={applyUpdate}>
            Reload
          </button>
          <button type="button" class="button button--small" onClick={dismissUpdate}>
            Later
          </button>
        </div>
      ) : null}
    </div>
  );
}
