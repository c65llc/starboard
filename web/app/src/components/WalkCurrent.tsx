// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The walkthrough's current step: its wireframe with the step's region
// highlighted (core.walkthrough's SVG, as an <img> of a data: URL, never
// inlined), its text, the screen and region it happens on, where it leads,
// the other paths from it, and Previous and Next.

import { useEffect, useRef } from "preact/hooks";
import type { Diagnostic, WalkStep } from "@c65llc/starboard-core";

import type { RefSyntax } from "../flows/refs.ts";
import { hrefFor } from "../router.ts";
import { RefText } from "./RefText.tsx";
import { dataUrl } from "./Wireframe.tsx";

interface Props {
  step: WalkStep;
  /** 1-based. */
  index: number;
  count: number;
  /** The form factor step's wireframe was drawn on. */
  formFactor: string;
  syntax: RefSyntax;
  /** The step's screen is in the registry. */
  registered: boolean;
  /** The wireframe shown is an older drawing (another form factor, or before an edit), kept while the new one is drawn. */
  stale: boolean;
  /** core.walkthrough has answered for this flow and form factor. */
  drawn: boolean;
  /** Why core.walkthrough failed, or "". */
  error: string;
  /** Lint's step-without-ref finding for the step. */
  warning: Diagnostic | undefined;
  /** The next step names no screen. */
  nextUnnamed: boolean;
  go: (step: number) => void;
  /** Whether a screen is registered: references to it link, others are text. */
  known(screen: string): boolean;
}

/** ScreenLink links to screen, or names it as text when it is not registered. */
function ScreenLink({ screen, known }: { screen: string; known(screen: string): boolean }) {
  if (!known(screen)) return <code class="walk__code">@{screen}</code>;
  return (
    <a class="walk__code" href={hrefFor({ name: "screens", screen })}>
      @{screen}
    </a>
  );
}

function Picture({ step, formFactor, stale, registered, drawn, error, warning }: Props) {
  if (!step.screen) {
    return (
      <div class="walk__none">
        <p>
          This step names no screen. Add <code>@screen#region</code> to show it.
        </p>
        {warning ? (
          <p class="walk__warning">
            <span class="finding__severity--warn">warning</span> <code>{warning.rule}</code> {warning.message}{" "}
            <code>{warning.line ? `${warning.file}:${warning.line}` : warning.file}</code>
          </p>
        ) : null}
      </div>
    );
  }
  if (step.svg) {
    const where = step.region ? `, ${step.region} highlighted` : "";
    return (
      <figure class={`walk__figure${stale ? " walk__figure--stale" : ""}`} aria-busy={stale ? "true" : undefined}>
        <img class="walk__wireframe" src={dataUrl(step.svg)} alt={`Wireframe of ${step.screen} on ${formFactor}${where}`} />
        <figcaption>
          {step.screen}
          {step.presentation ? ` · ${step.presentation}` : ""}
          {` · ${formFactor}`}
          {stale ? " · redrawing…" : ""}
        </figcaption>
      </figure>
    );
  }
  const why = error
    ? `The walkthrough could not be drawn: ${error}`
    : !drawn
      ? "Drawing the wireframe…"
      : !registered
        ? `${step.screen} is not a registered screen, so there is nothing to draw.`
        : `${step.screen} has no wireframe on ${formFactor}.`;
  return <p class="walk__none">{why}</p>;
}

export function WalkCurrent(props: Props) {
  const { step, index, count, syntax, known, nextUnnamed, go } = props;
  const prev = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  // A button disabled under focus drops it; the other one takes it.
  const pressed = useRef<"prev" | "next" | null>(null);
  useEffect(() => {
    const was = pressed.current;
    pressed.current = null;
    if (was === "next" && index === count) prev.current?.focus();
    if (was === "prev" && index === 1) next.current?.focus();
  }, [index, count]);

  const last = index === count;
  return (
    <section class="walk__current" aria-label="Current step">
      <Picture {...props} />
      <div class="walk__detail">
        <div class="walk__lead">
          <span class="walk__count">
            Step {index} of {count}
          </span>
          <p class="walk__text">
            <RefText text={step.text} syntax={syntax} known={known} />
          </p>
        </div>
        <dl class="walk__facts">
          <dt>Screen</dt>
          <dd>{step.screen ? <ScreenLink screen={step.screen} known={known} /> : "None"}</dd>
          <dt>Where to act</dt>
          <dd>{step.region ? <code class="walk__code">#{step.region}</code> : step.screen ? "The whole screen" : "Nowhere yet"}</dd>
          <dt>Leads to</dt>
          <dd>{last ? "End of the flow" : step.next ? <ScreenLink screen={step.next} known={known} /> : nextUnnamed ? "A step that names no screen" : "—"}</dd>
        </dl>
        <div class="walk__paths">
          <h2 id="walk-paths">Other paths from this step</h2>
          {step.branches.length === 0 ? (
            <p class="view__note">None: this step has one way on.</p>
          ) : (
            <ul aria-labelledby="walk-paths">
              {step.branches.map((b, i) => (
                <li key={i}>
                  <RefText text={b} syntax={syntax} known={known} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div class="walk__buttons">
          <button
            type="button"
            class="button"
            ref={prev}
            disabled={index <= 1}
            onClick={() => {
              pressed.current = "prev";
              go(index - 1);
            }}
          >
            <span aria-hidden="true">←</span> Previous step
          </button>
          <button
            type="button"
            class="button button--primary"
            ref={next}
            disabled={last}
            onClick={() => {
              pressed.current = "next";
              go(index + 1);
            }}
          >
            Next step <span aria-hidden="true">→</span>
          </button>
        </div>
        <p class="walk__hint">
          Built from the flow's numbered steps: each step's first <code>@screen#region</code> picks the screen and the highlight.
        </p>
      </div>
    </section>
  );
}
