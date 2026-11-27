// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The flow editor (#/flows/<id>/edit): the flow list; the source (front
// matter fields, the Markdown body, its findings); and the preview (the
// diagram, live, and a chip per reference). Saving is src/flows/session.ts:
// ⌘/Ctrl-S, the Save button, or 1.5 s after the last change.

import { useEffect, useMemo } from "preact/hooks";
import type { TargetedKeyboardEvent } from "preact";

import { FlowDiagram } from "../components/FlowDiagram.tsx";
import { errorsByFile, FlowList } from "../components/FlowList.tsx";
import { FlowModes } from "../components/FlowModes.tsx";
import { FlowSource } from "../components/FlowSource.tsx";
import { RefChip } from "../components/RefChip.tsx";
import { extractDiagram } from "../flows/body.ts";
import { uniqueRefs } from "../flows/refs.ts";
import { FlowSession } from "../flows/session.ts";
import type { Route } from "../router.ts";
import { app } from "../store.ts";
import "./flows.css";

function onSaveKey(save: () => void) {
  return (e: TargetedKeyboardEvent<HTMLElement>) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  };
}

function Editor({ session }: { session: FlowSession }) {
  const model = app.model.value;
  const files = app.files.value;
  const text = files[session.path];
  const reads = app.reads.value;
  const flow = model?.flows.find((f) => f.id === session.flow);

  // Follow the file first, so the editor mounts holding it.
  useEffect(() => session.sync(text, reads), [session, text, reads]);
  useEffect(() => session.relint(), [session, files]);
  useEffect(() => () => session.close(), [session]);

  const body = session.body.value;
  const diagram = useMemo(() => extractDiagram(body), [body]);
  const refs = useMemo(() => uniqueRefs(body), [body]);
  if (!model || !flow) return null;
  const screens = new Map(model.screens.map((s) => [s.id, s]));
  const status = session.status.value;
  const line = status === "Saving…" ? status : session.dirty.value ? "Unsaved changes" : status;
  const save = () => void session.save();

  return (
    <div class="flow-edit__body" onKeyDown={onSaveKey(save)}>
      <div class="flow-edit__head">
        <h1>{flow.title || flow.id}</h1>
        <span class={`chip chip--${flow.status === "proposed" ? "proposed" : "shipped"}`}>{flow.status || "no status"}</span>
        <FlowModes flow={flow.id} current="edit" />
        <span class="flow-edit__status" role="status">
          {line}
        </span>
        <button type="button" class="button button--primary button--small" onClick={save} aria-keyshortcuts="Control+S Meta+S">
          Save <span class="flow-edit__key">⌘/Ctrl-S</span>
        </button>
      </div>
      <div class="flow-edit__panes">
        <FlowSource session={session} flow={flow} model={model} />
        <section class="flow-preview" aria-label="Preview">
          {diagram !== null ? (
            <FlowDiagram source={diagram} known={(id) => screens.has(id)} />
          ) : (
            <p class="view__note">This flow has no diagram. Add a ```mermaid block to the body to draw one.</p>
          )}
          <div class="refs-chips">
            <h2 class="refs-chips__title" id="flow-refs-title">
              References
            </h2>
            {refs.length === 0 ? <p class="view__note">No references yet: type @ in the body.</p> : null}
            <ul class="refs-chips__list" aria-labelledby="flow-refs-title">
              {refs.map((r) => (
                <RefChip key={r.text} target={r} screen={screens.get(r.screen)} files={files} />
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

export function FlowEdit({ route }: { route: Route }) {
  const model = app.model.value;
  const id = route.name === "flowEdit" ? route.flow : "";
  const flow = model?.flows.find((f) => f.id === id);
  const path = flow?.file;
  const session = useMemo(() => (path ? new FlowSession(id, path) : null), [id, path]);
  const diagnostics = app.lint.value?.diagnostics;
  const errors = useMemo(() => errorsByFile(diagnostics ?? []), [diagnostics]);

  return (
    <div class="flows">
      <FlowList flows={model?.flows ?? []} current={id} errors={errors} />
      <main id="main" class="flow-edit">
        {!model ? (
          <p class="view__note">Reading the project…</p>
        ) : !session ? (
          <>
            <h1>Flows</h1>
            <p class="view__note">There is no flow {id} in this project.</p>
          </>
        ) : (
          <Editor key={session.flow} session={session} />
        )}
      </main>
    </div>
  );
}
