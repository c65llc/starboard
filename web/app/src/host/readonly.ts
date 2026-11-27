// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The view-only host, for browsers without the File System Access API
// (Safari, Firefox): a folder picked with <input webkitdirectory> or
// dropped on the page. The browser hands over a snapshot it cannot write
// back, so write collects changes in pending, and downloadPending gives them
// as one file or as a zip of project-relative paths to copy into the project.

import { strToU8, zipSync } from "fflate";

import { checkChanges, CONFIG_FILE, DEFAULT_CONTENT, NoProjectError, selectFiles, SKIPPED_DIRS } from "./host.ts";
import type { Files, Host, ScopeFn, Stamp } from "./host.ts";

export interface ReadonlyOptions {
  scope: ScopeFn;
}

export class ReadonlyHost implements Host {
  readonly kind = "readonly";
  readonly canWrite = false;
  /** Changes not yet downloaded: text to write, or null to delete. */
  pending: Record<string, string | null> = {};
  readonly name: string;
  private content = DEFAULT_CONTENT;
  private readonly files: ReadonlyMap<string, File>;
  private readonly scope: ScopeFn;

  constructor(name: string, files: ReadonlyMap<string, File>, scope: ScopeFn) {
    this.name = name;
    this.files = files;
    this.scope = scope;
  }

  async readAll(): Promise<Files> {
    const { files, content } = await selectFiles(
      {
        paths: [...this.files.keys()],
        read: (path) => (this.files.get(path) as File).text(),
      },
      this.scope,
    );
    this.content = content;
    const merged: Files = {};
    for (const [path, text] of Object.entries({ ...files, ...this.pending })) {
      if (text !== null) merged[path] = text;
    }
    return merged;
  }

  /** The stamp of the file as picked: pending changes are not on disk. */
  stat(path: string): Promise<Stamp | null> {
    const file = this.files.get(path);
    return Promise.resolve(file ? { mtime: file.lastModified, size: file.size } : null);
  }

  async write(changes: Record<string, string | null>): Promise<void> {
    checkChanges(changes, this.content);
    Object.assign(this.pending, changes);
  }

  /** The changed files: one as itself, several as a zip. Deletions are listed in pending only. */
  downloadPending(): Blob {
    const changed = this.changed();
    const [only] = changed;
    if (changed.length === 1 && only) return new Blob([only[1]], { type: "text/plain" });
    const zip = zipSync(Object.fromEntries(changed.map(([path, text]) => [path, strToU8(text)])));
    return new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" });
  }

  /** The file name downloadPending's blob should be saved as. */
  downloadName(): string {
    const changed = this.changed();
    const [only] = changed;
    if (changed.length === 1 && only) return only[0].split("/").pop() as string;
    return `${this.name}-changes.zip`;
  }

  /** Forgets the pending changes, once they are downloaded. */
  clearPending(): void {
    this.pending = {};
  }

  private changed(): [string, string][] {
    return Object.entries(this.pending).filter((e): e is [string, string] => e[1] !== null);
  }
}

/**
 * locate finds the project among the paths below what the user chose: the
 * folder of the shallowest starboard.yaml. Its files are keyed by
 * project-relative path, and the host is named after that folder.
 */
function locate(chosen: string, all: Map<string, File>, scope: ScopeFn): ReadonlyHost {
  const configs = [...all.keys()]
    .filter((p) => p === CONFIG_FILE || p.endsWith(`/${CONFIG_FILE}`))
    .sort((a, b) => a.split("/").length - b.split("/").length);
  const config = configs[0];
  if (config === undefined) throw new NoProjectError(chosen);
  const dir = config.slice(0, -CONFIG_FILE.length); // "" or "sub/"
  const files = new Map<string, File>();
  for (const [path, file] of all) {
    if (!path.startsWith(dir)) continue;
    const rel = path.slice(dir.length);
    if (!rel.split("/").some((part) => SKIPPED_DIRS.has(part))) files.set(rel, file);
  }
  const name = dir === "" ? chosen : (dir.slice(0, -1).split("/").pop() as string);
  return new ReadonlyHost(name, files, scope);
}

/**
 * fromDirectoryInput opens the files an <input type="file" webkitdirectory>
 * gave. Each File's webkitRelativePath starts with the chosen folder's name.
 */
export function fromDirectoryInput(list: FileList | File[], opts: ReadonlyOptions): Promise<ReadonlyHost> {
  const all = new Map<string, File>();
  let chosen = "";
  for (const file of Array.from(list)) {
    const [top = "", ...rest] = file.webkitRelativePath.split("/");
    chosen ||= top;
    all.set(rest.join("/"), file);
  }
  return Promise.resolve().then(() => locate(chosen || "The folder", all, opts.scope));
}

/** A FileSystemEntry as webkitGetAsEntry gives it, as far as fromDrop uses it. */
export interface DropEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (file: File) => void, fail?: (err: unknown) => void) => void;
  createReader?: () => {
    readEntries(ok: (entries: DropEntry[]) => void, fail?: (err: unknown) => void): void;
  };
}

/** NotAFolderError: what was dropped is not one folder. */
export class NotAFolderError extends Error {
  override name = "NotAFolderError";
  constructor() {
    super("Drop the project folder itself (the one that holds starboard.yaml), not files from inside it.");
  }
}

async function walk(entry: DropEntry, prefix: string, out: Map<string, File>): Promise<void> {
  const reader = entry.createReader?.();
  if (!reader) return;
  for (;;) {
    // readEntries answers in batches until it answers with none.
    const batch = await new Promise<DropEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (batch.length === 0) return;
    for (const child of batch) {
      const path = prefix + child.name;
      if (child.isFile && child.file) {
        const get = child.file;
        out.set(path, await new Promise<File>((ok, fail) => get(ok, fail)));
      } else if (child.isDirectory && !SKIPPED_DIRS.has(child.name)) {
        await walk(child, `${path}/`, out);
      }
    }
  }
}

/** fromDrop opens a folder dropped on the page. */
export async function fromDrop(items: DataTransferItemList, opts: ReadonlyOptions): Promise<ReadonlyHost> {
  const entries: DropEntry[] = [];
  for (const item of Array.from(items)) {
    const entry = item.kind === "file" ? (item.webkitGetAsEntry() as DropEntry | null) : null;
    if (entry) entries.push(entry);
  }
  const [root] = entries;
  if (entries.length !== 1 || !root?.isDirectory) throw new NotAFolderError();
  const all = new Map<string, File>();
  await walk(root, "", all);
  return locate(root.name, all, opts.scope);
}
