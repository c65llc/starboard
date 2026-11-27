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

/** Every zip entry's modified time: 1980-01-01, the earliest a zip can hold. */
const ZIP_MTIME = new Date(1980, 0, 1);

export interface ReadonlyOptions {
  scope: ScopeFn;
}

/** The pending changes as the UI lists them: files to copy in, files to delete. */
export interface PendingSummary {
  changed: string[];
  deleted: string[];
}

/**
 * The file in a changes zip that lists the paths to delete, named so no
 * project file is likely to share it; write refuses that path.
 */
export const DELETED_LIST = ".starboard-deleted.txt";

/** A write named the deletions list's own path, which a download needs for itself. */
export class ReservedPathError extends Error {
  override name = "ReservedPathError";
  readonly path: string;
  constructor(path: string) {
    super(`${path} is the name Starboard gives the list of files to delete in a download, so it cannot be changed here.`);
    this.path = path;
  }
}

export class ReadonlyHost implements Host {
  readonly kind = "readonly";
  readonly canWrite = false;
  /** Changes not yet downloaded: text to write, or null to delete. */
  pending: Record<string, string | null> = {};
  readonly name: string;
  private content = DEFAULT_CONTENT;
  private listed: ReadonlySet<string> = new Set();
  private readonly files: Map<string, File>;
  // Folders of a dropped project not read yet (DEFERRED_DIRS), by
  // project-relative path; each is read, once, when core.scope reaches it.
  private readonly deferred: Map<string, DropEntry>;
  private readonly reading = new Map<string, Promise<void>>();
  private readonly scope: ScopeFn;
  // Changes already downloaded: the user copies them into the project, so
  // the app goes on showing them rather than the folder as first picked.
  private downloaded: Record<string, string | null> = {};
  // The change set downloaded last, kept until the next edit so it can be
  // downloaded again: the browser may have blocked or lost the download.
  private lastDownload: Record<string, string | null> = {};

  constructor(name: string, files: ReadonlyMap<string, File>, scope: ScopeFn, deferred: ReadonlyMap<string, DropEntry> = new Map()) {
    this.name = name;
    this.files = new Map(files);
    this.deferred = new Map(deferred);
    this.scope = scope;
  }

  async readAll(): Promise<Files> {
    // Picked files are all handed over already, so a walk here costs no
    // reads, but a dropped folder's deferred ones are read only now, when
    // core.scope reaches them; either way it keeps to what scope says.
    const { files, content, listedOnly } = await selectFiles(
      {
        walk: async (dir) => {
          await this.readDeferred((d) => dir === "." || d === dir || d.startsWith(`${dir}/`) || dir.startsWith(`${d}/`));
          const paths = [...this.files.keys()];
          return dir === "." ? paths : paths.filter((p) => p.startsWith(`${dir}/`));
        },
        isFile: async (path) => {
          await this.readDeferred((d) => path.startsWith(`${d}/`));
          return this.files.has(path);
        },
        read: (path) => (this.files.get(path) as File).text(),
      },
      this.scope,
    );
    this.content = content;
    this.listed = listedOnly;
    const merged: Files = {};
    for (const [path, text] of Object.entries({ ...files, ...this.downloaded, ...this.pending })) {
      if (text !== null) merged[path] = text;
    }
    return merged;
  }

