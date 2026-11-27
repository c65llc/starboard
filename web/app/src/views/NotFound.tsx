// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// An address inside a project that no view answers.

import { hrefFor } from "../router.ts";

export function NotFound() {
  return (
    <main id="main" class="view">
      <h1>Not found</h1>
      <p class="view__note">
        There is no page at this address. <a href={hrefFor({ name: "screens" })}>Go to the screens</a>.
      </p>
    </main>
  );
}
