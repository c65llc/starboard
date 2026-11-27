// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app's state, as signals: the open host, its files, the model and
// lint core derives from them, what is not yet saved, and the selection.
// Every change goes edit (in core) → files → host.write, and each write is
// preceded by a stat of the files it touches: if one changed on disk since
// it was read (an agent or an editor wrote it), the app reloads instead of
// overwriting it and says "Reloaded: changed on disk".
//
// Saves, reloads and the focus check run one at a time, in order, through
// one queue: otherwise a focus check could stat a file between a save's
// write and its re-stamp and mistake the app's own write for an outside
// one, or two edits could start from the same files and the later one
// drop the earlier. Opening a project is not queued; it bumps generation,
// and queued work checks generation after every await and stops touching
// state once it has moved on.

import { batch, signal } from "@preact/signals";
import type { EditOp, Files, LintResult, Model, StarboardCore } from "@c65llc/starboard-core";

import type { Host, Stamp } from "./host/host.ts";

/** The part of core the state calls. */
export type StateCore = Pick<StarboardCore, "edit" | "fix" | "lint" | "model">;

export const RELOADED_NOTICE = "Reloaded: changed on disk";

/** What is selected; each view reads the parts it shows. */
export interface Selection {
  screen?: string;
  region?: string;
  flow?: string;
}

/**
 * saved: written. pending: kept for download (view-only host). reloaded: a
 * file had changed on disk, nothing written. failed: the host refused the
 * write; the change stays in files, dirty and unsaved for retrySave.
 * discarded: another project was opened before the edit finished.
 */
export type EditOutcome = "saved" | "pending" | "reloaded" | "failed" | "discarded";

/** The notice when a write fails, with the host's reason. */
export function notSavedNotice(err: unknown): string {
  const why = err instanceof Error && err.message ? err.message : String(err);
  return `Not saved: ${why} Your change is kept; fix the cause, then save again.`;
}

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
  // Changes whose write failed, kept until a later write lands.
  let unsaved: Record<string, string | null> = {};
  // The tail of the queue saves, reloads and focus checks run on.
  let tail: Promise<unknown> = Promise.resolve();

  /** serial runs task after everything queued before it, whatever they did. */
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  }

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
    unsaved = {};
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

  /** reloadNow reads the open host again and shows the changed-on-disk notice; callers hold the queue. */
  async function reloadNow(): Promise<void> {
    const h = host.value;
    if (!h) return;
    const gen = ++generation;
    if (await load(h, gen)) notice.value = RELOADED_NOTICE;
  }

  /** reload reads the open host again, after any save in progress. */
  function reload(): Promise<void> {
    return serial(reloadNow);
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

  /**
   * save writes changes plus any earlier unsaved ones, as generation gen
   * on host h, after checking none changed on disk. Callers hold the queue.
   */
  async function save(h: Host, gen: number, changes: Record<string, string | null>): Promise<EditOutcome> {
    const all = { ...unsaved, ...changes };
    const paths = Object.keys(all);
    const changed = await changedOnDisk(h, paths);
    if (gen !== generation) return "discarded";
    if (changed) {
      await reloadNow();
      return "reloaded";
    }
    try {
      await h.write(all);
    } catch (err) {
      if (gen !== generation) return "discarded";
      unsaved = all;
      notice.value = notSavedNotice(err);
      return "failed";
    }
    const now = await Promise.all(paths.map((p) => h.stat(p)));
    if (gen !== generation) return "discarded";
    paths.forEach((p, i) => stamps.set(p, now[i] ?? null));
    unsaved = {};
    if (notice.value?.startsWith("Not saved:")) notice.value = null;
    if (h.canWrite) {
      const left = new Set(dirty.value);
      for (const p of paths) left.delete(p);
      dirty.value = left;
    }
    await derive(files.value, gen);
    return h.canWrite ? "saved" : "pending";
  }

  /**
   * change queues a save of the changes make computes from the files as
   * they stand once everything before it has run: core's edit, core's fix,
   * or texts given outright. A null change deletes the file.
   */
  function change(make: (f: Files) => Promise<Record<string, string | null>>): Promise<EditOutcome> {
    const h = host.value;
    if (!h) return Promise.reject(new Error("No project is open; open one, then edit it."));
    const gen = generation;
    return serial(async () => {
      if (gen !== generation) return "discarded";
      const changes = await make(files.value);
      if (gen !== generation) return "discarded";
      batch(() => {
        const merged = { ...files.value, ...changes };
        files.value = Object.fromEntries(
          Object.entries(merged).filter((e): e is [string, string] => e[1] !== null),
        );
        dirty.value = new Set([...dirty.value, ...Object.keys(changes)]);
      });
      return save(h, gen, changes);
    });
  }

  /** applyEdit runs ops through core and saves the files they change, after any save in progress. */
  function applyEdit(ops: EditOp[]): Promise<EditOutcome> {
    return change(async (f) => (await core.edit(f, ops)).files);
  }

  /**
   * applyChanges saves texts as given, after any save in progress: the
   * Source tab's way to mend a file core cannot parse, and so cannot edit.
   */
  function applyChanges(changes: Record<string, string | null>): Promise<EditOutcome> {
    return change(() => Promise.resolve(changes));
  }

  /** applyFix formats the sources and regenerates the generated pages (core.fix), as one change. */
  function applyFix(): Promise<EditOutcome> {
    return change(async (f) => {
      const fixed = await core.fix(f);
      const changes: Record<string, string | null> = { ...fixed.write };
      for (const path of fixed.remove) changes[path] = null;
      return changes;
    });
  }

  /** retrySave writes the changes a failed save kept. */
  function retrySave(): Promise<EditOutcome> {
    const h = host.value;
    if (!h) return Promise.reject(new Error("No project is open; open one, then edit it."));
    const gen = generation;
    return serial(() => (gen !== generation ? Promise.resolve<EditOutcome>("discarded") : save(h, gen, {})));
  }

  /**
   * checkDisk stats every file read (on window focus, say) and reloads if
   * any changed, after any save in progress. It reports whether it reloaded.
   */
  function checkDisk(): Promise<boolean> {
    return serial(async () => {
      const h = host.value;
      if (!h) return false;
      const gen = generation;
      const changed = await changedOnDisk(h, [...stamps.keys()]);
      if (!changed || gen !== generation) return false;
      await reloadNow();
      return true;
    });
  }

  /** markDownloaded clears dirty once a view-only host's changes are downloaded. */
  function markDownloaded(): void {
    dirty.value = new Set();
  }

  function close(): void {
    generation++;
    stamps = new Map();
    loaded = new Set();
    unsaved = {};
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
    applyChanges,
    applyFix,
    retrySave,
    checkDisk,
    markDownloaded,
    close,
  };
}

export type AppState = ReturnType<typeof createState>;
