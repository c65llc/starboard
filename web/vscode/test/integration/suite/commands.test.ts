// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// New screen, New flow and Fix from the editor, on a copy of the travel
// app of this suite's own. The dialogs are scripted (Commands.ui). What
// they write must be exactly core's result: New screen's screens.yaml is
// what core.edit, which the CLI runs too, makes of the files on disk. A
// write lands in an open, dirty buffer and not on the disk beneath it; a
// buffer that changed after the command read it stops the write; and
// applyCoreResult refuses a change core would never make.

import * as assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import * as vscode from "vscode";

import type { EditOp } from "@c65llc/starboard-core";

import { SCREENS } from "../../fixtures/fixtures.ts";
import type { Choice, Ui } from "../../../src/commands.ts";
import type { Project } from "../../../src/projects.ts";
import { applyCoreResult } from "../../../src/write.ts";
import { api, fileIn } from "./helpers.ts";

const root = process.env["STARBOARD_WORKSPACE"] ?? "";
const screens = fileIn(root, SCREENS);
const NEW_FLOW = "docs/flows/flows/plan-a-day.md";
const STALE = "docs/flows/generated/wireframes/gone.phone.svg";

/** The addScreen op the New screen answers below make, as NewScreen.tsx sends it. */
const ADD_RESET: EditOp = {
  op: "addScreen",
  value: { id: "auth.reset", title: "Reset password", area: "auth", presentation: "push" },
};

/** An answer: the text or label to give, and anything to do first (the user typing meanwhile). */
interface Answer {
  value: string;
  before?: () => Promise<void>;
}

/**
 * Scripted is a Ui that gives the answers in order. An input's answer must
 * pass its validation; invalid lists answers that must not, each checked
 * against the first input. It keeps the messages it was shown.
 */
class Scripted implements Ui {
  readonly infos: string[] = [];
  readonly errors: string[] = [];
  private readonly answers: Answer[];
  private readonly invalid: { value: string; says: RegExp }[];

  constructor(answers: (string | Answer)[], invalid: { value: string; says: RegExp }[] = []) {
    this.answers = answers.map((a) => (typeof a === "string" ? { value: a } : a));
    this.invalid = invalid;
  }

  private async next(): Promise<string> {
    const a = this.answers.shift();
    if (!a) throw new Error("the command asked more than the script answers");
    await a.before?.();
    return a.value;
  }

  async input(o: { title: string; prompt: string; validate?: (v: string) => string | undefined }): Promise<string | undefined> {
    // The first input is the ID: each invalid answer is checked against it.
    for (const bad of this.invalid.splice(0)) assert.match(o.validate?.(bad.value) ?? "", bad.says, `${o.prompt}: ${bad.value}`);
    const v = await this.next();
    assert.equal(o.validate?.(v), undefined, `${o.prompt}: ${v} should be valid`);
    return v;
  }

  async pickOne<T>(items: Choice<T>[]): Promise<Choice<T> | undefined> {
    const v = await this.next();
    const found = items.find((i) => i.label === v);
    assert.ok(found, `no item ${v} among ${items.map((i) => i.label).join(", ")}`);
    return found;
  }

  info(message: string): void {
    this.infos.push(message);
  }

  error(message: string): void {
    this.errors.push(message);
  }
}

let project: Project;
let starboardApi: Awaited<ReturnType<typeof api>>;

function onDisk(rel: string): string {
  return readFileSync(fileIn(root, rel).fsPath, "utf8");
}

async function openScreens(): Promise<vscode.TextEditor> {
  return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(screens), { preview: false });
}

/** typeAtTop puts text at the start of the editor's document, unsaved. */
async function typeAtTop(editor: vscode.TextEditor, text: string): Promise<void> {
  assert.ok(await editor.edit((e) => e.insert(new vscode.Position(0, 0), text)));
}

/** restore puts screens.yaml back to text, buffer and disk, and closes every editor. */
async function restore(text: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(screens);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(screens, new vscode.Range(new vscode.Position(0, 0), doc.lineAt(doc.lineCount - 1).range.end), text);
  assert.ok(await vscode.workspace.applyEdit(edit));
  assert.ok(await doc.save());
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  assert.equal(onDisk(SCREENS), text);
}

async function run(command: string, ui: Scripted): Promise<void> {
  starboardApi.commands.ui = ui;
  await vscode.commands.executeCommand(command);
}

