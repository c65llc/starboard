// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A Host is where a project's files live. Everything in the app that reads
// or writes a file goes through one, so other shells (Tauri, VS Code) can
// supply their own. Four ship here: fsaccess (a folder opened with the
// File System Access API, read and write), readonly (a folder picked or
// dropped where that API is missing; edits collect as downloads), memory
// (tests and the bundled example) and vscode (the VS Code extension's
// panel, whose files the extension reads and writes).

import type { Files, ScopeResult } from "@c65llc/starboard-core";

export type { Files };

/** A file's modified time (ms since the epoch, or a host's own counter) and size in bytes. */
export interface Stamp {
  mtime: number;
  size: number;
}

export interface Host {
  kind: "fsaccess" | "readonly" | "memory" | "vscode";
  /** The project folder's name, shown in the header. */
  name: string;
  /** Whether write changes the files themselves; false collects them for download. */
  canWrite: boolean;
  /**
   * The project's files: starboard.yaml, the content root, the vocabulary
   * files, and (by name, as "") the files under roots and each screen's
   * files and screenshots, which lint only checks exist.
   */
  readAll(): Promise<Files>;
  /**
   * One file's text now, or null when it does not exist; absent when the
   * host can only read the whole project (readAll).
   */
  read?(path: string): Promise<string | null>;
  /** The file's stamp now, or null when it does not exist. */
  stat(path: string): Promise<Stamp | null>;
  /**
   * Writes each file; a null value deletes it. Deleting anything outside
   * <content>/generated/ is refused with DeletionRefusedError, and nothing
   * of that call is written.
   */
  write(changes: Record<string, string | null>): Promise<void>;
  /**
   * The paths the last readAll listed by name only (as ""), which the app
   * never writes and so need no stamp; absent when every file is read in full.
   */
  listedOnly?(): ReadonlySet<string>;
}

/** Asks core which of a folder's files the project uses (StarboardCore.scope). */
export type ScopeFn = (files: Files) => Promise<ScopeResult>;

/** The content root when the folder has not been scoped yet. */
export const DEFAULT_CONTENT = "docs/flows";

export const CONFIG_FILE = "starboard.yaml";

/** A write tried to delete a file that is not a generated page. */
export class DeletionRefusedError extends Error {
  override name = "DeletionRefusedError";
  readonly path: string;
  constructor(path: string) {
    super(
      `Starboard deletes only generated pages, under the content root's generated/ folder; ` +
        `${path} was not deleted. Delete it yourself if you meant to.`,
    );
    this.path = path;
  }
}

/** A path from a host's caller is not a project-relative slash path. */
export class InvalidPathError extends Error {
  override name = "InvalidPathError";
  readonly path: string;
  constructor(path: string) {
    super(`${JSON.stringify(path)} is not a path inside the project; use a relative path written with /.`);
    this.path = path;
  }
}

/** The folder holds no starboard.yaml. */
export class NoProjectError extends Error {
  override name = "NoProjectError";
  constructor(folder: string) {
    super(
      `${folder} has no starboard.yaml, so it is not a Starboard project. ` +
        `Choose the folder that holds starboard.yaml, or run \`starboard init\` in it first.`,
    );
  }
}

/** checkPath throws InvalidPathError unless path is a clean project-relative slash path. */
export function checkPath(path: string): void {
  const parts = path.split("/");
  if (path === "" || path.includes("\\") || parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new InvalidPathError(path);
  }
}

/**
 * inContent reports whether path belongs to the content root content, as
 * core's Scope has it: anything under it, or, when content is "." (the
 * project folder itself), screens.yaml and whatever is under flows/ and
 * generated/ at the top.
 */
export function inContent(path: string, content: string): boolean {
  if (content === ".") return path === "screens.yaml" || path.startsWith("flows/") || path.startsWith("generated/");
  return path.startsWith(`${content}/`);
}

/** generatedDir is the folder of generated pages under content, with a trailing slash. */
function generatedDir(content: string): string {
  return content === "." ? "generated/" : `${content}/generated/`;
}

/**
 * checkChanges validates a write before any of it happens: every path is
 * clean, and only files under <content>/generated/ are deleted.
 */
export function checkChanges(changes: Record<string, string | null>, content: string): void {
  const generated = generatedDir(content);
  for (const [path, value] of Object.entries(changes)) {
    checkPath(path);
    if (value === null && !path.startsWith(generated)) throw new DeletionRefusedError(path);
  }
}

/** byteLength is the UTF-8 size of text, as a file holding it would have. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * A project folder as selectFiles reads it: the files under a directory,
 * whether one path is a file, and one file's text.
 */
export interface Tree {
  /**
   * Every file under dir ("." for the whole folder) as a project-relative
   * slash path, skipping SKIPPED_DIRS; none when dir is missing or a file.
   */
  walk(dir: string): Promise<string[]>;
  /** Whether path is a file. */
  isFile(path: string): Promise<boolean>;
  /** The text of a file walk or isFile found. */
  read(path: string): Promise<string>;
}

/**
 * Folders a walk skips anywhere: version control, never project files.
 * node_modules is not among them: the CLI globs a root's screenFiles into
 * it, so lint would differ; it is walked only when a root reaches it.
 */
export const SKIPPED_DIRS: ReadonlySet<string> = new Set([".git"]);

/**
 * selectFiles reads the project out of a folder, listing no more of it than
 * core.scope says the project can reach: starboard.yaml, then every file
 * under scope's walk and each file it names. scope is asked again once the
 * content root is read, as each screen names more files, and the content
 * root, the vocabulary files and starboard.yaml are read in full; the
 * other files are given by name (as ""), which lint only checks exist. It
 * returns the files, the content root, and those names (listedOnly).
 */
export async function selectFiles(
  tree: Tree,
  scope: ScopeFn,
): Promise<{ files: Files; content: string; listedOnly: ReadonlySet<string> }> {
  const files: Files = { [CONFIG_FILE]: await tree.read(CONFIG_FILE) };
  const listed = new Set<string>();
  const view = (): Files => ({ ...Object.fromEntries([...listed].map((p) => [p, ""])), ...files });
  // probe lists each named file the folder holds, saying whether any was new.
  const probe = async (named: string[]): Promise<boolean> => {
    const fresh = named.filter((p) => !listed.has(p));
    const found = await Promise.all(fresh.map((p) => tree.isFile(p)));
    fresh.forEach((p, i) => {
      if (found[i]) listed.add(p);
    });
    return found.includes(true);
  };

  const first = await scope(files);
  for (const paths of await Promise.all(first.walk.map((dir) => tree.walk(dir)))) {
    for (const path of paths) if (path !== CONFIG_FILE) listed.add(path);
  }
  await probe(first.named);
  await readInto(files, tree, [...listed].filter((p) => inContent(p, first.content)));

  let second = await scope(view());
  if (await probe(second.named)) second = await scope(view());
  await readInto(files, tree, second.read);
  for (const path of second.present) files[path] = "";
  return { files, content: second.content, listedOnly: new Set(second.present) };
}

async function readInto(files: Files, tree: Tree, paths: string[]): Promise<void> {
  const texts = await Promise.all(paths.map((p) => tree.read(p)));
  paths.forEach((p, i) => {
    files[p] = texts[i] ?? "";
  });
}
