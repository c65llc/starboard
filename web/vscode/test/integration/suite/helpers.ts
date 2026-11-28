// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// What the integration suites share: the running extension's API, and
// waiting on what the editor shows.

import * as vscode from "vscode";

import type { StarboardApi } from "../../../src/extension.ts";

/** api activates the extension, if it is not yet, and waits for its first lint of every project. */
export async function api(): Promise<StarboardApi> {
  const ext = vscode.extensions.getExtension<StarboardApi>("c65llc.starboard-vscode");
  if (!ext) throw new Error("the extension is not installed in the test host");
  const starboard = await ext.activate();
  await starboard.diagnostics.settled();
  return starboard;
}

/** fileIn is the file at the slash path rel under the folder root. */
export function fileIn(root: string, rel: string): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.file(root), ...rel.split("/"));
}

/** starboard is the Starboard findings on uri, as the Problems panel shows them. */
export function starboard(uri: vscode.Uri): vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics(uri).filter((d) => d.source === "starboard");
}

/** rule is d's rule ID: the value of its code. */
export function rule(d: vscode.Diagnostic): string {
  return typeof d.code === "object" ? String(d.code.value) : String(d.code);
}

/**
 * waitFor polls ok every 25 ms until it holds and resolves with how long
 * that took, or rejects after timeoutMs with what.
 */
export async function waitFor(what: string, ok: () => boolean, timeoutMs: number): Promise<number> {
  const start = Date.now();
  for (;;) {
    if (ok()) return Date.now() - start;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** sleep waits ms, for a test that checks nothing arrives. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