describe("New screen, New flow, Format and Fix", () => {
  let original: string;

  before(async () => {
    starboardApi = await api();
    const found = starboardApi.projects.all()[0];
    assert.ok(found);
    project = found;
    original = onDisk(SCREENS);
  });

  afterEach(async () => {
    await restore(original);
  });

  it("New screen writes the screens.yaml core.edit makes of the disk, and opens it at the screen", async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    assert.deepEqual(project.host.overlaid(), []);
    const { files } = await project.host.readAll();
    const golden = (await project.core.edit(files, [ADD_RESET])).files[SCREENS];
    assert.ok(golden?.includes("auth.reset:"));

    const ui = new Scripted(["auth.reset", "Reset password", "auth", "push"], [
      { value: "Auth Reset", says: /not a screen ID/ },
      { value: "auth.sign-in", says: /already exists/ },
    ]);
    await run("starboard.newScreen", ui);
    assert.deepEqual(ui.errors, []);
    assert.equal(onDisk(SCREENS), golden);

    const editor = vscode.window.activeTextEditor;
    assert.equal(editor?.document.uri.toString(), screens.toString());
    assert.equal(editor?.document.isDirty, false);
    const line = editor.document.getText().split("\n").findIndex((l) => l === "  auth.reset:");
    assert.ok(line >= 0);
    assert.equal(editor.selection.active.line, line);
  });

  it("New flow writes the flow file NewFlow.tsx writes, and opens it", async () => {
    const model = await project.model();
    const entry = model.screens[0]?.id;
    assert.ok(entry);
    const ui = new Scripted(["plan-a-day", "Plan a day"], [
      { value: "Plan a day", says: /lower-case letters/ },
    ]);
    try {
      await run("starboard.newFlow", ui);
      assert.deepEqual(ui.errors, []);
      assert.equal(
        onDisk(NEW_FLOW),
        `---\nid: plan-a-day\ntitle: Plan a day\nstatus: proposed\nentry: ${entry}\n---\n\n## Steps\n`,
      );
      assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), fileIn(root, NEW_FLOW).toString());
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      rmSync(fileIn(root, NEW_FLOW).fsPath, { force: true });
    }
  });

  it("New screen, with screens.yaml open and dirty, changes the buffer and not the disk", async () => {
    const editor = await openScreens();
    await typeAtTop(editor, "# a draft\n");
    await run("starboard.newScreen", new Scripted(["auth.reset", "Reset password", "auth", "push"]));
    const doc = editor.document;
    assert.ok(doc.getText().includes("auth.reset:"), "the new screen is in the buffer");
    assert.ok(doc.getText().startsWith("# a draft\n"), "the draft is kept");
    assert.equal(doc.isDirty, true);
    assert.equal(onDisk(SCREENS), original);
  });

  it("New screen refuses when the buffer changed after the command read it, and writes nothing", async () => {
    const editor = await openScreens();
    const ui = new Scripted([
      "auth.reset",
      "Reset password",
      "auth",
      { value: "push", before: () => typeAtTop(editor, "# meanwhile\n") },
    ]);
    await run("starboard.newScreen", ui);
    assert.equal(ui.errors.length, 1, JSON.stringify(ui.errors));
    assert.match(ui.errors[0] ?? "", /changed/);
    assert.equal(editor.document.getText(), `# meanwhile\n${original}`);
    assert.equal(onDisk(SCREENS), original);
  });

  it("applyCoreResult refuses when a checked document changes before the apply, and writes nothing", async () => {
    const editor = await openScreens();
    const { files } = await project.host.readAll();
    const formatted = `${original}# formatted\n`;
    await assert.rejects(
      applyCoreResult(project, { [SCREENS]: formatted }, files, { checked: () => typeAtTop(editor, "# typed meanwhile\n") }),
      /changed/,
    );
    assert.equal(editor.document.getText(), `# typed meanwhile\n${original}`);
    assert.equal(onDisk(SCREENS), original);
  });

  it("Fix removes a stale generated page", async () => {
    const stale = fileIn(root, STALE).fsPath;
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, "<svg/>\n");
    const ui = new Scripted([]);
    await run("starboard.fix", ui);
    assert.deepEqual(ui.errors, []);
    assert.equal(existsSync(stale), false);
  });

  it("applyCoreResult refuses a deletion outside generated/ and a path outside the project", async () => {
    const { files } = await project.host.readAll();
    await assert.rejects(applyCoreResult(project, { "starboard.yaml": null }, files), /deletes only generated pages/);
    assert.ok(existsSync(fileIn(root, "starboard.yaml").fsPath));
    await assert.rejects(applyCoreResult(project, { "../outside.md": "x" }, files), /not a path inside the project/);
    assert.equal(existsSync(fileIn(root, "../outside.md").fsPath), false);
    await assert.rejects(applyCoreResult(project, { "src/web/x.md": "x" }, files), /content/);
    assert.equal(existsSync(fileIn(root, "src/web/x.md").fsPath), false);
  });
});
