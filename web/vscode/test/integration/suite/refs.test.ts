// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Hover, go-to-definition and completion on a flow's @auth.sign-in.

import * as assert from "node:assert/strict";

import * as vscode from "vscode";

import { api, fileIn } from "./helpers.ts";

const root = process.env["STARBOARD_WORKSPACE"] ?? "";
const flow = fileIn(root, "docs/flows/flows/sign-in-and-out.md");

/** where is the position of needle's first occurrence in doc, plus offset characters. */
function where(doc: vscode.TextDocument, needle: string, offset = 0): vscode.Position {
  return doc.positionAt(doc.getText().indexOf(needle) + offset);
}

function text(hovers: vscode.Hover[]): string {
  return hovers
    .flatMap((h) => h.contents)
    .map((c) => (typeof c === "string" ? c : c.value))
    .join("\n");
}

describe("references in a flow's Markdown", () => {
  before(async () => {
    await api();
  });

  it("hovers a reference with the screen's card, untrusted", async () => {
    const doc = await vscode.workspace.openTextDocument(flow);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", flow, where(doc, '@auth.sign-in"', 3));
    const card = hovers.flatMap((h) => h.contents).filter((c): c is vscode.MarkdownString => typeof c !== "string");
    const mine = card.find((c) => c.value.includes("auth\\.sign\\-in"));
    assert.ok(mine, text(hovers));
    assert.equal(mine.isTrusted, false);
    assert.equal(mine.supportHtml, false);
    assert.ok(mine.value.includes("Used in"), mine.value);
  });

  it("gives an unknown ID no hover and no definition", async () => {
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: "see @nope.nothing here\n" });
    const at = new vscode.Position(0, 7);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", doc.uri, at);
    assert.ok(!text(hovers).includes("nope.nothing"), text(hovers));
    const defs = await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeDefinitionProvider", doc.uri, at);
    assert.equal(defs.length, 0);
  });

  it("goes to the screen's line in screens.yaml", async () => {
    const doc = await vscode.workspace.openTextDocument(flow);
    const defs = await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeDefinitionProvider", flow, where(doc, '@auth.sign-in"', 3));
    const def = defs.find((d) => d.uri.path.endsWith("docs/flows/screens.yaml"));
    assert.ok(def, JSON.stringify(defs));
    const target = await vscode.workspace.openTextDocument(def.uri);
    assert.match(target.lineAt(def.range.start.line).text, /^\s*auth\.sign-in:/);
  });

  it("completes screen IDs after @ and regions after #, and nothing elsewhere", async () => {
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: "@\n@auth.sign-in#\nemail@domain.com\nplain\n" });
    const items = async (line: number, character: number) =>
      (await vscode.commands.executeCommand<vscode.CompletionList>("vscode.executeCompletionItemProvider", doc.uri, new vscode.Position(line, character))).items;
    const screens = (await items(0, 1)).filter((i) => i.detail !== undefined && i.kind === vscode.CompletionItemKind.Reference);
    assert.ok(screens.some((i) => i.label === "auth.sign-in"), "auth.sign-in is offered");
    const regions = (await items(1, 14)).filter((i) => i.kind === vscode.CompletionItemKind.Reference);
    assert.ok(regions.length > 0 && regions.every((i) => !String(i.label).includes(".")), "regions are offered, not screens");
    assert.equal((await items(2, 16)).filter((i) => i.kind === vscode.CompletionItemKind.Reference).length, 0);
    assert.equal((await items(3, 5)).filter((i) => i.kind === vscode.CompletionItemKind.Reference).length, 0);
  });
});
