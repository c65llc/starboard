// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The flow's source pane: the front matter as fields, the body in
// CodeMirror (src/flows/codemirror.ts, loaded on first use), and the
// findings lint has for this file, each a button to its line.

import { useEffect, useRef, useState } from "preact/hooks";
import type { Completion } from "@codemirror/autocomplete";
import type { Flow, Model } from "@c65llc/starboard-core";

import type { FlowView } from "../flows/codemirror.ts";
import { regionNames } from "../flows/refs.ts";
import type { RefContext } from "../flows/refs.ts";
import type { FlowSession } from "../flows/session.ts";

interface Props {
  session: FlowSession;
  flow: Flow;
  model: Model;
}

/** completions are the screens, or one screen's regions, autocomplete offers. */
function completions(model: Model, ctx: Exclude<RefContext, null>): Completion[] {
  if (ctx.kind === "screen") return model.screens.map((s) => ({ label: s.id, detail: s.title, type: "screen" }));
  const screen = model.screens.find((s) => s.id === ctx.screen);
  return screen ? regionNames(screen).map((name) => ({ label: name, type: "region" })) : [];
}

function Fields({ session, flow, model }: Props) {
  const drafts = session.drafts.value;
  const value = (key: "title" | "status" | "entry") => drafts[key] ?? flow[key];
  const entry = value("entry");
  const ids = model.screens.map((s) => s.id);
  return (
    <fieldset class="flow-fields">
      <legend class="visually-hidden">Front matter</legend>
      <label class="field flow-fields__title">
        Title
        <input type="text" value={value("title")} onInput={(e) => session.setMeta("title", e.currentTarget.value)} />
      </label>
      <label class="field">
        Status
        <select value={value("status")} onChange={(e) => session.setMeta("status", e.currentTarget.value)}>
          {value("status") === "" ? <option value="">(none)</option> : null}
          <option value="shipped">shipped</option>
          <option value="proposed">proposed</option>
        </select>
      </label>
      <label class="field">
        Entry screen
        <select value={entry} onChange={(e) => session.setMeta("entry", e.currentTarget.value)}>
          {entry === "" ? <option value="">(none)</option> : null}
          {entry !== "" && !ids.includes(entry) ? <option value={entry}>{`${entry} (not registered)`}</option> : null}
          {ids.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

function Findings({ session }: { session: FlowSession }) {
  const { marks, outside } = session.findings.value;
  const total = marks.length + outside.length;
  return (
    <section class="findings" aria-labelledby="flow-findings-title">
      <h2 id="flow-findings-title" class="findings__title">
        Findings in this file
      </h2>
      {total === 0 ? <p class="findings__none">None.</p> : null}
      <ul class="findings__list">
        {outside.map((d, i) => (
          <li key={`o${i}`} class={`finding finding--${d.severity === "error" ? "error" : "warning"}`}>
            <span class="finding__where">{d.line && d.line > 1 ? "Front matter" : "File"}</span>
            <code class="finding__rule">{d.rule}</code>
            <span>{d.message}</span>
          </li>
        ))}
        {marks.map((m, i) => (
          <li key={`m${i}`} class={`finding finding--${m.severity}`}>
            <button type="button" class="link-button finding__where" onClick={() => session.reveal(m.line)}>
              {`Line ${m.line}`}
            </button>
            <code class="finding__rule">{m.rule}</code>
            <span>{m.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FlowSource({ session, flow, model }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const name = flow.file.split("/").pop() ?? flow.file;
  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    let live = true;
    let view: FlowView | null = null;
    import("../flows/codemirror.ts")
      .then((cm) => {
        if (!live || !host.current) return;
        view = cm.mount(host.current, {
          text: session.body.value,
          label: `Markdown of ${name}`,
          complete: (ctx) => completions(modelRef.current, ctx),
          lint: (body) => session.lint(body),
          onChange: (body) => session.edited(body),
        });
        session.attach(view);
      })
      .catch((err: unknown) => live && setFailed(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
      view?.destroy();
    };
  }, [session, name]);

  return (
    <section class="flow-source" aria-label="Source">
      <div class="flow-source__bar">
        <code>{flow.file}</code>
        <span>Type @ to insert a screen or region</span>
      </div>
      <Fields session={session} flow={flow} model={model} />
      {failed ? <p class="alert">The editor could not load: {failed}</p> : null}
      <div class="flow-source__editor" ref={host} />
      <Findings session={session} />
    </section>
  );
}
