// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The panel, on fixtures.panel: Open Screen shows auth.sign-in in a
// webview running web/app's own Screens view, with no Source tab; an edit
// made through the page's state lands in the screens.yaml buffer through
// applyCoreResult; typing in screens.yaml, unsaved, has the page read it
// again; a page that forges a write, or writes a change worked out from
// text the editor has changed since, writes nothing; and after a refused
// write the page reads the project afresh, so its next edit saves.
// What the page rendered, and the outcome of an edit it was asked to
// make, come back in the test-only messages STARBOARD_PANEL_TEST turns on
// (runTest.ts); a forged page is testRequest, which hands the panel a
// message as if its page had sent it.

import * as assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import * as vscode from "vscode";

import { SCREENS } from "../../fixtures/fixtures.ts";
import type { StarboardApi } from "../../../src/extension.ts";
import type { PanelReport } from "../../../src/panel.ts";
import { api, fileIn, waitFor } from "./helpers.ts";

const root = process.env["STARBOARD_WORKSPACE"] ?? "";
const screens = fileIn(root, SCREENS);
const SCREEN = "auth.sign-in";

/** purposeOp sets auth.sign-in's purpose, as the Inspector's Purpose field does. */
function purposeOp(value: string): Record<string, unknown> {
  return { op: "set", screen: SCREEN, path: "", key: "purpose", value };
}

