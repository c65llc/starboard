// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The flows beside the flow editor, each linking to its editor, the one
// showing marked as current, with its status and its error count.

import type { Flow, Model } from "@c65llc/starboard-core";

import { hrefFor } from "../router.ts";
import { NewFlow } from "./NewFlow.tsx";

interface Props {
  flows: Flow[];
  current?: string;
  /** Errors per flow file. */
  errors: ReadonlyMap<string, number>;
  /** The model, for New flow; none while the project is read. */
  model?: Model | null;
}

export function FlowList({ flows, current, errors, model }: Props) {
  return (
    <nav class="flow-list" aria-label="Flows">
      <h2 class="flow-list__title">Flows</h2>
      {flows.length === 0 ? <p class="flow-list__empty">No flows yet.</p> : null}
      <ul class="flow-list__rows">
        {flows.map((f) => {
          const n = errors.get(f.file) ?? 0;
          return (
            <li key={f.id}>
              <a
                class="flow-list__link"
                href={hrefFor({ name: "flowEdit", flow: f.id })}
                aria-current={f.id === current ? "page" : undefined}
              >
                <span>{f.title || f.id}</span>
                {n > 0 ? (
                  <span class="flow-list__badge flow-list__badge--error">{`${n} error${n === 1 ? "" : "s"}`}</span>
                ) : f.status === "proposed" ? (
                  <span class="flow-list__badge flow-list__badge--proposed">proposed</span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
      {model ? <NewFlow model={model} dashed /> : null}
    </nav>
  );
}

/** errorsByFile counts the error findings in each file. */
export function errorsByFile(diagnostics: { file: string; severity: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of diagnostics) if (d.severity === "error") out.set(d.file, (out.get(d.file) ?? 0) + 1);
  return out;
}