  /** readDeferred reads, once each, the deferred folders that core.scope reaches. */
  private async readDeferred(reaches: (dir: string) => boolean): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const [dir, entry] of this.deferred) {
      if (!reaches(dir)) continue;
      let read = this.reading.get(dir);
      if (!read) {
        read = walk(entry, `${dir}/`, this.files);
        this.reading.set(dir, read);
      }
      waits.push(read);
    }
    await Promise.all(waits);
  }

  /** The stamp of the file as picked: pending changes are not on disk. */
  stat(path: string): Promise<Stamp | null> {
    const file = this.files.get(path);
    return Promise.resolve(file ? { mtime: file.lastModified, size: file.size } : null);
  }

  listedOnly(): ReadonlySet<string> {
    return this.listed;
  }

  async write(changes: Record<string, string | null>): Promise<void> {
    checkChanges(changes, this.content);
    if (DELETED_LIST in changes) throw new ReservedPathError(DELETED_LIST);
    if (Object.keys(changes).length > 0) this.lastDownload = {};
    for (const [path, text] of Object.entries(changes)) {
      // Deleting a file the project does not hold (one only this session
      // created) just forgets its creation: there is nothing to remove.
      if (text === null && !this.held(path)) {
        this.pending = Object.fromEntries(Object.entries(this.pending).filter(([p]) => p !== path));
      } else {
        this.pending[path] = text;
      }
    }
  }

  /** The pending changed and deleted paths, each sorted. */
  summary(): PendingSummary {
    return summarize(this.pending);
  }

  /**
   * Whether nothing is pending but the last download can be had again: it
   * stays so until the next edit (and the host is gone with its project).
   */
  isDownloaded(): boolean {
    return Object.keys(this.pending).length === 0 && Object.keys(this.lastDownload).length > 0;
  }

  /** The changed and deleted paths a download gives now: the pending ones, or else the last download's. */
  downloadSummary(): PendingSummary {
    return summarize(this.toDownload());
  }

  /** What a download gives: the pending changes, or, when none, the last download again. */
  private toDownload(): Record<string, string | null> {
    return Object.keys(this.pending).length > 0 ? this.pending : this.lastDownload;
  }

  /**
   * The project-relative path of the one changed file, when the download is
   * that file alone (one changed, nothing deleted); null when it is a zip.
   * The browser saves the download by its base name, so the UI shows this.
   */
  downloadPath(): string | null {
    const { changed, deleted } = this.downloadSummary();
    return changed.length === 1 && deleted.length === 0 ? (changed[0] as string) : null;
  }

  /**
   * The pending changes: one changed file as itself; otherwise a zip of the
   * changed files at their project-relative paths, plus .starboard-deleted.txt listing
   * the paths to remove when there are any.
   */
  downloadPending(): Blob {
    const changes = this.toDownload();
    const only = this.downloadPath();
    if (only !== null) return new Blob([changes[only] as string], { type: "text/plain" });
    const { changed, deleted } = this.downloadSummary();
    const entries: Record<string, Uint8Array> = {};
    for (const path of changed) entries[path] = strToU8(changes[path] as string);
    if (deleted.length > 0) {
      // One path per line and nothing else, so `xargs rm < .starboard-deleted.txt` works.
      entries[DELETED_LIST] = strToU8(deleted.map((p) => `${p}\n`).join(""));
    }
    // A fixed time on every entry (fflate stamps the current one), so the
    // same changes always make the same bytes.
    const zip = zipSync(entries, { mtime: ZIP_MTIME });
    return new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" });
  }

  /** The file name downloadPending's blob should be saved as. */
  downloadName(): string {
    const only = this.downloadPath();
    return only !== null ? (only.split("/").pop() as string) : `${this.name}-changes.zip`;
  }

  /**
   * Forgets the pending changes, once they are downloaded; the app goes on
   * showing them, and they stay downloadable again until the next edit.
   */
  clearPending(): void {
    if (Object.keys(this.pending).length === 0) return;
    Object.assign(this.downloaded, this.pending);
    this.lastDownload = this.pending;
    this.pending = {};
  }

  /** Whether the project holds path, as picked or as already downloaded. */
  private held(path: string): boolean {
    const done = this.downloaded[path];
    return done === undefined ? this.files.has(path) : done !== null;
  }
}

/** summarize lists changes' changed and deleted paths, each sorted. */
function summarize(changes: Record<string, string | null>): PendingSummary {
  const entries = Object.entries(changes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    changed: entries.filter(([, t]) => t !== null).map(([p]) => p),
    deleted: entries.filter(([, t]) => t === null).map(([p]) => p),
  };
}

/**
 * locate finds the project among the paths below what the user chose: the
 * folder of the shallowest starboard.yaml. Its files are keyed by
 * project-relative path, and the host is named after that folder.
 */
function locate(chosen: string, all: Map<string, File>, scope: ScopeFn, deferred = new Map<string, DropEntry>()): ReadonlyHost {
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
  const later = new Map<string, DropEntry>();
  for (const [path, entry] of deferred) {
    if (path.startsWith(dir)) later.set(path.slice(dir.length), entry);
  }
  return new ReadonlyHost(name, files, scope, later);
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

/**
 * Folders a dropped folder's walk leaves for later: installed packages,
 * often most of a JS project's files and rarely any of its screens. The
 * CLI does glob into them, so one is read once core.scope reaches it.
 */
const DEFERRED_DIRS: ReadonlySet<string> = new Set(["node_modules"]);

/**
 * walk reads entry's files into out, as paths starting with prefix. Given
 * deferred, it puts each DEFERRED_DIRS folder there instead of reading it.
 */
async function walk(entry: DropEntry, prefix: string, out: Map<string, File>, deferred?: Map<string, DropEntry>): Promise<void> {
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
        if (deferred && DEFERRED_DIRS.has(child.name)) deferred.set(path, child);
        else await walk(child, `${path}/`, out, deferred);
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
  const deferred = new Map<string, DropEntry>();
  await walk(root, "", all, deferred);
  return locate(root.name, all, opts.scope, deferred);
}
