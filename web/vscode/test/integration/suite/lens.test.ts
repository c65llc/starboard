// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// CodeLens over the files a screen lists: src/android/SignInScreen.kt is
// auth.sign-in's, so it shows one lens on line 0, which opens the screen's
// panel; a file no screen lists
// shows none; and taking the path out of screens.yaml removes the lens
// (the file is put back after).

import * as assert from "node:assert/strict";

import * as vscode from "vscode";

import { SCREENS } from "../../fixtures/fixtures.ts";
import { api, fileIn, sleep } from "./helpers.ts";

const root = process.env["STARBOARD_WORKSPACE"] ?? "";
const impl = fileIn(root, "src/android/SignInScreen.kt");
const screens = fileIn(root, SCREENS);

async function lenses(uri: vscode.Uri): Promise<vscode.CodeLens[]> {
  // The command answers for an open text model only.
  await vscode.workspace.openTextDocument(uri);
  const found = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", uri);
  return found.filter((l) => l.command?.title.startsWith("Starboard: "));
}

describe("CodeLens over implementation files", () => {
  before(async () => {
    await api();
  });

  it("shows one lens on line 0 over a file a screen lists", async () => {
    const found = await lenses(impl);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0]?.command?.title, "Starboard: auth.sign-in");
    assert.equal(found[0]?.range.start.line, 0);
    // It opens the screen's panel, in the project of starboard.yaml.
    assert.equal(found[0]?.command?.command, "starboard.openScreen");
    assert.equal(found[0]?.command?.arguments?.[0], "auth.sign-in");
    assert.equal(found[0]?.command?.arguments?.[1], fileIn(root, "starboard.yaml").toString());
  });

  it("shows none over a file no screen lists", async () => {
    assert.deepEqual(await lenses(fileIn(root, "starboard.yaml")), []);
  });

  it("loses the lens when screens.yaml stops listing the path", async () => {
    const doc = await vscode.workspace.openTextDocument(screens);
    const editor = await vscode.window.showTextDocument(doc);
    const original = doc.getText();
    try {
      const at = original.indexOf("[src/android/SignInScreen.kt]");
      assert.ok(at >= 0);
      const range = new vscode.Range(doc.positionAt(at), doc.positionAt(at + "[src/android/SignInScreen.kt]".length));
      assert.ok(await editor.edit((e) => e.replace(range, "[]")));
      assert.ok(await doc.save());
      let found = await lenses(impl);
      for (let i = 0; i < 80 && found.length > 0; i++) {
        await sleep(25);
        found = await lenses(impl);
      }
      assert.deepEqual(found, []);
    } finally {
      const whole = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
      const restore = new vscode.WorkspaceEdit();
      restore.replace(screens, whole, original);
      await vscode.workspace.applyEdit(restore);
      await doc.save();
    }
  });
});
