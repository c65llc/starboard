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

/**
 * applyCoreResult writes changes, a core call's result (a path to its new
 * text, or null to delete it), worked out from base, the read it was
 * computed on. It refuses, writing nothing, unless confine lets every path
 * through, and unless each changed file holds now, in its buffer or on
 * disk, exactly what base held (absent from base: no such file). It then
 * applies one WorkspaceEdit (a new file is LF, as the CLI writes it) and
 * saves each edited document that had no unsaved text before. It throws
 * WriteError.
 */
export async function applyCoreResult(
  project: Project,
  changes: Readonly<Record<string, string | null>>,
  base: Files,
): Promise<void> {
  await confine(project, changes);
  const edit = new vscode.WorkspaceEdit();
  const save: vscode.Uri[] = [];
  let edits = 0;
  for (const [path, text] of Object.entries(changes)) {
    const uri = fileUri(project, path);
    const now = await currentText(uri);
    const was = Object.hasOwn(base, path) ? base[path] : undefined;
    if (now !== was) throw new WriteError(`${path} changed since Starboard read it, so nothing was written. Run the command again.`);
    if (now === text) continue;
    const dirty = openDocument(uri)?.isDirty ?? false;
    if (text === null) {
      if (now === undefined) continue;
      if (dirty) throw new WriteError(`${path} has unsaved changes, so Starboard does not delete it. Save or revert it, then run the command again.`);
      edit.deleteFile(uri, { ignoreIfNotExists: true });
      edits++;
      continue;
    }
    if (now === undefined) {
      edit.createFile(uri, { ignoreIfExists: false });
      edit.set(uri, [vscode.TextEdit.setEndOfLine(vscode.EndOfLine.LF), vscode.TextEdit.insert(new vscode.Position(0, 0), text)]);
    } else {
      const doc = await vscode.workspace.openTextDocument(uri);
      edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), doc.lineAt(doc.lineCount - 1).range.end), text);
    }
    edits++;
    if (!dirty) save.push(uri);
  }
  if (edits === 0) return;
  if (!(await vscode.workspace.applyEdit(edit))) throw new WriteError("The editor refused the change, so nothing was written.");
  for (const uri of save) {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (!(await doc.save())) throw new WriteError(`${vscode.workspace.asRelativePath(uri)} was changed but not saved.`);
  }
}
