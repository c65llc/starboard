// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The read-write host: a folder opened with the File System Access API
// (Chromium). Folder handles are remembered in IndexedDB, through
// idb-keyval, so Recent can reopen them; after a reload the browser resets
// their permission to "prompt", and only a click may ask for it again.

import { get, set } from "idb-keyval";

import {
  checkChanges,
  checkPath,
  CONFIG_FILE,
  DEFAULT_CONTENT,
  NoProjectError,
  selectFiles,
  SKIPPED_DIRS,
} from "./host.ts";
import type { Files, Host, ScopeFn, Stamp } from "./host.ts";

// The parts of the File System Access API this host uses. TypeScript's DOM
// library lacks the permission methods, move() and showDirectoryPicker, so
// they are declared here, as the tests' fakes implement them.

export type PermissionMode = "read" | "readwrite";
type Permission = "granted" | "prompt" | "denied";

export interface Writable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?: (() => Promise<void>) | undefined;
}

export interface FileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<{ lastModified: number; size: number; text(): Promise<string> }>;
  createWritable(): Promise<Writable>;
  /** Renames the file within its directory; missing in some browsers. */
  move?: ((name: string) => Promise<void>) | undefined;
}

export interface DirHandle {
  readonly kind: "directory";
  readonly name: string;
  values(): AsyncIterable<DirHandle | FileHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
  queryPermission(desc: { mode: PermissionMode }): Promise<Permission>;
  requestPermission(desc: { mode: PermissionMode }): Promise<Permission>;
  isSameEntry(other: DirHandle): Promise<boolean>;
}

export type Picker = (opts: { mode: PermissionMode }) => Promise<DirHandle>;

/** canOpenInPlace is the feature test for editing in place: never the user agent. */
export function canOpenInPlace(win: object = globalThis): boolean {
  return "showDirectoryPicker" in win;
}

