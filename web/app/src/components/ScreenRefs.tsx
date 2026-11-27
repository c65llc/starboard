// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// What a screen connects to: the files that implement it on each
// platform, the flows it appears in, and the screens it navigates to.

import type { Flow, Screen } from "@c65llc/starboard-core";

import { hrefFor } from "../router.ts";
import { flowsUsing, navigatesTo } from "../screens/logic.ts";

export function ScreenRefs({ screen, flows }: { screen: Screen; flows: Flow[] }) {
  const files = Object.entries(screen.files).flatMap(([platform, paths]) => paths.map((p) => ({ platform, path: p })));
  const used = flowsUsing(flows, screen.id);
  const to = navigatesTo(screen);
  return (
    <section class="refs" aria-label="References">
      <h2 class="refs__title">Implemented in</h2>
      {files.length === 0 ? (
        <p class="refs__none">No files listed in screens.yaml.</p>
      ) : (
        <ul class="refs__list">
          {files.map((f) => (
            <li key={`${f.platform}:${f.path}`} class="mono">
              {f.platform} · {f.path}
            </li>
          ))}
        </ul>
      )}
      <h2 class="refs__title">Used in flows</h2>
      {used.length === 0 ? (
        <p class="refs__none">No flow uses this screen.</p>
      ) : (
        <ul class="refs__list">
          {used.map((f) => (
            <li key={f.id}>
              <a href={hrefFor({ name: "flowEdit", flow: f.id })}>{f.title || f.id}</a>
            </li>
          ))}
        </ul>
      )}
      <h2 class="refs__title">Navigates to</h2>
      {to.length === 0 ? (
        <p class="refs__none">Nowhere: no region of the default layout has a to.</p>
      ) : (
        <ul class="refs__list">
          {to.map((id) => (
            <li key={id}>
              <a class="mono" href={hrefFor({ name: "screens", screen: id })}>
                {id}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
