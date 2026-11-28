// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Review Focus 2: a workspace of two roots, two Starboard projects, one of
// them in a subfolder. Each starboard.yaml has its own core session, a
// project's findings land on its own files, and a file under no project
// gets nothing, even one that would be a finding inside a project.

import * as assert from "node:assert/strict";
import { dirname, join } from "node:path";

import * as vscode from "vscode";

import { misplace, SCREENS, UNKNOWN_AREA } from "../../fixtures/fixtures.ts";
import { api, fileIn, rule, sleep, starboard, waitFor } from "./helpers.ts";
import type { StarboardApi } from "../../../src/extension.ts";

const root = dirname(process.env["STARBOARD_WORKSPACE"] ?? "");
const one = join(root, "one");
const app = join(root, "two", "app");
const loose = fileIn(root, "two/loose/screens.yaml");

describe("two projects, one in a subfolder (Review Focus 2)", () => {
  let sb: StarboardApi;
  before(async () => {
    sb = await api();
  });

  it("gives each starboard.yaml its own core session", () => {
    const projects = sb.projects.all();
    assert.deepEqual(
      projects.map((p) => p.root.fsPath),
      [vscode.Uri.file(one).fsPath, vscode.Uri.file(app).fsPath],
    );
    assert.notEqual(projects[0]?.core, projects[1]?.core);
  });

  it("puts a file in the nearest project above it, and a file under none in none", () => {
    const at = (uri: vscode.Uri) => sb.projects.projectFor(uri)?.root.fsPath;
    assert.equal(at(fileIn(app, SCREENS)), vscode.Uri.file(app).fsPath);
    assert.equal(at(fileIn(one, SCREENS)), vscode.Uri.file(one).fsPath);
    assert.equal(at(loose), undefined);
    assert.equal(at(fileIn(root, "two/starboard.yaml")), undefined);
  });

  it("lints the project in the subfolder on its own files, the other project clean", async () => {
    const screens = fileIn(app, SCREENS);
    await waitFor("the subfolder project's finding", () => starboard(screens).some((d) => rule(d) === UNKNOWN_AREA), 5_000);
    const others = vscode.languages
      .getDiagnostics()
      .filter(([, ds]) => ds.some((d) => d.source === "starboard"))
      .map(([uri]) => uri.fsPath);
    for (const path of others) assert.ok(path.startsWith(vscode.Uri.file(app).fsPath), `${path} has findings`);
    assert.deepEqual(starboard(fileIn(one, SCREENS)), []);
  });

  it("gives a file under no project nothing, open or dirty", async () => {
    const doc = await vscode.workspace.openTextDocument(loose);
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit((e) => e.insert(new vscode.Position(doc.lineCount, 0), "\n  x.y:\n    area: elsewhere\n"));
    await sb.diagnostics.settled();
    await sleep(500);
    assert.deepEqual(starboard(loose), []);
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });

  it("a buffer edited in one project re-lints that project, and the other keeps its own findings", async () => {
    const screens = fileIn(one, SCREENS);
    const doc = await vscode.workspace.openTextDocument(screens);
    const editor = await vscode.window.showTextDocument(doc);
    const whole = new vscode.Range(0, 0, doc.lineCount, 0);
    await editor.edit((e) => e.replace(whole, misplace(doc.getText()).text));
    await waitFor("the first project's finding", () => starboard(screens).some((d) => rule(d) === UNKNOWN_AREA), 2_000);
    assert.ok(starboard(fileIn(app, SCREENS)).some((d) => rule(d) === UNKNOWN_AREA), "the other project keeps its own");
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    await waitFor("the first project to clear", () => starboard(screens).length === 0, 2_000);
  });
});
