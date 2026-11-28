// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// New screen, New flow, Format and Fix from the editor. Each reads the
// project as the editor holds it (unsaved buffers laid over the disk),
// asks its questions against that read, has core work out the change on
// it, and writes exactly core's result through applyCoreResult (write.ts),
// which refuses it if a file changed since the read. The questions and
// their checks are the web app's dialogs': NewScreen.tsx (newScreenProblem
// against core's idPattern) and NewFlow.tsx (newFlowProblem against
// core's flowIdPattern), and the ops are the ones they send.

import * as vscode from "vscode";

import type { EditOp, Files } from "@c65llc/starboard-core";
import { newFlowProblem } from "@c65llc/starboard-app/src/flows/body.ts";
import { newScreenProblem } from "@c65llc/starboard-app/src/screens/logic.ts";

import type { Project, Projects } from "./projects.ts";
import { screenLocation } from "./refs.ts";
import { applyCoreResult } from "./write.ts";

export const NEW_SCREEN_COMMAND = "starboard.newScreen";
export const NEW_FLOW_COMMAND = "starboard.newFlow";
export const FORMAT_COMMAND = "starboard.format";
export const FIX_COMMAND = "starboard.fix";

/** One item of a quick pick, and what picking it means. */
export interface Choice<T = string> {
  label: string;
  description?: string;
  value: T;
}

/** The dialogs a command shows; the integration tests swap in scripted ones. */
export interface Ui {
  /** An input box; validate says what is wrong with a value, or undefined. undefined when dismissed. */
  input(o: { title: string; prompt: string; placeHolder?: string; validate?: (v: string) => string | undefined }): Promise<string | undefined>;
  /** A quick pick of one item; undefined when dismissed. */
  pickOne<T>(items: Choice<T>[], o: { title: string; placeHolder: string }): Promise<Choice<T> | undefined>;
  info(message: string): void;
  error(message: string): void;
}

/** windowUi is Ui on VS Code's own input boxes, quick picks and notifications. */
export const windowUi: Ui = {
  input: (o) =>
    Promise.resolve(
      vscode.window.showInputBox({
        title: o.title,
        prompt: o.prompt,
        ignoreFocusOut: true,
        ...(o.placeHolder !== undefined ? { placeHolder: o.placeHolder } : {}),
        ...(o.validate ? { validateInput: o.validate } : {}),
      }),
    ),
  pickOne: (items, o) => Promise.resolve(vscode.window.showQuickPick(items, { title: o.title, placeHolder: o.placeHolder, ignoreFocusOut: true })),
  info: (message) => void vscode.window.showInformationMessage(message),
  error: (message) => void vscode.window.showErrorMessage(message),
};

/** A project's files as one read of it found them. */
interface Read {
  files: Files;
}

