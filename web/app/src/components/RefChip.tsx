// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A reference in the flow as a chip linking to its screen. Hovering or
// focusing it shows the screen's wireframe (core.render, as an image) in a
// tooltip the link is described by. WCAG 1.4.13: the tooltip stays while
// the pointer is over it or the chip, until the pointer leaves or focus
// moves, and Escape dismisses it without moving focus.

import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { Files, Screen } from "@c65llc/starboard-core";

import { getCore } from "../core.ts";
import { hrefFor } from "../router.ts";
import { regionNames } from "../flows/refs.ts";
import type { Ref } from "../flows/refs.ts";
import { dataUrl } from "./Wireframe.tsx";

interface Props {
  target: Pick<Ref, "screen" | "region" | "text">;
  screen: Screen | undefined;
  files: Files;
}

type Preview = { src: string; alt: string } | { error: string };

export function RefChip({ target, screen, files }: Props) {
  const tip = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const open = (hovered || focused) && !dismissed;
  const formFactor = screen?.formFactors[0] ?? "";
  const unresolved = !screen;
  const missingRegion = Boolean(screen && target.region && !regionNames(screen).includes(target.region));

  // Drawn on first showing, and again when the project changes while shown.
  useEffect(() => {
    if (!open || !screen || !formFactor) return;
    let live = true;
    getCore()
      .render(files, screen.id, formFactor)
      .then((svg) => live && setPreview({ src: dataUrl(svg), alt: `Wireframe of ${screen.id} on ${formFactor}` }))
      .catch((err: unknown) => live && setPreview({ error: err instanceof Error ? err.message : String(err) }));
    return () => {
      live = false;
    };
  }, [open, files, screen, formFactor]);

  // Listened for the chip's whole life, not only while open: a listener
  // added on opening can miss an Escape pressed before its effect has run.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openRef.current) setDismissed(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A new hover or focus shows it again, even after Escape dismissed it.
  // Ending one does not: with focus still on the chip, the pointer leaving
  // (or the chip moving out from under it, which WebKit reports as a
  // leave) must not bring back a preview Escape dismissed.
  const start = (set: (v: boolean) => void) => () => {
    set(true);
    setDismissed(false);
  };
  const leave = (set: (v: boolean) => void) => () => set(false);

  return (
    <li
      class="ref-chip"
      onMouseEnter={start(setHovered)}
      onMouseLeave={leave(setHovered)}
      onFocusIn={start(setFocused)}
      onFocusOut={leave(setFocused)}
    >
      <a
        class={`ref-chip__link${unresolved || missingRegion ? " ref-chip__link--unresolved" : ""}`}
        href={hrefFor({ name: "screens", screen: target.screen })}
        aria-describedby={tip}
      >
        {target.text}
      </a>
      <div role="tooltip" id={tip} class="ref-chip__preview" hidden={!open}>
        {unresolved ? (
          <p>{`${target.screen} is not a registered screen.`}</p>
        ) : !formFactor ? (
          <p>{`${target.screen} is on no platform, so it has no wireframe.`}</p>
        ) : preview && "src" in preview ? (
          <img src={preview.src} alt={preview.alt} />
        ) : preview ? (
          <p>{`The wireframe could not be drawn: ${preview.error}`}</p>
        ) : (
          <p>Drawing the wireframe…</p>
        )}
        {missingRegion ? <p>{`${target.screen} has no region ${target.region}.`}</p> : null}
        {screen && target.region && !missingRegion ? <p>{`Region ${target.region}`}</p> : null}
      </div>
    </li>
  );
}

