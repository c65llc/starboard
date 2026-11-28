// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Review Focus 3: @auth.sign-in in a .swift comment, with no Swift
// extension installed, still hovers and goes to its definition.

import * as assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import * as vscode from "vscode";

import { api } from "./helpers.ts";

const root = process.env["STARBOARD_WORKSPACE"] ?? "";

describe("a reference in a language VS Code knows nothing about (Review Focus 3)", () => {
  before(async () => {
    await api();
  });

  it("hovers and goes to the definition from a .swift comment", async () => {
    const path = join(root, "SignInView.swift");
    writeFileSync(path, "// Implements @auth.sign-in.\nstruct SignInView {}\n");
    const uri = vscode.Uri.file(path);
    const doc = await vscode.workspace.openTextDocument(uri);
    const pos = doc.positionAt(doc.getText().indexOf("@auth.sign-in") + 4);

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", uri, pos);
    const values = hovers.flatMap((h) => h.contents).map((c) => (typeof c === "string" ? c : c.value));
    assert.ok(values.some((v) => v.includes("auth\\.sign\\-in") && v.includes("Used in")), values.join("\n"));

    const defs = await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeDefinitionProvider", uri, pos);
    const def = defs.find((d) => d.uri.path.endsWith("docs/flows/screens.yaml"));
    assert.ok(def, JSON.stringify(defs));
  });
});
