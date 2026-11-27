// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The flow list (#/flows): every flow document, with its status, its
// number of steps and its errors, each linking to its editor.

import { useMemo } from "preact/hooks";

import { errorsByFile } from "../components/FlowList.tsx";
import { NewFlow } from "../components/NewFlow.tsx";
import { hrefFor } from "../router.ts";
import { app } from "../store.ts";
import "./flows.css";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function Flows() {
  const model = app.model.value;
  const diagnostics = app.lint.value?.diagnostics;
  const errors = useMemo(() => errorsByFile(diagnostics ?? []), [diagnostics]);
  const flows = model?.flows ?? [];
  return (
    <main id="main" class="view">
      <div class="flows-head">
        <h1>Flows</h1>
        {model ? <NewFlow model={model} /> : null}
      </div>
      {!model ? (
        <p class="view__note">Reading the project…</p>
      ) : flows.length === 0 ? (
        <p class="view__note">This project has no flows yet: add one with New flow.</p>
      ) : (
        <ul class="flow-index" aria-label="Flows">
          {flows.map((f) => {
            const n = errors.get(f.file) ?? 0;
            return (
              <li key={f.id} class="flow-index__item">
                <a class="flow-index__title" href={hrefFor({ name: "flowEdit", flow: f.id })}>
                  {f.title || f.id}
                </a>
                <code class="flow-index__id">{f.file}</code>
                <span class={`chip chip--${f.status === "proposed" ? "proposed" : "shipped"}`}>{f.status || "no status"}</span>
                <span class="flow-index__meta">{plural(f.steps.length, "step")}</span>
                {n > 0 ? <span class="flow-index__errors">{plural(n, "error")}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
