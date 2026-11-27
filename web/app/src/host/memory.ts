// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// An in-memory host: the tests' project, and "Explore the example project",
// which opens examples/travel-app as bundled at build time. Each write
// advances a counter that stands in for the modified time, so the app's
// changed-on-disk check works here as on a real folder; put and remove are
// how a test plays an editor changing a file underneath the app.

import { byteLength, checkChanges, checkPath, DEFAULT_CONTENT } from "./host.ts";
import type { Files, Host, Stamp } from "./host.ts";

export interface MemoryOptions {
  name: string;
  /** false makes write collect nothing and change nothing, as a view-only host's would (default true). */
  canWrite?: boolean;
  /** The content root, under whose generated/ files may be deleted (default docs/flows). */
  content?: string;
}

interface Entry {
  text: string;
  mtime: number;
}

export class MemoryHost implements Host {
  readonly kind = "memory";
  readonly name: string;
  readonly canWrite: boolean;
  private readonly content: string;
  private readonly files = new Map<string, Entry>();
  private clock = 0;

  constructor(files: Files, opts: MemoryOptions) {
    this.name = opts.name;
    this.canWrite = opts.canWrite ?? true;
    this.content = opts.content ?? DEFAULT_CONTENT;
    for (const [path, text] of Object.entries(files)) this.put(path, text);
  }

  readAll(): Promise<Files> {
    const out: Files = {};
    for (const [path, entry] of this.files) out[path] = entry.text;
    return Promise.resolve(out);
  }

  stat(path: string): Promise<Stamp | null> {
    const entry = this.files.get(path);
    return Promise.resolve(entry ? { mtime: entry.mtime, size: byteLength(entry.text) } : null);
  }

  async write(changes: Record<string, string | null>): Promise<void> {
    checkChanges(changes, this.content);
    if (!this.canWrite) return;
    for (const [path, text] of Object.entries(changes)) {
      if (text === null) this.remove(path);
      else this.put(path, text);
    }
  }

  /** put sets a file, as a write or an outside editor would. */
  put(path: string, text: string): void {
    checkPath(path);
    this.files.set(path, { text, mtime: ++this.clock });
  }

  /** remove deletes a file, as an outside editor would. */
  remove(path: string): void {
    this.files.delete(path);
  }
}

/** createMemoryHost holds files in memory. */
export function createMemoryHost(files: Files, opts: MemoryOptions): MemoryHost {
  return new MemoryHost(files, opts);
}
