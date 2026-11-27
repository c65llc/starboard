// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Walk through (#/flows/<id>/walk). Until the storyboard is built, it
// shows the flow's steps in order, each with the screen it happens on.

import { useMemo } from "preact/hooks";

import { errorsByFile, FlowList } from "../components/FlowList.tsx";
import { FlowModes } from "../components/FlowModes.tsx";
import { hrefFor } from "../router.ts";
import type { Route } from "../router.ts";
import { app } from "../store.ts";
import "./flows.css";

export function FlowWalk({ route }: { route: Route }) {
  const model = app.model.value;
  const id = route.name === "flowWalk" ? route.flow : "";
  const flow = model?.flows.find((f) => f.id === id);
  const diagnostics = app.lint.value?.diagnostics;
  const errors = useMemo(() => errorsByFile(diagnostics ?? []), [diagnostics]);
  return (
    <div class="flows">
      <FlowList flows={model?.flows ?? []} current={id} errors={errors} model={model} />
      <main id="main" class="flow-edit">
        {!model ? (
          <p class="view__note">Reading the project…</p>
        ) : !flow ? (
          <>
            <h1>Flows</h1>
            <p class="view__note">There is no flow {id} in this project.</p>
          </>
        ) : (
          <>
            <div class="flow-edit__head">
              <h1>{flow.title || flow.id}</h1>
              <FlowModes flow={flow.id} current="walk" />
            </div>
            <p class="view__note">The storyboard is not drawn yet. These are the flow's steps, in order.</p>
            <ol class="walk-steps">
              {flow.steps.map((s) => (
                <li key={s.number}>
                  <span>{s.text}</span>
                  {s.screen ? (
                    <a class="walk-steps__screen" href={hrefFor({ name: "screens", screen: s.screen })}>
                      {s.region ? `${s.screen}#${s.region}` : s.screen}
                    </a>
                  ) : null}
                </li>
              ))}
            </ol>
          </>
        )}
      </main>
    </div>
  );
}
