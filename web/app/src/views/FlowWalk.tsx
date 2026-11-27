// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Walk through (#/flows/<id>/walk[/<n>]): the flow as a storyboard, from
// core.walkthrough on the chosen form factor. The current step is in the
// address, so a step can be linked to; moving between steps replaces the
// address rather than adding to history, so Back leaves the walkthrough.
// Each move is announced politely. The form factor is remembered for the session (src/flows/walk.ts).

import { useEffect, useMemo, useState } from "preact/hooks";
import type { Flow, Model, WalkStep } from "@c65llc/starboard-core";

import { errorsByFile, FlowList } from "../components/FlowList.tsx";
import { FlowModes } from "../components/FlowModes.tsx";
import { Storyboard } from "../components/Storyboard.tsx";
import { WalkCurrent } from "../components/WalkCurrent.tsx";
import { getCore } from "../core.ts";
import { refSyntax } from "../flows/refs.ts";
import { clampStep, rememberedFormFactor, rememberFormFactor, shownWalk, stepWarning, walkFormFactors } from "../flows/walk.ts";
import type { Answer, Asked } from "../flows/walk.ts";
import { replaceRoute } from "../router.ts";
import type { Route } from "../router.ts";
import { app } from "../store.ts";
import "./flows.css";
import "./walk.css";

/** stand is the walk the model alone gives, without wireframes: shown until core answers. */
function stand(flow: Flow, model: Model): WalkStep[] {
  const screens = new Map(model.screens.map((s) => [s.id, s]));
  return flow.steps.map((s, i) => ({
    number: s.number,
    text: s.text,
    screen: s.screen,
    region: s.region,
    presentation: screens.get(s.screen)?.presentation ?? "",
    next: flow.steps[i + 1]?.screen ?? "",
    branches: s.branches,
    svg: "",
  }));
}

function Walkthrough({ flow, model, step }: { flow: Flow; model: Model; step: number | undefined }) {
  const files = app.files.value;
  const offered = useMemo(() => walkFormFactors(flow, model.screens), [flow, model.screens]);
  const [picked, setPicked] = useState(() => rememberedFormFactor(offered));
  const formFactor = offered.includes(picked) ? picked : rememberedFormFactor(offered);
  const syntax = useMemo(() => refSyntax(model.refPattern), [model.refPattern]);
  const diagnostics = app.lint.value?.diagnostics ?? [];

  const asked = useMemo<Asked>(() => ({ flow: flow.id, formFactor, files }), [flow.id, formFactor, files]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  useEffect(() => {
    if (!asked.formFactor) return;
    let live = true;
    getCore()
      .walkthrough(asked.files, asked.flow, asked.formFactor)
      .then((walk) => live && setAnswer({ asked, walk }))
      .catch((err: unknown) => live && setAnswer({ asked, error: err instanceof Error ? err.message : String(err) }));
    return () => {
      live = false;
    };
  }, [asked]);

  // Keyed by flow (FlowWalk), so any answer is this flow's: until a new one
  // arrives (another form factor, an edit) the last one stays, labelled
  // with the form factor it was drawn on.
  const shown = shownWalk(answer, asked, stand(flow, model));
  const { steps } = shown;
  const index = clampStep(step, steps.length);
  const current = steps[index - 1];
  const go = (n: number) => replaceRoute({ name: "flowWalk", flow: flow.id, step: n });

  // An address past either end becomes the step shown.
  useEffect(() => {
    if (step !== undefined && index > 0 && step !== index) go(index);
  });

  const choose = (ff: string) => {
    rememberFormFactor(ff);
    setPicked(ff);
  };

  return (
    <>
      <div class="flow-edit__head">
        <h1>{flow.title || flow.id}</h1>
        <FlowModes flow={flow.id} current="walk" />
        {offered.length > 0 ? (
          <label class="walk__select">
            Form factor
            <select value={formFactor} onChange={(e) => choose((e.currentTarget as HTMLSelectElement).value)}>
              {offered.map((ff) => (
                <option key={ff} value={ff}>
                  {ff}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {offered.length === 0 && steps.length > 0 ? (
        <p class="view__note">None of this flow's steps names a screen with a form factor, so there are no wireframes to show.</p>
      ) : null}
      {!current ? (
        <p class="view__note">This flow has no numbered steps yet. Add them under "## Steps" in Edit.</p>
      ) : (
        <>
          <p class="visually-hidden" aria-live="polite" aria-atomic="true">
            {`Step ${index} of ${steps.length}: ${current.screen || "no screen"}`}
          </p>
          <Storyboard steps={steps} current={index} go={go} />
          <WalkCurrent
            step={current}
            index={index}
            count={steps.length}
            formFactor={shown.formFactor}
            stale={shown.stale}
            syntax={syntax}
            registered={model.screens.some((s) => s.id === current.screen)}
            drawn={shown.drawn || !formFactor}
            error={shown.error}
            warning={stepWarning(diagnostics, flow, current.number)}
            nextUnnamed={index < steps.length && !steps[index]?.screen}
            go={go}
          />
        </>
      )}
    </>
  );
}

export function FlowWalk({ route }: { route: Route }) {
  const model = app.model.value;
  const id = route.name === "flowWalk" ? route.flow : "";
  const step = route.name === "flowWalk" ? route.step : undefined;
  const flow = model?.flows.find((f) => f.id === id);
  const diagnostics = app.lint.value?.diagnostics;
  const errors = useMemo(() => errorsByFile(diagnostics ?? []), [diagnostics]);
  return (
    <div class="flows">
      <FlowList flows={model?.flows ?? []} current={id} errors={errors} model={model} />
      <main id="main" class="flow-edit walk">
        {!model ? (
          <p class="view__note">Reading the project…</p>
        ) : !flow ? (
          <>
            <h1>Flows</h1>
            <p class="view__note">There is no flow {id} in this project.</p>
          </>
        ) : (
          <Walkthrough key={flow.id} flow={flow} model={model} step={step} />
        )}
      </main>
    </div>
  );
}
