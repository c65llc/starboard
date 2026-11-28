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

  it("hovers a reference with the screen's card, trusted for Open in Starboard alone", async () => {
    const doc = await vscode.workspace.openTextDocument(flow);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", flow, where(doc, '@auth.sign-in"', 3));
    const card = hovers.flatMap((h) => h.contents).filter((c): c is vscode.MarkdownString => typeof c !== "string");
    const mine = card.find((c) => c.value.includes("auth\\.sign\\-in"));
    assert.ok(mine, text(hovers));
    assert.deepEqual(mine.isTrusted, { enabledCommands: ["starboard.openScreen"] });
    assert.equal(mine.supportHtml, false);
    assert.ok(mine.value.includes("Used in"), mine.value);
    // The last line opens the screen's panel; it is the card's only link.
    const link = /\[Open in Starboard\]\(command:starboard\.openScreen\?([^)]*)\)$/.exec(mine.value);
    assert.ok(link, mine.value);
    assert.equal(mine.value.match(/\]\(/g)?.length, 1, mine.value);
    const [id, at] = JSON.parse(decodeURIComponent(link[1] ?? "")) as [string, string];
    assert.equal(id, "auth.sign-in");
    assert.ok(at.endsWith("/starboard.yaml"), at);
  });

  it("gives an unknown ID no hover and no definition", async () => {
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: "see @nope.nothing here\n" });
    const at = new vscode.Position(0, 7);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", doc.uri, at);
    // The card escapes IDs, so an unknown ID's card would hold nope\.nothing: look for the name, however escaped.
    assert.ok(!/nope/.test(text(hovers)), text(hovers));
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