/** The browser's folder picker. */
const defaultPicker: Picker = (opts) =>
  (globalThis as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker(opts);

// --- recent folders ------------------------------------------------------------

/** What Recent shows of a project once it has been linted. */
export interface RecentSummary {
  screens: number;
  flows: number;
  errors: number;
  warnings: number;
}

export interface RecentRecord {
  id: string;
  name: string;
  handle: DirHandle;
  openedAt: number;
  summary?: RecentSummary;
}

/** A remembered folder and whether it may be opened without asking. */
export interface RecentEntry extends RecentRecord {
  permission: Permission;
}

/** Where recent folders are kept: IndexedDB in the app, memory in tests. */
export interface RecentStore {
  load(): Promise<RecentRecord[]>;
  save(records: RecentRecord[]): Promise<void>;
}

const RECENT_KEY = "starboard.recent";
const MAX_RECENT = 8;

/** idbRecentStore keeps the records, handles included, in IndexedDB. */
export const idbRecentStore: RecentStore = {
  load: async () => (await get<RecentRecord[]>(RECENT_KEY)) ?? [],
  save: (records) => set(RECENT_KEY, records),
};

/** memoryRecentStore keeps records for the life of the page (tests). */
export function memoryRecentStore(): RecentStore {
  let records: RecentRecord[] = [];
  return {
    load: () => Promise.resolve([...records]),
    save: (next) => {
      records = [...next];
      return Promise.resolve();
    },
  };
}

interface StoreOptions {
  store?: RecentStore;
}

export interface OpenOptions extends StoreOptions {
  scope: ScopeFn;
  picker?: Picker;
}

/** remember puts handle first in the recent list, reusing its entry if it is already there. */
async function remember(handle: DirHandle, store: RecentStore): Promise<string> {
  const records = await store.load();
  let existing: RecentRecord | undefined;
  for (const r of records) {
    if (await r.handle.isSameEntry(handle).catch(() => false)) {
      existing = r;
      break;
    }
  }
  const record: RecentRecord = existing
    ? { ...existing, handle, name: handle.name, openedAt: Date.now() }
    : { id: crypto.randomUUID(), name: handle.name, handle, openedAt: Date.now() };
  const rest = records.filter((r) => r !== existing);
  await store.save([record, ...rest].slice(0, MAX_RECENT));
  return record.id;
}

/** restoreRecent lists remembered folders, most recent first, with their permission now (never asking). */
export async function restoreRecent(opts: StoreOptions = {}): Promise<RecentEntry[]> {
  const records = await (opts.store ?? idbRecentStore).load();
  return Promise.all(
    records.map(async (r) => ({
      ...r,
      permission: await r.handle.queryPermission({ mode: "readwrite" }).catch((): Permission => "denied"),
    })),
  );
}

function sameSummary(a: RecentSummary | undefined, b: RecentSummary): boolean {
  return a !== undefined && a.screens === b.screens && a.flows === b.flows && a.errors === b.errors && a.warnings === b.warnings;
}

/** rememberSummary records a project's counts for Recent; counts it already holds are not written again. */
export async function rememberSummary(id: string, summary: RecentSummary, opts: StoreOptions = {}): Promise<void> {
  const store = opts.store ?? idbRecentStore;
  const records = await store.load();
  const record = records.find((r) => r.id === id);
  if (!record || sameSummary(record.summary, summary)) return;
  await store.save(records.map((r) => (r === record ? { ...r, summary } : r)));
}

/**
 * summaryRecorder returns a function that records a folder's counts through
 * write (rememberSummary by default): one write at a time, in the order
 * asked, so an older one never lands after a newer one; counts already
 * written are not written again, and counts count as written only once
 * their write has succeeded. A failed write is swallowed: Recent's counts
 * are a convenience.
 */
export function summaryRecorder(
  write: (id: string, summary: RecentSummary) => Promise<void> = (id, summary) => rememberSummary(id, summary),
): (id: string, summary: RecentSummary) => Promise<void> {
  let last = "";
  let tail: Promise<void> = Promise.resolve();
  return (id, summary) => {
    const key = JSON.stringify([id, summary]);
    tail = tail.then(async () => {
      if (key === last) return;
      try {
        await write(id, summary);
        last = key;
      } catch {
        // left unrecorded, so the next lint tries again
      }
    });
    return tail;
  };
}

/** The user (or the browser) did not grant access to a remembered folder. */
export class PermissionDeniedError extends Error {
  override name = "PermissionDeniedError";
  constructor(folder: string) {
    super(
      `Starboard was not allowed to open ${folder}. Choose Reconnect folder and allow access, ` +
        `or use Open folder… to pick it again.`,
    );
  }
}

/** openFolder asks the user for a project folder, read-write, and remembers it. */
export async function openFolder(opts: OpenOptions): Promise<FsAccessHost> {
  const handle = await (opts.picker ?? defaultPicker)({ mode: "readwrite" });
  const host = await FsAccessHost.load(handle, opts.scope, "");
  host.recentId = await remember(handle, opts.store ?? idbRecentStore);
  return host;
}

/**
 * reconnect asks again for access to a remembered folder. Browsers allow
 * the request only during a user gesture, so call it from a click.
 */
export async function reconnect(entry: RecentEntry, opts: OpenOptions): Promise<FsAccessHost> {
  const permission = await entry.handle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") throw new PermissionDeniedError(entry.name);
  const host = await FsAccessHost.load(entry.handle, opts.scope, entry.id);
  await remember(entry.handle, opts.store ?? idbRecentStore);
  return host;
}

// --- the host --------------------------------------------------------------------

/** The suffix of writeAtomically's temporary files. */
const TMP_SUFFIX = ".starboard-tmp";

function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "NotFoundError" || err.name === "TypeMismatchError");
}

/** list walks dir, returning every file's slash path and handle, skipping SKIPPED_DIRS. */
async function list(dir: DirHandle, prefix: string, out: Map<string, FileHandle>): Promise<void> {
  for await (const entry of dir.values()) {
    const path = prefix + entry.name;
    // A temporary file is half a write (one a crash left behind): never project content.
    if (entry.kind === "file") {
      if (!entry.name.endsWith(TMP_SUFFIX)) out.set(path, entry);
    }
    else if (!SKIPPED_DIRS.has(entry.name)) await list(entry, `${path}/`, out);
  }
}

