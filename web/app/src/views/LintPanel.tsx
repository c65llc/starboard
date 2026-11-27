// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The project's lint findings. A finding about a screen or region is a
// button that opens the editor on it; one about a flow opens the flow;
// the rest (a stale generated page, say) are plain rows. Beside each, a
// link opens its rule's page on the website (the finding's docs URL) in a
// new tab: a link cannot sit inside the row's button. "Fix
// automatically" runs core.fix, which formats the sources and regenerates
// the generated pages, as one change. Long lists show their first rows
// until asked for the rest, so a large project's findings stay quick.

import { useState } from "preact/hooks";
import type { Diagnostic, Flow, Screen } from "@c65llc/starboard-core";

import { goTo, registryPath, run } from "../screens/editor.ts";
import { fixable, targetOf } from "../screens/logic.ts";
import { app } from "../store.ts";
import "./lint-panel.css";

const FIRST = 50;

function where(d: Diagnostic): string {
  return d.line ? `${d.file}:${d.line}` : d.file;
}

function Finding({ d, screens, flows, registry }: { d: Diagnostic; screens: Screen[]; flows: Flow[]; registry: string }) {
  const target = targetOf(d, screens, flows, registry);
  const body = (
    <>
      <span class={`finding__severity finding__severity--${d.severity}`}>{d.severity === "warn" ? "warning" : d.severity}</span>{" "}
      <code class="finding__rule">{d.rule}</code> <span class="finding__message">{d.message}</span>{" "}
      <code class="finding__where">{where(d)}</code>
    </>
  );
  return (
    <li class="finding">
      {target.kind === "none" ? (
        <div class="finding__row">{body}</div>
      ) : (
        <button type="button" class="finding__row finding__row--button" onClick={() => goTo(target)}>
          {body}
        </button>
      )}
      {d.docs?.startsWith("https://") ? (
        <a class="finding__docs" href={d.docs} target="_blank" rel="noopener noreferrer">
          Docs<span class="visually-hidden"> for {d.rule}</span>
        </a>
      ) : null}
    </li>
  );
}

export function LintPanel() {
  const [all, setAll] = useState(false);
  const lint = app.lint.value;
  const model = app.model.value;
  const diagnostics = lint?.diagnostics ?? [];
  const fixes = fixable(diagnostics);
  const shown = all ? diagnostics : diagnostics.slice(0, FIRST);
  return (
    <section class="lint-panel" aria-labelledby="lint-title">
      <div class="lint-panel__head">
        <h2 id="lint-title" class="lint-panel__title">
          Lint findings
        </h2>
        <button
          type="button"
          class="button button--small"
          disabled={fixes === 0}
          onClick={() => void run(app.applyFix())}
        >
          Fix {fixes} automatically
        </button>
      </div>
      {!lint ? (
        <p class="lint-panel__note">Linting…</p>
      ) : diagnostics.length === 0 ? (
        <p class="lint-panel__note">No findings: the project lints clean.</p>
      ) : (
        <ul class="lint-panel__list">
          {shown.map((d, i) => (
            <Finding
              key={`${d.file}:${d.line ?? 0}:${d.rule}:${i}`}
              d={d}
              screens={model?.screens ?? []}
              flows={model?.flows ?? []}
              registry={registryPath.value}
            />
          ))}
        </ul>
      )}
      {!all && diagnostics.length > FIRST ? (
        <button type="button" class="link-button lint-panel__more" onClick={() => setAll(true)}>
          Show all {diagnostics.length} findings
        </button>
      ) : null}
    </section>
  );
}
