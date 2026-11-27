// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A read-only FileSystemDirectoryHandle over a real directory (node:fs),
// shaped as fsaccess.ts uses it, recording every directory whose entries
// are read, so a test can drive the fsaccess host over a folder on disk.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { DirHandle, FileHandle } from "../../src/host/fsaccess.ts";

/** The errors the File System Access API rejects with for a missing entry or one of the wrong kind. */
function notFound(name: string): DOMException {
  return new DOMException(`no entry ${name}`, "NotFoundError");
}
function mismatch(name: string): DOMException {
  return new DOMException(`${name} is of the wrong kind`, "TypeMismatchError");
}

function readOnly(): Promise<never> {
  return Promise.reject(new DOMException("this test folder is read-only", "NoModificationAllowedError"));
}

class NodeFile implements FileHandle {
  readonly kind = "file" as const;
  readonly name: string;
  private readonly abs: string;

  constructor(name: string, abs: string) {
    this.name = name;
    this.abs = abs;
  }

  async getFile() {
    const info = await stat(this.abs);
    return { lastModified: info.mtimeMs, size: info.size, text: () => readFile(this.abs, "utf8") };
  }

  createWritable(): Promise<never> {
    return readOnly();
  }
}

export class NodeDir implements DirHandle {
  readonly kind = "directory" as const;
  readonly name: string;
  /** Each directory whose entries were read, as a slash path ("." for the top). */
  readonly listed: string[];
  private readonly abs: string;
  private readonly path: string;

  constructor(abs: string, name: string, path = ".", listed: string[] = []) {
    this.abs = abs;
    this.name = name;
    this.path = path;
    this.listed = listed;
  }

  private child(name: string): NodeDir {
    return new NodeDir(join(this.abs, name), name, this.path === "." ? name : `${this.path}/${name}`, this.listed);
  }

  async *values(): AsyncIterableIterator<NodeDir | NodeFile> {
    this.listed.push(this.path);
    for (const entry of await readdir(this.abs, { withFileTypes: true })) {
      if (entry.isDirectory()) yield this.child(entry.name);
      else if (entry.isFile()) yield new NodeFile(entry.name, join(this.abs, entry.name));
    }
  }

  async getDirectoryHandle(name: string): Promise<DirHandle> {
    const info = await stat(join(this.abs, name)).catch(() => null);
    if (info === null) throw notFound(name);
    if (!info.isDirectory()) throw mismatch(name);
    return this.child(name);
  }

  async getFileHandle(name: string): Promise<FileHandle> {
    const info = await stat(join(this.abs, name)).catch(() => null);
    if (info === null) throw notFound(name);
    if (!info.isFile()) throw mismatch(name);
    return new NodeFile(name, join(this.abs, name));
  }

  removeEntry(): Promise<void> {
    return readOnly();
  }

  queryPermission(): Promise<"granted"> {
    return Promise.resolve("granted");
  }

  requestPermission(): Promise<"granted"> {
    return Promise.resolve("granted");
  }

  isSameEntry(other: DirHandle): Promise<boolean> {
    return Promise.resolve(other === this);
  }
}
