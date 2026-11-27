// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The flow's two modes, Edit and Walk through, as links: each is its own
// address (#/flows/<id>/edit, #/flows/<id>/walk).

import { hrefFor } from "../router.ts";

export function FlowModes({ flow, current }: { flow: string; current: "edit" | "walk" }) {
  return (
    <nav class="modes" aria-label="Mode">
      <a href={hrefFor({ name: "flowEdit", flow })} aria-current={current === "edit" ? "page" : undefined}>
        Edit
      </a>
      <a href={hrefFor({ name: "flowWalk", flow })} aria-current={current === "walk" ? "page" : undefined}>
        Walk through
      </a>
    </nav>
  );
}
