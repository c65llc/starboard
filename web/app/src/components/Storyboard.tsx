// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The walkthrough's storyboard strip: a list of step buttons, the current
// one marked aria-current="step". It is one Tab stop (a roving tabindex on
// the current step); ←/→, Home and End move to another step while the
// strip has focus, and focus follows the step.
//
// A list of buttons rather than a tablist: picking a step goes to that
// step's own address (#/flows/<id>/walk/<n>), as a link would, and the
// current step is a position in a sequence, which aria-current="step"
// says; a tablist would claim tabs controlling panels in place, with
// aria-selected, which is not what the strip does.

import { useEffect, useRef } from "preact/hooks";
import type { WalkStep } from "@c65llc/starboard-core";

import { keyStep } from "../flows/walk.ts";
import { dataUrl } from "./Wireframe.tsx";

interface Props {
  steps: WalkStep[];
  /** The current step, 1-based. */
  current: number;
  go: (step: number) => void;
}

export function Storyboard({ steps, current, go }: Props) {
  const list = useRef<HTMLOListElement>(null);
  // Set by a key, so focus follows the step only when the strip moved it.
  const follow = useRef(false);

  useEffect(() => {
    const strip = list.current;
    const here = strip?.querySelector<HTMLButtonElement>('button[aria-current="step"]');
    if (!strip || !here) return;
    // Scrolled within the strip only, so Next never scrolls the page.
    if (here.offsetLeft < strip.scrollLeft) strip.scrollLeft = here.offsetLeft;
    else if (here.offsetLeft + here.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = here.offsetLeft + here.offsetWidth - strip.clientWidth;
    }
    if (!follow.current) return;
    follow.current = false;
    here.focus();
  }, [current]);

  const onKeyDown = (e: KeyboardEvent) => {
    const to = keyStep(e.key, current, steps.length);
    if (to === null) return;
    e.preventDefault();
    if (to === current) return;
    follow.current = true;
    go(to);
  };

  return (
    <ol class="storyboard" aria-label="Steps" ref={list} onKeyDown={onKeyDown}>
      {steps.map((s, i) => {
        const n = i + 1;
        const here = n === current;
        return (
          <li key={s.number} class="storyboard__item">
            <button
              type="button"
              class="storyboard__step"
              aria-current={here ? "step" : undefined}
              tabIndex={here ? 0 : -1}
              onClick={() => go(n)}
            >
              <span class="storyboard__thumb" aria-hidden="true">
                {s.svg ? <img src={dataUrl(s.svg)} alt="" /> : <span class="storyboard__blank">?</span>}
              </span>
              <span class="storyboard__num">Step {n}</span>{" "}
              <span class="storyboard__text">{s.text}</span>{" "}
              <span class="storyboard__screen">{s.screen || "no screen"}</span>
            </button>
            {n < steps.length ? (
              <svg class="storyboard__arrow" width="22" height="12" viewBox="0 0 22 12" aria-hidden="true">
                <line x1="0" y1="6" x2="16" y2="6" />
                <path d="M14 1 L21 6 L14 11 Z" />
              </svg>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
