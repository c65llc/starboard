// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A read-only FileSystemDirectoryHandle over a real directory (node:fs),
// shaped as fsaccess.ts uses it, recording every directory whose entries
// are read, so a test can drive the fsaccess host over a folder on disk.
//
// It answers as Chromium's File System Access does for a local folder, as
// far as we know it (Chromium's local file utilities, not a real browser,
// are the source): a symbolic link is never shown, so values() leaves it
// out and getFileHandle or getDirectoryHandle say it is not there, whatever
// it points at; and a name Chromium refuses (see refusedName) is a TypeError.

import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { DirHandle, FileHandle } from "../../src/host/fsaccess.ts";
import type { DropEntry } from "../../src/host/readonly.ts";
import { refusedName } from "./fake-fs.ts";

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
    // A symbolic link is neither a directory nor a file here: left out.
    for (const entry of await readdir(this.abs, { withFileTypes: true })) {
      if (entry.isDirectory()) yield this.child(entry.name);
      else if (entry.isFile()) yield new NodeFile(entry.name, join(this.abs, entry.name));
    }
  }

  /** entry is what name is here, never following a symbolic link: null when absent or a link. */
  private async entry(name: string) {
    if (refusedName(name)) throw new TypeError(`Name is not allowed: ${JSON.stringify(name)}`);
    const info = await lstat(join(this.abs, name)).catch(() => null);
    if (info === null || info.isSymbolicLink()) throw notFound(name);
    return info;
  }

  async getDirectoryHandle(name: string): Promise<DirHandle> {
    if (!(await this.entry(name)).isDirectory()) throw mismatch(name);
    return this.child(name);
  }

  async getFileHandle(name: string): Promise<FileHandle> {
    if (!(await this.entry(name)).isFile()) throw mismatch(name);
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

/**
 * nodeDropEntry is the FileSystemEntry a browser gives for the folder abs
 * dropped on the page (as fromDrop reads it), with symbolic links left out
 * as NodeDir leaves them; dirs logs each directory whose entries are read.
 */
export function nodeDropEntry(abs: string, name: string, dirs: string[] = [], path = "."): DropEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let done = false;
      return {
        readEntries: (ok, fail) => {
          if (done) return ok([]);
          done = true;
          dirs.push(path);
          readdir(abs, { withFileTypes: true }).then((entries) => {
            const out: DropEntry[] = [];
            for (const e of entries) {
              const child = join(abs, e.name);
              if (e.isDirectory()) out.push(nodeDropEntry(child, e.name, dirs, path === "." ? e.name : `${path}/${e.name}`));
              else if (e.isFile()) out.push(nodeDropFile(child, e.name));
            }
            ok(out);
          }, fail);
        },
      };
    },
  };
}

function nodeDropFile(abs: string, name: string): DropEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (ok, fail) => {
      Promise.all([readFile(abs), stat(abs)]).then(
        ([data, info]) => ok(new File([data], name, { lastModified: info.mtimeMs })),
        fail,
      );
    },
  };
}
