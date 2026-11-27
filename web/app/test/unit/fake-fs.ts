// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// In-memory stand-ins for FileSystemDirectoryHandle and FileSystemFileHandle,
// shaped as fsaccess.ts uses them, recording what the host does.

import type { DirHandle, FileHandle, PermissionMode } from "../../src/host/fsaccess.ts";

export type Permission = "granted" | "prompt" | "denied";

export interface FakeLog {
  /** Every operation, such as "getFile docs/flows/screens.yaml" or "move a/.b.starboard-tmp -> b". */
  ops: string[];
}

let clock = 1_000;

class FakeFile implements FileHandle {
  readonly kind = "file" as const;
  name: string;
  text: string;
  mtime: number;
  private parent: FakeDir;
  private log: FakeLog;
  private canMove: boolean;

  constructor(name: string, parent: FakeDir, text: string, mtime: number, log: FakeLog, canMove: boolean) {
    this.name = name;
    this.parent = parent;
    this.text = text;
    this.mtime = mtime;
    this.log = log;
    this.canMove = canMove;
  }

  get path(): string {
    return this.parent.path === "" ? this.name : `${this.parent.path}/${this.name}`;
  }

  getFile() {
    this.log.ops.push(`getFile ${this.path}`);
    const text = this.text;
    const size = new TextEncoder().encode(text).length;
    return Promise.resolve({ lastModified: this.mtime, size, text: () => Promise.resolve(text) });
  }

  createWritable() {
    let buffer = "";
    this.log.ops.push(`createWritable ${this.path}`);
    return Promise.resolve({
      write: (data: string) => {
        buffer += data;
        return Promise.resolve();
      },
      close: () => {
        this.text = buffer;
        this.mtime = ++clock;
        return Promise.resolve();
      },
    });
  }

  get move(): ((name: string) => Promise<void>) | undefined {
    if (!this.canMove) return undefined;
    return (name: string) => {
      this.log.ops.push(`move ${this.path} -> ${name}`);
      this.parent.entries.delete(this.name);
      this.name = name;
      this.parent.entries.set(name, this);
      return Promise.resolve();
    };
  }
}

export class FakeDir implements DirHandle {
  readonly kind = "directory" as const;
  entries = new Map<string, FakeDir | FakeFile>();
  permission: Permission = "granted";
  /** What requestPermission answers. */
  answer: Permission = "granted";
  requests: PermissionMode[] = [];

  name: string;
  path: string;
  readonly log: FakeLog;
  private canMove: boolean;

  constructor(name: string, path: string, log: FakeLog = { ops: [] }, canMove = true) {
    this.name = name;
    this.path = path;
    this.log = log;
    this.canMove = canMove;
  }

  /** put writes a file at a slash path below this directory, creating folders. */
  put(path: string, text: string, mtime = ++clock): void {
    const [part, ...rest] = path.split("/");
    if (part === undefined) return;
    if (rest.length > 0) {
      let next = this.entries.get(part);
      if (!(next instanceof FakeDir)) {
        next = new FakeDir(part, this.path === "" ? part : `${this.path}/${part}`, this.log, this.canMove);
        this.entries.set(part, next);
      }
      next.put(rest.join("/"), text, mtime);
      return;
    }
    const existing = this.entries.get(part);
    if (existing instanceof FakeFile) {
      existing.text = text;
      existing.mtime = mtime;
    } else {
      this.entries.set(part, new FakeFile(part, this, text, mtime, this.log, this.canMove));
    }
  }

  /** read returns the file at a slash path, or undefined. */
  read(path: string): string | undefined {
    const [part = "", ...rest] = path.split("/");
    const entry = this.entries.get(part);
    if (rest.length === 0) return entry instanceof FakeFile ? entry.text : undefined;
    return entry instanceof FakeDir ? entry.read(rest.join("/")) : undefined;
  }

  /** files lists every file below, as slash paths. */
  files(): string[] {
    const out: string[] = [];
    for (const entry of this.entries.values()) {
      if (entry instanceof FakeFile) out.push(entry.path);
      else out.push(...entry.files());
    }
    return out.sort();
  }

  async *values(): AsyncIterableIterator<FakeDir | FakeFile> {
    for (const entry of [...this.entries.values()]) yield entry;
  }

  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle> {
    const entry = this.entries.get(name);
    if (entry instanceof FakeDir) return Promise.resolve(entry);
    if (entry || !opts?.create) return Promise.reject(new DOMException(`no directory ${name}`, "NotFoundError"));
    const dir = new FakeDir(name, this.path === "" ? name : `${this.path}/${name}`, this.log, this.canMove);
    this.entries.set(name, dir);
    return Promise.resolve(dir);
  }

  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle> {
    const entry = this.entries.get(name);
    if (entry instanceof FakeFile) return Promise.resolve(entry);
    if (entry || !opts?.create) return Promise.reject(new DOMException(`no file ${name}`, "NotFoundError"));
    const file = new FakeFile(name, this, "", ++clock, this.log, this.canMove);
    this.entries.set(name, file);
    return Promise.resolve(file);
  }

  removeEntry(name: string): Promise<void> {
    if (!this.entries.has(name)) return Promise.reject(new DOMException(`no entry ${name}`, "NotFoundError"));
    this.log.ops.push(`remove ${this.path === "" ? name : `${this.path}/${name}`}`);
    this.entries.delete(name);
    return Promise.resolve();
  }

  queryPermission(desc: { mode: PermissionMode }): Promise<Permission> {
    void desc;
    return Promise.resolve(this.permission);
  }

  requestPermission(desc: { mode: PermissionMode }): Promise<Permission> {
    this.requests.push(desc.mode);
    this.permission = this.answer;
    return Promise.resolve(this.answer);
  }

  isSameEntry(other: DirHandle): Promise<boolean> {
    return Promise.resolve(other === this);
  }
}

/** folder makes a project folder named name holding files. */
export function folder(name: string, files: Record<string, string>, opts: { canMove?: boolean } = {}): FakeDir {
  const dir = new FakeDir(name, "", { ops: [] }, opts.canMove ?? true);
  for (const [path, text] of Object.entries(files)) dir.put(path, text);
  return dir;
}
