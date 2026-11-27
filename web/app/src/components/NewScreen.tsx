// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// New screen: a button and a modal <dialog> (the browser keeps focus
// inside it and closes it on Escape; focus goes back to the button). The
// ID is checked against core's own form (model.idPattern) before the
// addScreen edit runs; once saved, the editor opens the new screen.

import { useRef, useState } from "preact/hooks";
import type { Model } from "@c65llc/starboard-core";

import { navigate } from "../router.ts";
import { edit, selectRegion, words } from "../screens/editor.ts";
import { newScreenProblem } from "../screens/logic.ts";

export function NewScreen({ model }: { model: Model }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const idField = useRef<HTMLInputElement>(null);
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [presentation, setPresentation] = useState("push");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = () => {
    setId("");
    setTitle("");
    setArea(model.areas[0] ?? "");
    setPresentation(model.presentations.includes("push") ? "push" : (model.presentations[0] ?? ""));
    setProblem(null);
    dialog.current?.showModal();
    idField.current?.focus();
  };
  const close = () => dialog.current?.close();

  const submit = async (e: Event) => {
    e.preventDefault();
    const wrong = newScreenProblem({ id, title }, model.screens, model.idPattern);
    if (wrong) {
      setProblem(wrong);
      idField.current?.focus();
      return;
    }
    const screen = id.trim();
    setBusy(true);
    const outcome = await edit([
      { op: "addScreen", value: { id: screen, title: title.trim(), area: area.trim(), presentation } },
    ]);
    setBusy(false);
    if (outcome !== "saved" && outcome !== "pending") {
      setProblem(words(outcome));
      return;
    }
    close();
    selectRegion(screen);
    navigate({ name: "screens", screen });
  };

  return (
    <>
      <button type="button" class="button button--primary button--small" ref={opener} onClick={show}>
        New screen
      </button>
      <dialog
        class="dialog"
        ref={dialog}
        aria-labelledby="new-screen-title"
        onClose={() => opener.current?.focus()}
      >
        <form class="dialog__form" onSubmit={(e) => void submit(e)} noValidate>
          <h2 id="new-screen-title" class="dialog__title">
            New screen
          </h2>
          <label class="field">
            <span>ID</span>
            <input
              ref={idField}
              type="text"
              value={id}
              autocomplete="off"
              spellcheck={false}
              placeholder="area.name"
              aria-describedby="new-screen-id-hint"
              aria-invalid={problem ? "true" : undefined}
              onInput={(e) => setId(e.currentTarget.value)}
            />
            <small class="field__hint" id="new-screen-id-hint">
              Such as trip.timeline: dotted, lower-case.
            </small>
          </label>
          <label class="field">
            <span>Title</span>
            <input type="text" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
          </label>
          {model.areas.length > 0 ? (
            <label class="field">
              <span>Area</span>
              <select value={area} onChange={(e) => setArea(e.currentTarget.value)}>
                {model.areas.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label class="field">
              <span>Area</span>
              <input type="text" value={area} onInput={(e) => setArea(e.currentTarget.value)} />
            </label>
          )}
          <label class="field">
            <span>Presentation</span>
            <select value={presentation} onChange={(e) => setPresentation(e.currentTarget.value)}>
              {model.presentations.map((p) => (
                <option key={p} value={p}>
                  {p}
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
              Add screen
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