function message(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

export class Commands implements vscode.Disposable {
  /** The dialogs; the integration tests swap in scripted ones. */
  ui: Ui;
  private readonly projects: Projects;
  private readonly registration: vscode.Disposable;

  constructor(projects: Projects, ui: Ui = windowUi) {
    this.projects = projects;
    this.ui = ui;
    this.registration = vscode.Disposable.from(
      vscode.commands.registerCommand(NEW_SCREEN_COMMAND, () => this.newScreen()),
      vscode.commands.registerCommand(NEW_FLOW_COMMAND, () => this.newFlow()),
      vscode.commands.registerCommand(FORMAT_COMMAND, () => this.format()),
      vscode.commands.registerCommand(FIX_COMMAND, () => this.fix()),
    );
  }

  dispose(): void {
    this.registration.dispose();
  }

  /** projectOf is the active editor's project, or the only one, or the one picked. */
  async projectOf(): Promise<Project | undefined> {
    const at = vscode.window.activeTextEditor?.document.uri;
    const found = at ? this.projects.projectFor(at) : undefined;
    if (found) return found;
    const all = this.projects.all();
    if (all.length <= 1) return all[0];
    const picked = await this.ui.pickOne(
      all.map((p) => ({ label: vscode.workspace.asRelativePath(p.root, true) || p.root.fsPath, value: p })),
      { title: "Starboard project", placeHolder: "Which project?" },
    );
    return picked?.value;
  }

  // --- New screen ------------------------------------------------------

  async newScreen(): Promise<void> {
    await this.withProject("add the screen", async (project, read) => {
      const model = await project.core.model(read.files);
      const title = "Starboard: New screen";
      const id = await this.ui.input({
        title,
        prompt: "ID: dotted, lower-case, such as trip.timeline",
        placeHolder: "area.name",
        // newScreenProblem checks the title last; the title is asked next.
        validate: (v) => newScreenProblem({ id: v, title: "-" }, model.screens, model.idPattern) ?? undefined,
      });
      if (id === undefined) return;
      const name = await this.ui.input({ title, prompt: "Title", validate: (v) => (v.trim() === "" ? "Enter a title." : undefined) });
      if (name === undefined) return;
      let area: string | undefined;
      if (model.areas.length > 0) {
        area = (await this.ui.pickOne(model.areas.map((a) => ({ label: a, value: a })), { title, placeHolder: "Area" }))?.value;
      } else {
        area = await this.ui.input({ title, prompt: "Area" });
      }
      if (area === undefined) return;
      // push first, as the web app's dialog starts on it.
      const presentations = [...model.presentations].sort((a, b) => Number(b === "push") - Number(a === "push"));
      const presentation = await this.ui.pickOne(presentations.map((p) => ({ label: p, value: p })), { title, placeHolder: "Presentation" });
      if (!presentation) return;
      const screen = id.trim();
      const op: EditOp = {
        op: "addScreen",
        value: { id: screen, title: name.trim(), area: area.trim(), presentation: presentation.value },
      };
      const changed = await this.edit(project, read, [op]);
      const after = await project.core.model({ ...read.files, ...changed });
      const found = after.screens.find((s) => s.id === screen);
      const at = found ? await screenLocation(project, after, found) : undefined;
      if (at) await vscode.window.showTextDocument(at.uri, { preview: false, selection: new vscode.Range(at.range.start, at.range.start) });
      this.ui.info(`Added ${screen}.`);
    });
  }

  // --- New flow --------------------------------------------------------

  async newFlow(): Promise<void> {
    await this.withProject("add the flow", async (project, read) => {
      const model = await project.core.model(read.files);
      const title = "Starboard: New flow";
      const id = await this.ui.input({
        title,
        prompt: "ID: names the file, flows/ID.md: lower-case letters, digits and hyphens",
        placeHolder: "add-activity",
        // newFlowProblem checks the title last; the title is asked next.
        validate: (v) => newFlowProblem({ id: v, title: "-" }, model.flows, model.flowIdPattern) ?? undefined,
      });
      if (id === undefined) return;
      const name = await this.ui.input({ title, prompt: "Title", validate: (v) => (v.trim() === "" ? "Enter a title." : undefined) });
      if (name === undefined) return;
      const flow = id.trim();
      // The web app's dialog starts on status proposed and the first screen as the entry.
      const entry = model.screens[0]?.id ?? "";
      const op: EditOp = { op: "addFlow", flow, value: { title: name.trim(), status: "proposed", ...(entry ? { entry } : {}) } };
      const changed = await this.edit(project, read, [op]);
      const file = Object.keys(changed).find((p) => !Object.hasOwn(read.files, p)) ?? Object.keys(changed)[0];
      if (file) await vscode.window.showTextDocument(vscode.Uri.joinPath(project.root, ...file.split("/")), { preview: false });
      this.ui.info(`Added ${flow}.`);
    });
  }

  // --- Format and Fix --------------------------------------------------

  async format(): Promise<void> {
    await this.withProject("format the project", async (project, read) => {
      const changes = await project.core.format(read.files);
      const n = Object.keys(changes).length;
      if (n === 0) return this.ui.info("Every file is already formatted.");
      await applyCoreResult(project, changes, read.files);
      this.ui.info(`Formatted ${n === 1 ? "1 file" : `${n} files`}.`);
    });
  }

  async fix(): Promise<void> {
    await this.withProject("fix the project", async (project, read) => {
      const fixed = await project.core.fix(read.files);
      const changes: Record<string, string | null> = { ...fixed.write };
      for (const path of fixed.remove) changes[path] = null;
      const n = Object.keys(changes).length;
      if (n === 0) return this.ui.info("Nothing to fix automatically.");
      await applyCoreResult(project, changes, read.files);
      this.ui.info(`Fixed ${n === 1 ? "1 file" : `${n} files`}.`);
    });
  }

  // --- Shared steps ----------------------------------------------------

  /**
   * withProject reads the active editor's project as the editor holds it
   * and runs act on that read; an error from any step is shown, saying
   * that Starboard could not do what.
   */
  private async withProject(what: string, act: (project: Project, read: Read) => Promise<void>): Promise<void> {
    const project = await this.projectOf();
    if (!project) return this.ui.info("No Starboard project here: open a folder that holds a starboard.yaml.");
    try {
      await act(project, await project.host.readAll());
    } catch (err) {
      this.ui.error(`Starboard could not ${what}: ${message(err)}`);
    }
  }

  /** edit has core work ops out on read and writes the result; it returns the files changed. */
  private async edit(project: Project, read: Read, ops: EditOp[]): Promise<Record<string, string>> {
    const result = await project.core.edit(read.files, ops);
    await applyCoreResult(project, result.files, read.files);
    return result.files;
  }
}
