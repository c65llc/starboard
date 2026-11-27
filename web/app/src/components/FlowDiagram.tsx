// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The flow's Mermaid diagram, drawn live from the body being edited.
// Mermaid loads on first use (src/flows/mermaid.ts says how it is kept
// within the CSP); the drawing sits in a shadow root whose stylesheets are
// constructed ones, Mermaid's and the app's overrides, so no <style> or
// style attribute ever reaches the page. Nodes labelled with a registered
// screen's reference become links to it, so the diagram is drawn again
// when the set of screens changes. Each drawing is made with its own
// stylesheet, and the shown drawing and its rules are swapped together
// once it is done: typing never restyles the drawing on show, and one
// that fails leaves the last good drawing in place, under the error.

import { useEffect, useRef, useState } from "preact/hooks";

import type { RefSyntax } from "../flows/refs.ts";
import { hrefFor } from "../router.ts";

interface Props {
  source: string;
  syntax: RefSyntax;
  /** The registered screens' IDs: a node labelled with a reference to one is a link. */
  screens: ReadonlySet<string>;
}

/** How long the diagram waits after the last change before it redraws. */
const REDRAW_MS = 300;

/** The app's rules for a drawing whose root id is id: its colours are the tokens, for both themes. */
function overrides(id: string): string {
  const s = `#${id}`;
  return `
${s} { max-width: 100%; height: auto; }
${s} .node rect, ${s} .node polygon, ${s} .node circle, ${s} .node ellipse, ${s} .node path { fill: var(--color-surface); stroke: var(--color-border-strong); }
${s} .diagram__link .node rect, ${s} .diagram__link .node polygon, ${s} .diagram__link .node circle { fill: var(--color-ok-bg); stroke: var(--color-flow); stroke-width: 1.5px; }
${s} text, ${s} tspan, ${s} .label { fill: var(--color-ink); color: var(--color-ink); }
${s} .diagram__link text, ${s} .diagram__link tspan { fill: var(--color-flow); }
${s} .flowchart-link, ${s} .edgePath .path { stroke: var(--color-muted); }
${s} marker path, ${s} .arrowheadPath, ${s} .marker { fill: var(--color-muted); stroke: var(--color-muted); }
${s} .edgeLabel, ${s} .edgeLabel rect, ${s} .labelBkg { fill: var(--color-surface); background-color: var(--color-surface); }
${s} .cluster rect { fill: var(--color-surface-sunken); stroke: var(--color-border); }
`;
}

const BASE = `
:host { display: block; }
.diagram__canvas { display: flex; justify-content: center; }
a.diagram__link { cursor: pointer; }
a.diagram__link:focus { outline: none; }
a.diagram__link:focus-visible .node rect, a.diagram__link:focus-visible .node polygon { stroke: var(--color-focus); stroke-width: 3px; }
a.diagram__link:hover text { text-decoration: underline; }
`;

type State = { kind: "busy" } | { kind: "drawn" } | { kind: "error"; message: string };

export function FlowDiagram({ source, syntax, screens }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const sheets = useRef<{ mermaid: CSSStyleSheet; app: CSSStyleSheet; canvas: HTMLDivElement } | null>(null);
  const [state, setState] = useState<State>({ kind: "busy" });
  const screensRef = useRef(screens);
  screensRef.current = screens;
  // Changes when a screen is added, removed or renamed, not on every render.
  const screensKey = [...screens].sort().join("\n");

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    const base = new CSSStyleSheet();
    base.replaceSync(BASE);
    const mermaid = new CSSStyleSheet();
    const app = new CSSStyleSheet();
    root.adoptedStyleSheets = [base, mermaid, app];
    const canvas = document.createElement("div");
    canvas.className = "diagram__canvas";
    root.replaceChildren(canvas);
    sheets.current = { mermaid, app, canvas };
  }, []);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      const s = sheets.current;
      if (!s) return;
      // This drawing's own rules while Mermaid measures; the shown drawing keeps s.mermaid.
      const scratch = new CSSStyleSheet();
      import("../flows/mermaid.ts")
        .then((m) =>
          m.draw(source, scratch, {
            syntax,
            known: (screen) => screensRef.current.has(screen),
            href: (screen) => hrefFor({ name: "screens", screen }),
          }),
        )
        .then((d) => {
          if (!live) return;
          s.mermaid.replaceSync(d.css);
          s.app.replaceSync(overrides(d.id));
          s.canvas.replaceChildren(d.svg);
          setState({ kind: "drawn" });
        })
        .catch((err: unknown) => {
          if (!live) return;
          // The last good drawing stays, under the error.
          setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        });
    }, REDRAW_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [source, syntax, screensKey]);

  return (
    <figure class="diagram">
      <figcaption class="diagram__caption">Diagram · drawn from the mermaid block</figcaption>
      {state.kind === "busy" ? <p class="diagram__note">Drawing the diagram…</p> : null}
      {state.kind === "error" ? (
        <p class="diagram__note diagram__note--error">
          The diagram could not be drawn: {state.message}
          {sheets.current?.canvas.hasChildNodes() ? " The last drawing that worked is shown." : ""}
        </p>
      ) : null}
      <div class="diagram__drawing" ref={host} />
    </figure>
  );
}
