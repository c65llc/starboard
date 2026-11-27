// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// One flow open in the editor: the body being edited, the front matter
// fields' drafts, the live findings, and saving. A save sends writeFlowBody
// and setFlowMeta through app.applyEdit, on ⌘/Ctrl-S or after 1.5 s idle;
// the app's queue runs saves one at a time, so none is held back here.
//
// The editor follows the file: after a save it shows core's formatted text
// unless the user typed on meanwhile; after a fresh read of the folder
// (app.reads: a reload because the file changed on disk) it shows the file
// as it now is and drops the drafts, which were of a version that is gone.
// A save queued before that reload is discarded by the queue, so the next
// save starts from the outside change instead of overwriting it.

import { batch, computed, signal } from "@preact/signals";
import type { Diagnostic, EditOp } from "@c65llc/starboard-core";

import { getCore } from "../core.ts";
import { words } from "../screens/editor.ts";
import type { EditOutcome } from "../state.ts";
import { app } from "../store.ts";
import { bodyMarks, saveOps, splitFlow } from "./body.ts";
import type { BodyMark, MetaDrafts, MetaKey } from "./body.ts";
import type { FlowView } from "./codemirror.ts";

/** How long the editor waits after the last keystroke before it saves. */
export const AUTOSAVE_MS = 1500;

export interface Findings {
  marks: BodyMark[];
  /** The file's findings that are not on a body line: the front matter, the whole file. */
  outside: Diagnostic[];
}

export class FlowSession {
  readonly flow: string;
  readonly path: string;
  /** The body as the editor holds it now. */
  readonly body = signal("");
  /** The front matter fields as typed, where they differ from the file. */
  readonly drafts = signal<MetaDrafts>({});
  /** The base the editor's text is a draft of: the file's body when last followed. */
  private readonly base = signal("");
  readonly findings = signal<Findings>({ marks: [], outside: [] });
  /** The last save's outcome in words, or "Saving…". */
  readonly status = signal<string | null>(null);
  readonly dirty = computed(() => this.body.value !== this.base.value || Object.keys(this.drafts.value).length > 0);

  private view: FlowView | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sent: string | null = null;
  private seenReads = -1;

  constructor(flow: string, path: string) {
    this.flow = flow;
    this.path = path;
  }

  /** attach gives the session its editor, once CodeMirror has loaded. */
  attach(view: FlowView): void {
    this.view = view;
    view.set(this.body.value, true);
  }

  /** sync follows the file as app.files holds it (text) after the reads-th read of the folder. */
  sync(text: string | undefined, reads: number): void {
    const next = splitFlow(text ?? "").body;
    if (reads !== this.seenReads) {
      this.seenReads = reads;
      this.sent = null;
      clearTimeout(this.timer);
      this.timer = undefined;
      this.drafts.value = {};
      this.show(next, true, true);
      return;
    }
    if (next === this.base.value) return;
    const current = this.body.value;
    this.show(next, current === this.sent || current === this.base.value);
  }

  /** show makes next the base, and the editor's text too when replace (at once when force). */
  private show(next: string, replace: boolean, force = false): void {
    batch(() => {
      this.base.value = next;
      if (replace) this.body.value = next;
    });
    if (replace) this.view?.set(next, force);
  }

  /** edited takes the editor's new text and schedules a save. */
  edited(body: string): void {
    this.body.value = body;
    this.schedule();
  }

  /** setMeta takes a field's new value and schedules a save. */
  setMeta(key: MetaKey, value: string): void {
    this.drafts.value = { ...this.drafts.value, [key]: value };
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), AUTOSAVE_MS);
  }

  /** ops is what saving now would send. */
  ops(): EditOp[] {
    const flow = app.model.value?.flows.find((f) => f.id === this.flow);
    if (!flow) return [];
    return saveOps(flow, app.files.value[this.path] ?? "", this.body.value, this.drafts.value);
  }

  /** save sends the body and the fields that changed, through the app's queue. */
  async save(): Promise<EditOutcome | null> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const ops = this.ops();
    if (ops.length === 0) {
      // Fields typed back to what the file holds are no longer drafts.
      if (Object.keys(this.drafts.value).length > 0) this.drafts.value = {};
      return null;
    }
    const body = this.body.value;
    const meta = this.drafts.value;
    this.sent = body;
    this.status.value = "Saving…";
    let outcome: EditOutcome;
    try {
      outcome = await app.applyEdit(ops);
      this.status.value = words(outcome);
    } catch (err) {
      this.status.value = `Not saved: ${err instanceof Error ? err.message : String(err)}`;
      return "failed";
    } finally {
      if (this.sent === body) this.sent = null;
    }
    if (outcome === "saved" || outcome === "pending") {
      // The fields saved as typed now come from the file.
      const left = Object.entries(this.drafts.value).filter(([key, v]) => meta[key as MetaKey] !== v);
      this.drafts.value = Object.fromEntries(left) as MetaDrafts;
    }
    return outcome;
  }

  /** lint lints the project with body in place of the file's, and keeps this file's findings. */
  async lint(body: string): Promise<BodyMark[]> {
    const files = app.files.value;
    const { head, bodyLine } = splitFlow(files[this.path] ?? "");
    const result = await getCore().lint({ ...files, [this.path]: head + body });
    const found = bodyMarks(result.diagnostics, this.path, bodyLine, body);
    this.findings.value = found;
    return found.marks;
  }

  /** relint lints again, as when another file of the project changed. */
  relint(): void {
    this.view?.relint();
  }

  reveal(line: number): void {
    this.view?.reveal(line);
  }

  /** close saves a change still waiting for its autosave, and lets the editor go. */
  close(): void {
    if (this.timer !== undefined) void this.save();
    this.view = null;
  }
}
