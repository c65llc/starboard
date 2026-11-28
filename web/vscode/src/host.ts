// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A WorkspaceHost reads one Starboard project through vscode.workspace.fs,
// with the editor's unsaved buffers laid over the files on disk, so lint
// sees what the user sees. It reads as the web app's hosts do: selectFiles,
// core's two-step scope (read starboard.yaml, list what scope walks, read
// what it names), never descending into .git. node_modules is deferred, as
// a dropped folder's is in the web app (readonly.ts): it is listed only
// when a directory the scope walks reaches it, so lint sees what the CLI,
// which globs into it, sees.

import * as vscode from "vscode";

import type { Files } from "@c65llc/starboard-core";
import { SKIPPED_DIRS, selectFiles } from "@c65llc/starboard-app/src/host/host.ts";
import type { ScopeFn, Tree } from "@c65llc/starboard-app/src/host/host.ts";

const decoder = new TextDecoder();

/** The folders a walk never enters: the web app's, version control. */
export const WALK_SKIPPED: ReadonlySet<string> = SKIPPED_DIRS;

/**
 * Folders left until the scope reaches them: installed packages, often
 * most of a JS project's files and rarely any of its screens. The CLI does
 * glob into them, so one is listed once a walked directory contains it.
 */
export const DEFERRED_DIRS: ReadonlySet<string> = new Set(["node_modules"]);

export class WorkspaceHost {
  /** The unsaved text of each open, dirty buffer, by project-relative path. */
  private readonly buffers = new Map<string, string>();

  /** The folder holding starboard.yaml. */
  readonly root: vscode.Uri;
  private readonly scope: ScopeFn;

  /** root is the folder holding starboard.yaml; scope is its core's scope. */
  constructor(root: vscode.Uri, scope: ScopeFn) {
    this.root = root;
    this.scope = scope;
  }

  /**
   * overlay sets the unsaved text of the buffer at path, project-relative,
   * which readAll then reads instead of the file; null clears it, so the
   * file on disk is read again.
   */
  overlay(path: string, text: string | null): void {
    if (text === null) this.buffers.delete(path);
    else this.buffers.set(path, text);
  }

  /** The paths with an unsaved buffer laid over them. */
  overlaid(): string[] {
    return [...this.buffers.keys()].sort();
  }

  /**
   * readAll reads the project as core.scope names it: starboard.yaml, the
   * content root and the files read in full (a buffer's text where one is
   * laid over a file), and the files lint only checks exist, as "".
   */
  async readAll(): Promise<{ files: Files; content: string; listedOnly: ReadonlySet<string> }> {
    return selectFiles(this.tree(), this.scope);
  }

  private tree(): Tree {
    const uri = (path: string) => vscode.Uri.joinPath(this.root, ...path.split("/"));
    return {
      // selectFiles walks only the directories core.scope names, so a
      // DEFERRED_DIRS folder found under one is reached: it is listed
      // after the rest, and one the scope never reaches is never opened.
      walk: async (dir) => {
        const prefix = dir === "." ? "" : `${dir}/`;
        const out = new Set<string>();
        const deferred = new Map<string, vscode.Uri>();
        await walk(dir === "." ? this.root : uri(dir), prefix, out, deferred).catch(() => undefined); // missing, or a file
        await Promise.all([...deferred].map(([path, at]) => walk(at, `${path}/`, out).catch(() => undefined)));
        // A buffer whose file is not on disk (new, or deleted under it) is still the project's.
        for (const path of this.buffers.keys()) {
          if (path.startsWith(prefix) && !path.split("/").some((part) => WALK_SKIPPED.has(part))) out.add(path);
        }
        return [...out].sort();
      },
      isFile: async (path) => {
        if (this.buffers.has(path)) return true;
        try {
          return ((await vscode.workspace.fs.stat(uri(path))).type & vscode.FileType.File) !== 0;
        } catch {
          return false;
        }
      },
      read: async (path) => this.buffers.get(path) ?? decoder.decode(await vscode.workspace.fs.readFile(uri(path))),
    };
  }
}

/**
 * walk adds every file under dir to out as a slash path after prefix. It
 * does not descend into WALK_SKIPPED or follow a symbolic link to a
 * folder, which could loop. Given deferred, it puts each DEFERRED_DIRS
 * folder there, by path, instead of descending into it.
 */
export async function walk(
  dir: vscode.Uri,
  prefix: string,
  out: Set<string>,
  deferred?: Map<string, vscode.Uri>,
): Promise<void> {
  const entries = await vscode.workspace.fs.readDirectory(dir);
  await Promise.all(
    entries.map(async ([name, type]) => {
      const path = prefix + name;
      if (type & vscode.FileType.SymbolicLink && type & vscode.FileType.Directory) return;
      if (type & vscode.FileType.Directory) {
        const at = vscode.Uri.joinPath(dir, name);
        if (WALK_SKIPPED.has(name)) return;
        if (deferred && DEFERRED_DIRS.has(name)) deferred.set(path, at);
        else await walk(at, `${path}/`, out, deferred);
      } else if (type & vscode.FileType.File) {
        out.add(path);
      }
    }),
  );
}
