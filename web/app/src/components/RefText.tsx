// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A flow's text (a step, a branch) as text, with each @reference a link to
// its screen. Text is rendered as text, never parsed as HTML; references
// are found with core's own pattern (src/flows/refs.ts).

import { splitRefs } from "../flows/walk.ts";
import type { RefSyntax } from "../flows/refs.ts";
import { hrefFor } from "../router.ts";

export function RefText({ text, syntax }: { text: string; syntax: RefSyntax }) {
  return (
    <>
      {splitRefs(text, syntax).map((p, i) =>
        "ref" in p ? (
          <a key={i} class="ref-link" href={hrefFor({ name: "screens", screen: p.ref.screen })}>
            {p.ref.text}
          </a>
        ) : (
          p.text
        ),
      )}
    </>
  );
}
