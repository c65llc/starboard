// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// New flow: a button and a modal <dialog> (the browser keeps focus inside
// it and closes it on Escape; focus goes back to the button). The ID is
// checked against core's own form (model.flowIdPattern) before the
// addFlow edit runs; once saved, the editor opens the new flow.

import { useRef, useState } from "preact/hooks";
import type { Model } from "@c65llc/starboard-core";

import { newFlowProblem } from "../flows/body.ts";
import { navigate } from "../router.ts";
import { words } from "../screens/editor.ts";
import { app } from "../store.ts";

export function NewFlow({ model, dashed = false }: { model: Model; dashed?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const idField = useRef<HTMLInputElement>(null);
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("proposed");
  const [entry, setEntry] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = () => {
    setId("");
    setTitle("");
    setStatus("proposed");
    setEntry(model.screens[0]?.id ?? "");
    setProblem(null);
    dialog.current?.showModal();
    idField.current?.focus();
  };
  const close = () => dialog.current?.close();

  const submit = async (e: Event) => {
    e.preventDefault();
    const wrong = newFlowProblem({ id, title }, model.flows, model.flowIdPattern);
    if (wrong) {
      setProblem(wrong);
      idField.current?.focus();
      return;
    }
    const flow = id.trim();
    setBusy(true);
    let outcome;
    try {
      outcome = await app.applyEdit([
        { op: "addFlow", flow, value: { title: title.trim(), status, ...(entry ? { entry } : {}) } },
      ]);
    } catch (err) {
      setBusy(false);
      setProblem(`Not added: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setBusy(false);
    if (outcome !== "saved" && outcome !== "pending") {
      setProblem(words(outcome));
      return;
    }
    close();
    navigate({ name: "flowEdit", flow });
  };

  return (
    <>
      <button
        type="button"
        class={`button button--small${dashed ? " button--dashed" : " button--primary"}`}
        ref={opener}
        onClick={show}
      >
        <span aria-hidden="true">+</span> New flow
      </button>
      <dialog class="dialog" ref={dialog} aria-labelledby="new-flow-title" onClose={() => opener.current?.focus()}>
        <form class="dialog__form" onSubmit={(e) => void submit(e)} noValidate>
          <h2 id="new-flow-title" class="dialog__title">
            New flow
          </h2>
          <label class="field">
            <span>ID</span>
            <input
              ref={idField}
              type="text"
              value={id}
              autocomplete="off"
              spellcheck={false}
              placeholder="add-activity"
              aria-describedby="new-flow-id-hint"
              aria-invalid={problem ? "true" : undefined}
              onInput={(e) => setId(e.currentTarget.value)}
            />
            <small class="field__hint" id="new-flow-id-hint">
              Names the file, flows/ID.md: lower-case letters, digits and hyphens.
            </small>
          </label>
          <label class="field">
            <span>Title</span>
            <input type="text" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.currentTarget.value)}>
              <option value="proposed">proposed</option>
              <option value="shipped">shipped</option>
            </select>
          </label>
          <label class="field">
            <span>Entry screen</span>
            <select value={entry} onChange={(e) => setEntry(e.currentTarget.value)}>
              {model.screens.length === 0 ? <option value="">(no screens yet)</option> : null}
              {model.screens.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}
                </option>
              ))}
            </select>
          </label>
          {problem ? (
            <p class="dialog__problem" role="alert">
              {problem}
            </p>
          ) : null}
          <div class="dialog__actions">
            <button type="button" class="button button--small" onClick={close}>
              Cancel
            </button>
            <button type="submit" class="button button--primary button--small" disabled={busy}>
              Add flow
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
