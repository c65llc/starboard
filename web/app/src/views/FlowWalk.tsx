// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Walk through (#/flows/<id>/walk[/<n>]): the flow as a storyboard, from
// core.walkthrough on the chosen form factor. The current step is in the
// address, so a step can be linked to and Back returns to the one before;
// the form factor is remembered for the session (src/flows/walk.ts).

import { useEffect, useMemo, useState } from "preact/hooks";
import type { Flow, Model, Walk, WalkStep } from "@c65llc/starboard-core";

import { errorsByFile, FlowList } from "../components/FlowList.tsx";
import { FlowModes } from "../components/FlowModes.tsx";
import { Storyboard } from "../components/Storyboard.tsx";
import { WalkCurrent } from "../components/WalkCurrent.tsx";
import { getCore } from "../core.ts";
import { refSyntax } from "../flows/refs.ts";
import { clampStep, rememberedFormFactor, rememberFormFactor, stepWarning, walkFormFactors } from "../flows/walk.ts";
import { hrefFor } from "../router.ts";
import type { Route } from "../router.ts";
import { app } from "../store.ts";
import "./flows.css";
import "./walk.css";

type Answer = { key: string; walk: Walk } | { key: string; error: string };

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

  const key = `${formFactor}\u0000${flow.id}`;
  const [answer, setAnswer] = useState<Answer | null>(null);
  useEffect(() => {
    if (!formFactor) return;
    let live = true;
    getCore()
      .walkthrough(files, flow.id, formFactor)
      .then((walk) => live && setAnswer({ key, walk }))
      .catch((err: unknown) => live && setAnswer({ key, error: err instanceof Error ? err.message : String(err) }));
    return () => {
      live = false;
    };
  }, [files, flow.id, formFactor, key]);

  // Keyed by flow (FlowWalk), so any answer is this flow's: until a new one
  // arrives (another form factor, an edit) the last one stays.
  const steps = answer && "walk" in answer ? answer.walk.steps : stand(flow, model);
  const error = answer?.key === key && "error" in answer ? answer.error : "";
  const drawn = answer?.key === key;
  const index = clampStep(step, steps.length);
  const current = steps[index - 1];
  const go = (n: number) => {
    location.hash = hrefFor({ name: "flowWalk", flow: flow.id, step: n });
  };
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
          <Storyboard steps={steps} current={index} go={go} />
          <WalkCurrent
            step={current}
            index={index}
            count={steps.length}
            formFactor={formFactor}
            syntax={syntax}
            registered={model.screens.some((s) => s.id === current.screen)}
            drawn={drawn || !formFactor}
            error={error}
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
