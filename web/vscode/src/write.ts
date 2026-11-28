// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The one way the extension writes a project's files: the changes a core
// call returned (edit, format, fix), applied as one WorkspaceEdit, then
// each document it edited saved, unless it held unsaved text before: then
// the change stays in the buffer for the user to save, so nothing reaches
// the disk behind an open buffer. Every write is confined to the project's
// records, whoever asked for it, and a write worked out from text that
// has changed since is refused.

import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, sep } from "node:path";

import * as vscode from "vscode";

import type { Files } from "@c65llc/starboard-core";
import { checkChanges, CONFIG_FILE, inContent } from "@c65llc/starboard-app/src/host/host.ts";

import type { Project } from "./projects.ts";

/** A write was refused, or failed part way; the message says which file and why. */
export class WriteError extends Error {
  override name = "WriteError";
}

/**
 * outsideRecords says why path is not a file core writes, or undefined
 * when it is: starboard.yaml, or under the content root, with no segment
 * that is hidden (.git, .vscode).
 */
export function outsideRecords(path: string, content: string): string | undefined {
  if (path !== CONFIG_FILE && !inContent(path, content)) return `${path} is not under the content root ${content}`;
  if (path.split("/").some((seg) => seg.startsWith("."))) return `${path} is in a hidden folder`;
  return undefined;
}

/** within reports whether real is root or under it, compared segment by segment. */
function within(root: string, real: string): boolean {
  const rel = relative(root, real);
  return rel === "" || (!isAbsolute(rel) && rel.split(sep).every((s) => s !== ".."));
}

/**
 * resolvesUnder reports whether file, once every symbolic link on its
 * path is resolved, lies under root's real path; for a file not yet made,
 * its nearest existing folder does. Anything that cannot be resolved is not.
 */
export async function resolvesUnder(root: string, file: string): Promise<boolean> {
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    return false;
  }
  for (let at = file; ; ) {
    try {
      return within(realRoot, await realpath(at));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") return false;
      const up = dirname(at);
      if (up === at) return false;
      at = up;
    }
  }
}

function fileUri(project: Project, path: string): vscode.Uri {
  return vscode.Uri.joinPath(project.root, ...path.split("/"));
}

function openDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
}

