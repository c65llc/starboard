// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Review Focus 1: diagnostics follow the editor's text, not the file on
// disk. A screen's area set to one starboard.yaml does not list, in the
// buffer and unsaved, brings unknown-area within 2 s; reverting clears it,
// and so does closing the buffer without saving, back to the disk's state.

import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as vscode from "vscode";

import { misplace, SCREENS, UNKNOWN_AREA } from "../../fixtures/fixtures.ts";
import { api, fileIn, rule, starboard, waitFor } from "./helpers.ts";

const workspace = process.env["STARBOARD_WORKSPACE"] ?? "";
const screens = fileIn(workspace, SCREENS);

/** edit opens screens.yaml and misplaces a screen's area in the buffer, unsaved; it returns that line. */
async function edit(): Promise<number> {
  const doc = await vscode.workspace.openTextDocument(screens);
  const editor = await vscode.window.showTextDocument(doc);
  const { text, line } = misplace(doc.getText());
  const whole = new vscode.Range(0, 0, doc.lineCount, 0);
  assert.ok(await editor.edit((e) => e.replace(whole, text)));
  assert.ok(doc.isDirty);
  return line;
}

const hasUnknownArea = () => starboard(screens).some((d) => rule(d) === UNKNOWN_AREA);

describe("diagnostics as you type (Review Focus 1)", () => {
  before(async () => {
    await api();
  });

  it("starts clean: the example lints clean", () => {
    assert.deepEqual(starboard(screens), []);
  });

  it("an area misplaced in the unsaved buffer is a finding within 2 s, on its line, linked to its rule page", async () => {
    const disk = readFileSync(screens.fsPath, "utf8");
    const line = await edit();
    const took = await waitFor(UNKNOWN_AREA, hasUnknownArea, 2_000);
    assert.ok(took < 2_000, `took ${took} ms`);

    const d = starboard(screens).find((x) => rule(x) === UNKNOWN_AREA);
    assert.ok(d);
    assert.equal(d.severity, vscode.DiagnosticSeverity.Error);
    assert.equal(d.range.start.line, line);
    assert.equal(d.range.start.character, 0, "the whole line");
    assert.equal(d.range.end.line, line);
    assert.ok(typeof d.code === "object");
    assert.equal(d.code.target.toString(), `https://starboard.c65llc.com/rules/${UNKNOWN_AREA}/`);
    assert.equal(readFileSync(screens.fsPath, "utf8"), disk, "the disk is untouched");
  });

  it("reverting the buffer without saving clears it", async () => {
    await vscode.commands.executeCommand("workbench.action.files.revert");
    await waitFor(`${UNKNOWN_AREA} to clear`, () => !hasUnknownArea(), 2_000);
  });

  it("closing the buffer without saving returns to the disk's findings", async () => {
    await edit();
    await waitFor(UNKNOWN_AREA, hasUnknownArea, 2_000);
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    await waitFor(`${UNKNOWN_AREA} to clear`, () => !hasUnknownArea(), 2_000);
    assert.deepEqual(starboard(screens), []);
  });
});
