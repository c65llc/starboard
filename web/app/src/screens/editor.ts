// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The screen editor's own state, beside the app's: which form factor and
// tab are showing, where screens.yaml is, and the last save's outcome in
// words. Every change still goes through app.applyEdit, applyChanges or
// applyFix; run reports what each outcome means for the user.

import { effect, signal } from "@preact/signals";
import type { EditOp, Screen } from "@c65llc/starboard-core";

import { getCore } from "../core.ts";
import { DEFAULT_CONTENT } from "../host/host.ts";
import { navigate } from "../router.ts";
import type { EditOutcome } from "../state.ts";
import { app } from "../store.ts";
import { placeTarget } from "./logic.ts";
import type { Target } from "./logic.ts";

/** The form factor chosen for a screen; another screen starts on its first. */
export const chosen = signal<{ screen: string; formFactor: string } | null>(null);

/** Which of the view's tabs shows: the wireframe of a form factor, or the source. */
export const tab = signal<"layout" | "source">("layout");

/** A line of screens.yaml for the Source tab to show and put the cursor on, set by a lint finding. */
export const sourceLine = signal<number | null>(null);

/** The last change's outcome, as the status line says it. */
export const saveStatus = signal<string | null>(null);

/** The project-relative path of screens.yaml, as core.scope finds the content root. */
export const registryPath = signal(`${DEFAULT_CONTENT}/screens.yaml`);

effect(() => {
  const files = app.files.value;
  if (!files["starboard.yaml"]) return;
  getCore()
    .scope(files)
    .then((s) => {
      registryPath.value = s.content === "." || s.content === "" ? "screens.yaml" : `${s.content}/screens.yaml`;
    })
    .catch(() => undefined); // starboard.yaml does not parse: lint says so, and the default stands
});

/** formFactorOf is the form factor showing for s. */
export function formFactorOf(s: Screen): string {
  const c = chosen.value;
  if (c && c.screen === s.id && s.formFactors.includes(c.formFactor)) return c.formFactor;
  return s.formFactors[0] ?? "";
}

/** words says what an edit's outcome means for the change. */
export function words(outcome: EditOutcome): string {
  switch (outcome) {
    case "saved":
      return "Saved · formatted";
    case "pending":
      return "Change kept for download";
    case "reloaded":
      return "Not saved: the file changed on disk, so it was reloaded. Make the change again.";
    case "failed":
      return "Not saved: the folder refused the write. Save again from the notice.";
    case "discarded":
      return "Not saved: the project was reloaded before the change was written.";
  }
}

/** run waits for a change and puts its outcome in the status line. */
export async function run(change: Promise<EditOutcome>): Promise<EditOutcome> {
  saveStatus.value = "Saving…";
  try {
    const outcome = await change;
    saveStatus.value = words(outcome);
    return outcome;
  } catch (err) {
    saveStatus.value = `Not saved: ${err instanceof Error ? err.message : String(err)}`;
    return "failed";
  }
}

/** edit applies ops through core and reports the outcome. */
export function edit(ops: EditOp[]): Promise<EditOutcome> {
  return run(app.applyEdit(ops));
}

/** selectRegion selects the region at path of screen, or only the screen when path is undefined. */
export function selectRegion(screen: string, path?: string): void {
  app.selection.value = path === undefined ? { screen } : { screen, region: path };
}

/**
 * goTo shows what a lint finding is about: its screen, on the form factor
 * whose layout holds its region, with the region selected (or only the
 * screen, when no form factor draws that layout: placeTarget); or its flow.
 */
export function goTo(target: Target): void {
  if (target.kind === "none") return;
  if (target.kind === "flow") {
    navigate({ name: "flowEdit", flow: target.flow });
    return;
  }
  if (target.kind === "source") {
    // The lint panel sits in the screen editor, so only the tab changes.
    tab.value = "source";
    sourceLine.value = target.line ?? null;
    return;
  }
  const s = app.model.value?.screens.find((x) => x.id === target.screen);
  let region = target.region;
  if (s) {
    const place = placeTarget(s, formFactorOf(s), target);
    chosen.value = { screen: s.id, formFactor: place.formFactor };
    region = place.region;
  }
  tab.value = "layout";
  selectRegion(target.screen, region);
  navigate({ name: "screens", screen: target.screen });
}
