// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A flow's text (a step, a branch) as text, with each @reference to a
// registered screen a link to it; a reference to no such screen is text. Text is rendered as text, never parsed as HTML; references
// are found with core's own pattern (src/flows/refs.ts).

import { splitRefs } from "../flows/walk.ts";
import type { RefSyntax } from "../flows/refs.ts";
import { hrefFor } from "../router.ts";

interface Props {
  text: string;
  syntax: RefSyntax;
  /** Whether screen is registered; its references link only then. */
  known(screen: string): boolean;
}

export function RefText({ text, syntax, known }: Props) {
  return (
    <>
      {splitRefs(text, syntax).map((p, i) =>
        "ref" in p && !known(p.ref.screen) ? (
          <code key={i} class="ref-unknown">
            {p.ref.text}
          </code>
        ) : "ref" in p ? (
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
