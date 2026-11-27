// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app's state, as signals: the open host, its files, the model and
// lint core derives from them, what is not yet saved, and the selection.
// Every change goes edit (in core) → files → host.write, and each write is
// preceded by a stat of the files it touches: if one changed on disk since
// it was read (an agent or an editor wrote it), the app reloads instead of
// overwriting it and says "Reloaded: changed on disk".

import { batch, signal } from "@preact/signals";
import type { EditOp, Files, LintResult, Model, StarboardCore } from "@c65llc/starboard-core";

import type { Host, Stamp } from "./host/host.ts";

/** The part of core the state calls. */
export type StateCore = Pick<StarboardCore, "edit" | "lint" | "model">;

export const RELOADED_NOTICE = "Reloaded: changed on disk";

/** What is selected; each view reads the parts it shows. */
export interface Selection {
  screen?: string;
  region?: string;
  flow?: string;
}

/** saved: written; pending: kept for download (view-only host); reloaded: a file had changed, nothing written. */
export type EditOutcome = "saved" | "pending" | "reloaded";

function same(a: Stamp | null, b: Stamp | null): boolean {
  return a === b || (a !== null && b !== null && a.mtime === b.mtime && a.size === b.size);
}

export function createState(core: StateCore) {
  const host = signal<Host | null>(null);
  const files = signal<Files>({});
  const model = signal<Model | null>(null);
  const lint = signal<LintResult | null>(null);
  /** Paths changed but not yet on disk: being written, or pending download. */
  const dirty = signal<ReadonlySet<string>>(new Set());
  const selection = signal<Selection>({});
  const notice = signal<string | null>(null);

  // The stamp of each file as last read or written. Files given as "" are
  // not stamped: most are listed by name only and never written, and
  // stating every file under a root would be slow. loaded is every path
  // read, so an unstamped one is not mistaken for a new file.
  let stamps = new Map<string, Stamp | null>();
  let loaded = new Set<string>();
  // Bumped by every open, reload and close, so a late answer for an older
  // project or an older read never overwrites a newer one.
  let generation = 0;

  async function stampAll(h: Host, f: Files): Promise<Map<string, Stamp | null>> {
    const paths = Object.keys(f).filter((p) => f[p] !== "");
    const got = await Promise.all(paths.map((p) => h.stat(p)));
    return new Map(paths.map((p, i) => [p, got[i] ?? null]));
  }

  /** derive lints and models f, unless something newer has started meanwhile. */
  async function derive(f: Files, gen: number): Promise<void> {
    const [m, l] = await Promise.all([core.model(f), core.lint(f)]);
    if (gen !== generation) return;
    batch(() => {
      model.value = m;
      lint.value = l;
    });
  }

  /** load reads h afresh, as generation gen. */
  async function load(h: Host, gen: number): Promise<boolean> {
    const f = await h.readAll();
    const s = await stampAll(h, f);
    if (gen !== generation) return false;
    stamps = s;
    loaded = new Set(Object.keys(f));
    batch(() => {
      host.value = h;
      files.value = f;
      dirty.value = new Set();
    });
    await derive(f, gen);
    return true;
  }

  /** open makes h the project, replacing any open one. */
  async function open(h: Host): Promise<void> {
    const gen = ++generation;
    notice.value = null;
    await load(h, gen);
  }

  /** reload reads the open host again and shows the changed-on-disk notice. */
  async function reload(): Promise<void> {
    const h = host.value;
    if (!h) return;
    const gen = ++generation;
    if (await load(h, gen)) notice.value = RELOADED_NOTICE;
  }

  /** changedOnDisk reports whether any of paths differs from its stamp. Unstamped files have no stamp to differ from. */
  async function changedOnDisk(h: Host, paths: string[]): Promise<boolean> {
    for (const path of paths) {
      if (!stamps.has(path) && loaded.has(path)) continue;
      const now = await h.stat(path);
      if (!same(now, stamps.get(path) ?? null)) return true;
    }
    return false;
  }

  /** applyEdit runs ops through core and saves the files they change. */
  async function applyEdit(ops: EditOp[]): Promise<EditOutcome> {
    const h = host.value;
    if (!h) throw new Error("No project is open; open one, then edit it.");
    const gen = generation;
    const result = await core.edit(files.value, ops);
    if (gen !== generation) return "reloaded";
    const changes = result.files;
    const paths = Object.keys(changes);
    batch(() => {
      files.value = { ...files.value, ...changes };
      dirty.value = new Set([...dirty.value, ...paths]);
    });

    if (await changedOnDisk(h, paths)) {
      await reload();
      return "reloaded";
    }
    await h.write(changes);
    for (const path of paths) stamps.set(path, await h.stat(path));
    if (h.canWrite) {
      const left = new Set(dirty.value);
      for (const path of paths) left.delete(path);
      dirty.value = left;
    }
    await derive(files.value, generation);
    return h.canWrite ? "saved" : "pending";
  }

  /**
   * checkDisk stats every file read (on window focus, say) and reloads if
   * any changed. It reports whether it reloaded.
   */
  async function checkDisk(): Promise<boolean> {
    const h = host.value;
    if (!h) return false;
    if (!(await changedOnDisk(h, [...stamps.keys()]))) return false;
    await reload();
    return true;
  }

  /** markDownloaded clears dirty once a view-only host's changes are downloaded. */
  function markDownloaded(): void {
    dirty.value = new Set();
  }

  function close(): void {
    generation++;
    stamps = new Map();
    loaded = new Set();
    batch(() => {
      host.value = null;
      files.value = {};
      model.value = null;
      lint.value = null;
      dirty.value = new Set();
      selection.value = {};
      notice.value = null;
    });
  }

  return {
    host,
    files,
    model,
    lint,
    dirty,
    selection,
    notice,
    open,
    reload,
    applyEdit,
    checkDisk,
    markDownloaded,
    close,
  };
}

export type AppState = ReturnType<typeof createState>;
