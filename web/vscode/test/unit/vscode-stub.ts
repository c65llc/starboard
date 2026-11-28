// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The part of the vscode API that host.ts and projects.ts use, over an
// in-memory file system, so their unit tests run under Vitest. Only file:
// URIs on POSIX paths; disk holds each file's bytes by absolute path.

import { posix } from "node:path";

export const disk = new Map<string, Uint8Array>();

/** The arguments of each workspace.findFiles call. */
export const findFilesCalls: [string, string | undefined][] = [];

/** How long each next findFiles call takes to answer, in ms; it lists the disk when called. */
export const findFilesDelays: number[] = [];

export class Uri {
  readonly authority = "";
  readonly scheme: string;
  readonly path: string;
  private constructor(scheme: string, path: string) {
    this.scheme = scheme;
    this.path = path;
  }
  static file(path: string): Uri {
    return new Uri("file", posix.normalize(path));
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(base.scheme, posix.join(base.path, ...parts));
  }
  get fsPath(): string {
    return this.path;
  }
  toString(): string {
    return `${this.scheme}://${this.path}`;
  }
}

export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 } as const;
type FileType = (typeof FileType)[keyof typeof FileType];

export class EventEmitter<T> {
  private listeners = new Set<(e: T) => void>();
  readonly event = (listener: (e: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(e: T): void {
    for (const l of this.listeners) l(e);
  }
  dispose(): void {
    this.listeners.clear();
  }
}

/** The entries directly in dir, as readDirectory gives them. */
function entries(dir: string): [string, FileType][] {
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  const out = new Map<string, FileType>();
  for (const path of disk.keys()) {
    if (!path.startsWith(prefix)) continue;
    const [name, ...rest] = path.slice(prefix.length).split("/");
    if (name) out.set(name, rest.length > 0 ? FileType.Directory : FileType.File);
  }
  if (out.size === 0) throw new Error(`ENOENT: ${dir}`);
  return [...out];
}

export const workspace = {
  fs: {
    readDirectory: async (uri: Uri) => entries(uri.path),
    readFile: async (uri: Uri) => {
      const data = disk.get(uri.path);
      if (!data) throw new Error(`ENOENT: ${uri.path}`);
      return data;
    },
    stat: async (uri: Uri) => {
      if (disk.has(uri.path)) return { type: FileType.File };
      return { type: entries(uri.path) && FileType.Directory };
    },
  },
  /** Only the include glob projects.ts passes, **\/starboard.yaml, and its exclude. */
  findFiles: async (include: string, exclude?: string) => {
    findFilesCalls.push([include, exclude]);
    if (include !== "**/starboard.yaml") throw new Error(`the stub cannot glob ${include}`);
    const found = [...disk.keys()]
      .filter((p) => p.endsWith("/starboard.yaml"))
      .filter((p) => exclude !== "**/node_modules/**" || !p.split("/").includes("node_modules"))
      .map((p) => Uri.file(p));
    await new Promise((r) => setTimeout(r, findFilesDelays.shift() ?? 0));
    return found;
  },
};
