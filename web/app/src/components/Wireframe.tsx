// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The screen's wireframe on one form factor, as core.render draws it,
// with the selected region (by name) outlined. It is shown as an <img> of a data: URL, never inlined: labels are user
// content, and an SVG in an image can never run script or reach the page.

import { useEffect, useState } from "preact/hooks";
import type { Files } from "@c65llc/starboard-core";

import { getCore } from "../core.ts";

interface Props {
  files: Files;
  screen: string;
  formFactor: string;
  /** The name of the region to outline: the one selected in the editor. */
  region?: string | undefined;
}

type Drawn = { key: string; src: string; alt: string } | { key: string; error: string };

/** dataUrl is svg as an image URL. */
export function dataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function Wireframe({ files, screen, formFactor, region = "" }: Props) {
  const key = `${screen}\u0000${formFactor}`;
  const alt = `Wireframe of ${screen} on ${formFactor}`;
  const [drawn, setDrawn] = useState<Drawn | null>(null);

  useEffect(() => {
    let live = true;
    getCore()
      .render(files, screen, formFactor, region)
      .then((svg) => live && setDrawn({ key, src: dataUrl(svg), alt }))
      .catch((err: unknown) => live && setDrawn({ key, error: err instanceof Error ? err.message : String(err) }));
    return () => {
      live = false;
    };
  }, [files, screen, formFactor, region, key, alt]);

  // Until the new drawing arrives the last one stays, under its own name.
  return (
    <figure class="wireframe">
      {drawn && "src" in drawn ? (
        <img class="wireframe__image" src={drawn.src} alt={drawn.alt} />
      ) : drawn && drawn.key === key && "error" in drawn ? (
        <p class="wireframe__error">The wireframe could not be drawn: {drawn.error}</p>
      ) : (
        <p class="wireframe__busy">Drawing the wireframe…</p>
      )}
      <figcaption>{formFactor} · generated from screens.yaml</figcaption>
    </figure>
  );
}