export class FsAccessHost implements Host {
  readonly kind = "fsaccess";
  readonly canWrite = true;
  readonly name: string;
  /** This folder's entry in Recent. */
  recentId: string;
  private content = DEFAULT_CONTENT;
  private listed: ReadonlySet<string> = new Set();
  private readonly root: DirHandle;
  private readonly scope: ScopeFn;

  private constructor(root: DirHandle, scope: ScopeFn, recentId: string) {
    this.root = root;
    this.scope = scope;
    this.name = root.name;
    this.recentId = recentId;
  }

  /** load checks the folder is a project before the host is handed out. */
  static async load(root: DirHandle, scope: ScopeFn, recentId: string): Promise<FsAccessHost> {
    try {
      await root.getFileHandle(CONFIG_FILE);
    } catch (err) {
      if (isNotFound(err)) throw new NoProjectError(root.name);
      throw err;
    }
    return new FsAccessHost(root, scope, recentId);
  }

  async readAll(): Promise<Files> {
    const handles = new Map<string, FileHandle>();
    await list(this.root, "", handles);
    const { files, content, listedOnly } = await selectFiles(
      {
        paths: [...handles.keys()],
        read: async (path) => {
          const handle = handles.get(path);
          if (!handle) throw new NoProjectError(this.name);
          return (await handle.getFile()).text();
        },
      },
      this.scope,
    );
    this.content = content;
    this.listed = listedOnly;
    return files;
  }

  async read(path: string): Promise<string | null> {
    const file = await this.file(path);
    return file ? file.text() : null;
  }

  async stat(path: string): Promise<Stamp | null> {
    const file = await this.file(path);
    return file ? { mtime: file.lastModified, size: file.size } : null;
  }

  /** file is the file at path as it is now, or null when it does not exist. */
  private async file(path: string) {
    checkPath(path);
    const parts = path.split("/");
    const base = parts.pop() as string;
    try {
      let dir = this.root;
      for (const part of parts) dir = await dir.getDirectoryHandle(part);
      return await (await dir.getFileHandle(base)).getFile();
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  listedOnly(): ReadonlySet<string> {
    return this.listed;
  }

  async write(changes: Record<string, string | null>): Promise<void> {
    checkChanges(changes, this.content);
    for (const [path, text] of Object.entries(changes)) {
      const parts = path.split("/");
      const base = parts.pop() as string;
      if (text === null) {
        await this.remove(parts, base);
        continue;
      }
      let dir = this.root;
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      await writeAtomically(dir, base, text);
    }
  }

  /** remove deletes dirs/base; one already gone is not an error. */
  private async remove(dirs: string[], base: string): Promise<void> {
    try {
      let dir = this.root;
      for (const part of dirs) dir = await dir.getDirectoryHandle(part);
      await dir.removeEntry(base);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
}

/**
 * writeAtomically writes text to a temporary file beside name, then moves it
 * over name, so a reader never sees half a file. Where move() is missing or
 * cannot replace a file, it overwrites name. The temporary file is removed
 * however that goes, so a failed write leaves nothing behind.
 */
async function writeAtomically(dir: DirHandle, name: string, text: string): Promise<void> {
  const tmpName = `.${name}${TMP_SUFFIX}`;
  try {
    const tmp = await dir.getFileHandle(tmpName, { create: true });
    await writeText(tmp, text);
    if (tmp.move) {
      try {
        await tmp.move(name);
        return;
      } catch {
        // fall back to overwriting below
      }
    }
    await writeText(await dir.getFileHandle(name, { create: true }), text);
  } finally {
    // Gone already after a move; a leftover is never worth failing for.
    await dir.removeEntry(tmpName).catch(() => undefined);
  }
}

async function writeText(handle: FileHandle, text: string): Promise<void> {
  const w = await handle.createWritable();
  try {
    await w.write(text);
    await w.close();
  } catch (err) {
    await w.abort?.().catch(() => undefined); // release the file; the write's own error is the one to report
    throw err;
  }
}