describe("panel", () => {
  let starboard: StarboardApi;
  const reports: PanelReport[] = [];
  let listening: vscode.Disposable | undefined;

  before(async () => {
    starboard = await api();
    listening = starboard.panels.onDidReport((r) => reports.push(r));
  });

  after(() => listening?.dispose());

  /** seen waits for a report that ok holds of, and is it; on a timeout it says what the pages did report. */
  async function seen(what: string, ok: (r: PanelReport) => boolean): Promise<PanelReport> {
    await waitFor(what, () => reports.some(ok), 40_000).catch((err: unknown) => {
      throw new Error(`${err instanceof Error ? err.message : String(err)}; the panels reported ${JSON.stringify(reports)}`);
    });
    const found = reports.find(ok);
    assert.ok(found);
    return found;
  }

  it("Open Screen shows the screen in a panel: its title rendered, and no Source tab", async () => {
    await vscode.commands.executeCommand("starboard.openScreen", SCREEN);
    const panel = starboard.panels.find("screen", SCREEN);
    assert.ok(panel, "no panel for the screen");
    assert.equal(panel.title, `Starboard: ${SCREEN}`);
    const report = await seen("the screen's title", (r) => r.view === "screen" && r.id === SCREEN && r.heading === "Sign in" && r.tabs.length > 0);
    assert.ok(report.tabs.includes("phone"), JSON.stringify(report));
    assert.ok(!report.tabs.includes("Source"), `the panel shows a Source tab: ${JSON.stringify(report)}`);
    // Opening it again reveals the same panel.
    await vscode.commands.executeCommand("starboard.openScreen", SCREEN);
    assert.equal(starboard.panels.find("screen", SCREEN), panel);
  });

  it("Open App Map and Open Flow open panels of their own", async () => {
    await vscode.commands.executeCommand("starboard.openMap");
    const map = starboard.panels.find("map", "");
    assert.ok(map, "no panel for the app map");
    assert.equal(map.title, "Starboard: App map");
    // The map's layout runs in the page, with no worker.
    await seen("the app map's screens", (r) => r.view === "map" && r.heading === "App map" && r.nodes > 0);

    await vscode.commands.executeCommand("starboard.openFlow", "add-activity");
    const flow = starboard.panels.find("flow", "add-activity");
    assert.ok(flow, "no panel for the flow");
    assert.equal(flow.title, "Starboard: add-activity");
    await seen("the flow's title", (r) => r.view === "flow" && r.heading === "Add an activity");
  });

  it("an edit made through the page's state lands in the screens.yaml buffer, and on disk", async () => {
    await vscode.commands.executeCommand("starboard.openScreen", SCREEN);
    // Beside the panel, so the panel stays visible (a hidden webview's page is gone).
    const doc = await vscode.workspace.openTextDocument(screens);
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    const purpose = "Set from the panel";
    const outcome = await starboard.panels.testApply("screen", SCREEN, [purposeOp(purpose)]);
    assert.equal(outcome, "saved");
    assert.ok(doc.getText().includes(`purpose: ${purpose}`), "the buffer has no new purpose");
    assert.equal(doc.isDirty, false);
    assert.ok(readFileSync(screens.fsPath, "utf8").includes(`purpose: ${purpose}`), "the file has no new purpose");
  });

  describe("a page that forges a write", () => {
    let next = 1_000_000;
    /** ask sends raw as the page would, and is the reply. */
    const ask = (raw: Record<string, unknown>) => starboard.panels.testRequest("screen", SCREEN, { ...raw, id: next++ });
    const files = async () => (await starboard.projects.all()[0]?.host.readAll())?.files ?? {};

    it("cannot write a change with text other than core's edit gave it", async () => {
      const doc = await vscode.workspace.openTextDocument(screens);
      const edit = await ask({ type: "core", fn: "edit", args: [await files(), [purposeOp("Forged")]] });
      assert.equal(edit.ok, true, JSON.stringify(edit));
      const made = (edit as { value: { files: Record<string, string> } }).value.files;
      assert.ok(made[SCREENS]?.includes("purpose: Forged"), JSON.stringify(made));
      const disk = readFileSync(screens.fsPath, "utf8");
      const buffer = doc.getText();
      const forged = Object.fromEntries(Object.entries(made).map(([p, t]) => [p, `${t}\n# Injected by the page.\n`]));
      const reply = await ask({ type: "write", changes: forged });
      assert.equal(reply.ok, false, JSON.stringify(reply));
      assert.match(reply.ok ? "" : reply.error, /not a change core worked out/);
      assert.equal(readFileSync(screens.fsPath, "utf8"), disk);
      assert.equal(doc.getText(), buffer);
      assert.equal(doc.isDirty, false);
    });

    it("cannot write outside the records, or delete outside generated/", async () => {
      const refused = async (changes: Record<string, string | null>, pattern: RegExp) => {
        const reply = await ask({ type: "write", changes });
        assert.equal(reply.ok, false, JSON.stringify(reply));
        assert.match(reply.ok ? "" : reply.error, pattern);
      };
      await refused({ "../outside.md": "x" }, /not a path inside the project/);
      await refused({ "/etc/hosts": "x" }, /not a path inside the project/);
      await refused({ ".vscode/tasks.json": "{}" }, /not a change core worked out|not under the content root/);
      await refused({ [SCREENS]: null }, /not a change core worked out|deletes only generated pages/);
      assert.equal(existsSync(fileIn(root, ".vscode/tasks.json").fsPath), false);
      assert.ok(existsSync(screens.fsPath));
    });

    it("cannot have core speak of files it forged: core reads the project itself", async () => {
      const real = await files();
      const forged = { ...real, [SCREENS]: (real[SCREENS] ?? "").replace("title: Sign in", "title: Forged by the page") };
      const model = await ask({ type: "core", fn: "model", args: [forged] });
      assert.equal(model.ok, true, JSON.stringify(model));
      const titles = (model as { value: { screens: { title: string }[] } }).value.screens.map((s) => s.title);
      assert.ok(titles.includes("Sign in") && !titles.includes("Forged by the page"), "core modelled the page's files");
    });
  });

  it("refuses a change worked out from text the editor has changed since, and the page reloads", async () => {
    await vscode.commands.executeCommand("starboard.openScreen", SCREEN);
    const doc = await vscode.workspace.openTextDocument(screens);
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    let next = 2_000_000;
    const ask = (raw: Record<string, unknown>) => starboard.panels.testRequest("screen", SCREEN, { ...raw, id: next++ });
    const typed = "\n# Typed in the editor.\n";
    const type = async () => {
      const edit = new vscode.WorkspaceEdit();
      edit.insert(screens, doc.positionAt(doc.getText().length), typed);
      assert.ok(await vscode.workspace.applyEdit(edit));
    };

    // The extension's own check: core's result, worked out before the typing, is not written over it.
    const files = (await starboard.projects.all()[0]?.host.readAll())?.files ?? {};
    const edit = await ask({ type: "core", fn: "edit", args: [files, [purposeOp("Stale")]] });
    assert.equal(edit.ok, true, JSON.stringify(edit));
    const made = (edit as { value: { files: Record<string, string> } }).value.files;
    await type();
    const disk = readFileSync(screens.fsPath, "utf8");
    const reply = await ask({ type: "write", changes: made });
    assert.equal(reply.ok, false, JSON.stringify(reply));
    assert.match(reply.ok ? "" : reply.error, /changed since Starboard read it/);
    assert.ok(doc.getText().endsWith(typed), "the typing is gone");
    assert.ok(!doc.getText().includes("purpose: Stale"));
    assert.equal(readFileSync(screens.fsPath, "utf8"), disk);

    // The page's: its stat of the buffer has moved, so it reads the project again rather than writing.
    await type();
    const outcome = await starboard.panels.testApply("screen", SCREEN, [purposeOp("Second purpose")]);
    assert.equal(outcome, "reloaded");
    assert.ok(doc.getText().endsWith(typed));
    assert.ok(!doc.getText().includes("Second purpose"));
    assert.equal(readFileSync(screens.fsPath, "utf8"), disk);
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand("workbench.action.files.revert");
  });

  it("reads the project again when screens.yaml is typed in, unsaved", async () => {
    await vscode.commands.executeCommand("starboard.openScreen", SCREEN);
    const doc = await vscode.workspace.openTextDocument(screens);
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    const title = "title: Sign in";
    const at = doc.getText().indexOf(title);
    assert.ok(at >= 0);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(screens, new vscode.Range(doc.positionAt(at), doc.positionAt(at + title.length)), "title: Sign in, typed");
    try {
      assert.ok(await vscode.workspace.applyEdit(edit));
      assert.equal(doc.isDirty, true);
      await seen("the typed title", (r) => r.view === "screen" && r.id === SCREEN && r.heading === "Sign in, typed");
    } finally {
      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand("workbench.action.files.revert");
    }
  });

  it("after a refused write, reads the project afresh, says why, and the next edit saves", async () => {
    // A wireframe no screen draws, which Fix removes; typed in, Fix may not delete it.
    const strayPath = "docs/flows/generated/wireframes/stray.phone.svg";
    const stray = fileIn(root, strayPath);
    writeFileSync(stray.fsPath, '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
    try {
      const strayDoc = await vscode.workspace.openTextDocument(stray);
      const typing = new vscode.WorkspaceEdit();
      typing.insert(stray, new vscode.Position(0, 0), "<!-- Typed in the editor. -->\n");
      assert.ok(await vscode.workspace.applyEdit(typing));
      assert.equal(strayDoc.isDirty, true);
      // A page that read the project before the stray file was made has no stamp for it: open one afresh.
      starboard.panels.find("screen", SCREEN)?.dispose();
      await vscode.commands.executeCommand("starboard.openScreen", SCREEN);
      await vscode.window.showTextDocument(strayDoc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });

      assert.equal(await starboard.panels.testFix("screen", SCREEN), "failed");
      assert.equal(strayDoc.isDirty, true);
      assert.ok(existsSync(stray.fsPath), "Fix deleted the typed-in page");

      // The Inspector's next edit: not the fix kept to save again with it, so it saves.
      const purpose = "Set after a refused fix";
      assert.equal(await starboard.panels.testApply("screen", SCREEN, [purposeOp(purpose)]), "saved");
      assert.ok(readFileSync(screens.fsPath, "utf8").includes(`purpose: ${purpose}`), "the file has no new purpose");
      await seen(
        "the refusal as the notice",
        (r) => r.view === "screen" && r.notice.includes(strayPath) && r.notice.includes("read the project again"),
      );
    } finally {
      const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === stray.toString());
      if (open?.isDirty) {
        await vscode.window.showTextDocument(open);
        await vscode.commands.executeCommand("workbench.action.files.revert");
      }
      rmSync(stray.fsPath, { force: true });
    }
  });
});