/** currentText is the text of the open document at uri, else of the file, else undefined. */
export async function currentText(uri: vscode.Uri): Promise<string | undefined> {
  const doc = openDocument(uri);
  if (doc) return doc.getText();
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/** contentRoot is the project's content root as its starboard.yaml says now. */
async function contentRoot(project: Project): Promise<string> {
  const config = await currentText(fileUri(project, CONFIG_FILE));
  if (config === undefined) throw new WriteError(`${CONFIG_FILE} is gone, so nothing was written.`);
  return (await project.core.scope({ [CONFIG_FILE]: config })).content;
}

/**
 * confine throws WriteError unless every path of changes is one Starboard
 * may write in project: a clean relative path, deleted only under
 * <content>/generated/ (checkChanges, the web app's rule), starboard.yaml
 * or under the content root and in no hidden folder, and, on disk, with
 * every symbolic link resolved, inside the project's folder.
 */
export async function confine(project: Project, changes: Readonly<Record<string, string | null>>): Promise<void> {
  const content = await contentRoot(project);
  try {
    checkChanges({ ...changes }, content);
  } catch (err) {
    throw new WriteError(err instanceof Error ? err.message : String(err));
  }
  for (const path of Object.keys(changes)) {
    const why = outsideRecords(path, content);
    if (why !== undefined) throw new WriteError(`${why}, so Starboard does not write it.`);
  }
  if (project.root.scheme !== "file") return;
  for (const path of Object.keys(changes)) {
    if (!(await resolvesUnder(project.root.fsPath, fileUri(project, path).fsPath))) {
      throw new WriteError(`${path} leads outside the project through a symbolic link, so Starboard does not write it.`);
    }
  }
}

/** Test seam: what applyCoreResult runs between its per-file checks and the apply. */
export interface WriteSeam {
  /** Runs once every file has been checked, before the edit is applied: a test types here. */
  checked?: () => Promise<void>;
}

/**
 * applyCoreResult writes changes, a core call's result (a path to its new
 * text, or null to delete it), worked out from base, the read it was
 * computed on. It refuses, writing nothing, unless confine lets every path
 * through, and unless each changed file holds exactly what base held
 * (absent from base: no such file). It then applies one WorkspaceEdit (a
 * new file is LF, as the CLI writes it) and saves each edited document
 * that had no unsaved text before. It throws WriteError.
 *
 * Each existing target is read once, as the document VS Code holds for it
 * (opened if it was not), so the text checked is the text the edit
 * replaces. The checks are made again, with no await between them and
 * applyEdit, so an edit typed while the others were read stops the write;
 * and VS Code itself refuses a text edit whose document's version moved
 * on after applyEdit was called ("has changed in the meantime").
 */
export async function applyCoreResult(
  project: Project,
  changes: Readonly<Record<string, string | null>>,
  base: Files,
  seam: WriteSeam = {},
): Promise<void> {
  await confine(project, changes);
  const targets: Target[] = [];
  for (const [path, text] of Object.entries(changes)) {
    const uri = fileUri(project, path);
    const was = Object.hasOwn(base, path) ? base[path] : undefined;
    const doc = await documentAt(uri);
    if (doc?.getText() !== was) throw stale(path);
    if (was === text || (text === null && doc === undefined)) continue;
    if (text === null && doc?.isDirty) {
      throw new WriteError(`${path} has unsaved changes, so Starboard does not delete it. Save or revert it, then run the command again.`);
    }
    targets.push({ path, uri, text, was, doc, dirty: doc?.isDirty ?? false });
  }
  if (targets.length === 0) return;
  await seam.checked?.();

  // From here to applyEdit, nothing awaits: what is checked is what is replaced.
  for (const t of targets) {
    if (t.doc) {
      if (t.doc.isClosed || t.doc.getText() !== t.was) throw stale(t.path);
    } else if (openDocument(t.uri)) {
      throw stale(t.path); // a file the edit creates has appeared since
    }
  }
  const edit = new vscode.WorkspaceEdit();
  // Creations first and deletions last: an edit with file operations stops
  // at the first that fails, and a creation fails if the file has appeared.
  for (const t of targets) {
    if (t.doc || t.text === null) continue;
    edit.createFile(t.uri, { ignoreIfExists: false });
    edit.set(t.uri, [vscode.TextEdit.setEndOfLine(vscode.EndOfLine.LF), vscode.TextEdit.insert(new vscode.Position(0, 0), t.text)]);
  }
  for (const t of targets) {
    if (!t.doc || t.text === null) continue;
    edit.replace(t.uri, new vscode.Range(new vscode.Position(0, 0), t.doc.lineAt(t.doc.lineCount - 1).range.end), t.text);
  }
  for (const t of targets) if (t.text === null) edit.deleteFile(t.uri, { ignoreIfNotExists: true });
  // VS Code applies an edit of text changes only all or nothing; one with
  // file operations (creating a flow, removing a generated page) stops at
  // the first that fails, keeping those before it (applyEdit's contract).
  const fileOps = targets.some((t) => !t.doc || t.text === null);
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new WriteError(
      fileOps
        ? `The editor refused the change part way: check ${targets.map((t) => t.path).join(", ")}, then run the command again.`
        : "The editor refused the change, so nothing was written. Run the command again.",
    );
  }
  for (const t of targets) {
    if (t.text === null || t.dirty) continue;
    const doc = await vscode.workspace.openTextDocument(t.uri);
    if (!(await doc.save())) throw new WriteError(`${t.path} was changed but not saved.`);
  }
}

/** One file applyCoreResult changes, as it checked it. */
interface Target {
  path: string;
  uri: vscode.Uri;
  /** The new text, or null to delete it. */
  text: string | null;
  /** The text the change was worked out from; undefined: no such file. */
  was: string | undefined;
  /** The document holding the file, undefined when there is no file. */
  doc: vscode.TextDocument | undefined;
  /** Whether doc held unsaved text before the write: its change is then left unsaved. */
  dirty: boolean;
}

function stale(path: string): WriteError {
  return new WriteError(`${path} changed since Starboard read it, so nothing was written. Run the command again.`);
}

/** documentAt is the document VS Code holds for the file at uri, opened if need be, or undefined when there is no file. */
async function documentAt(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  const open = openDocument(uri);
  if (open) return open;
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    return undefined;
  }
  return vscode.workspace.openTextDocument(uri);
}
