// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The host inside the desktop app's window (web/desktop): each read and
// write is a Rust command, on a root the user opened with the folder
// dialog, from the recent projects or on the command line, named by its
// id. Core runs here in the page, in the web app's own worker. The host
// reads the project as fsaccess does (selectFiles, listing only what
// core.scope reaches), checks each write with checkChanges before sending
// it, and Rust checks it again: every path confined to the root, writes
// only to starboard.yaml and the content root it read itself, deletions
// only under <content>/generated/.
//
// Rust's watcher sends files-changed when the open project changes on disk;
// the page answers (followProject) by listing again the folders core's
// scope walks, and asking again after the files it names outside them: a
// file made or deleted there, which the app's own check of the files it
// read cannot see, reads the project again (state's reload);
// otherwise the app's own check runs (checkDisk). The native menu's Open
// Folder… and Open Recent send menu-open, which the page opens through its
// own open path (onMenuOpen).
//
// Loaded only by the desktop entry (src/desktop.tsx), so the browser build
// does not carry @tauri-apps/api.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { checkChanges, checkPath, CONFIG_FILE, DEFAULT_CONTENT, NoProjectError, selectFiles } from "./host.ts";
import type { Files, Host, NativeOpener, NativeRecent, ScopeFn, Stamp } from "./host.ts";

/** The one end of Tauri the host needs: a command call. */
export interface Bridge {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

/** tauriBridge is Tauri's own invoke. */
export function tauriBridge(): Bridge {
  return { invoke: (cmd, args) => invoke(cmd, args) };
}

/** What opening a folder gives: the id Rust names the root by, and the folder's name. */
export interface Opened {
  rootId: number;
  name: string;
}

/** A recent project as Rust lists it. */
export type RecentProject = NativeRecent;

/** A command the desktop app refused, under the name of Rust's own refusal (DeletionRefusedError, MovedError…). */
export class DesktopError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

/** The refusals that mean a path is not one Rust will touch: the folder or file is, to a read, not there. */
const PATH_REFUSALS: ReadonlySet<string> = new Set(["InvalidPathError", "OutsideRootError"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** asRefusal is what Rust rejected with ({name, message}) as a DesktopError, or err itself as an Error. */
function asRefusal(err: unknown): Error {
  if (isRecord(err) && typeof err["name"] === "string" && typeof err["message"] === "string") {
    return new DesktopError(err["name"], err["message"]);
  }
  return err instanceof Error ? err : new DesktopError("DesktopError", String(err));
}

/** A check of one command's answer: the value, typed, or why it is not one. */
type Check<T> = (v: unknown) => v is T;

const isNull = (v: unknown): v is null => v === null;
const isString = (v: unknown): v is string => typeof v === "string";
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const isOpened = (v: unknown): v is Opened =>
  isRecord(v) && Number.isInteger(v["rootId"]) && (v["rootId"] as number) >= 0 && isString(v["name"]);
const isStamp = (v: unknown): v is Stamp =>
  isRecord(v) && typeof v["mtime"] === "number" && typeof v["size"] === "number";
const isRecent = (v: unknown): v is NativeRecent =>
  isRecord(v) && isString(v["path"]) && isString(v["name"]) && typeof v["openedAt"] === "number";
const isRecents = (v: unknown): v is NativeRecent[] => Array.isArray(v) && v.every(isRecent);
const or =
  <T,>(check: Check<T>): Check<T | null> =>
  (v: unknown): v is T | null =>
    v === null || check(v);

/**
 * call sends one command and gives its answer, once check says it is the
 * kind of answer cmd gives. A refusal rejects with a DesktopError named as
 * Rust named it.
 */
async function call<T>(bridge: Bridge, cmd: string, args: Record<string, unknown>, check: Check<T>): Promise<T> {
  let value: unknown;
  try {
    value = await bridge.invoke(cmd, args);
  } catch (err) {
    throw asRefusal(err);
  }
  if (!check(value)) throw new DesktopError("InvalidAnswer", `The desktop app's answer to ${cmd} was not the kind it gives, so Starboard did not use it.`);
  return value;
}

/** TauriHost is a Host whose files the desktop app's Rust side reads and writes, under one opened root. */
export class TauriHost implements Host {
  readonly kind = "tauri";
  readonly canWrite = true;
  readonly name: string;
  readonly rootId: number;
  private content = DEFAULT_CONTENT;
  private listed: ReadonlySet<string> = new Set();
  /** The folders the last readAll walked, and what each listed. */
  private walks = new Map<string, string[]>();
  /** The files scope named that no walk listed, and whether each was there at the last readAll. */
  private named = new Map<string, boolean>();
  /** Every path the app has written or deleted since the last readAll: its own changes to the listing. */
  private own = new Set<string>();
  private readonly bridge: Bridge;
  private readonly scope: ScopeFn;

  constructor(bridge: Bridge, opened: Opened, scope: ScopeFn) {
    this.bridge = bridge;
    this.rootId = opened.rootId;
    this.name = opened.name;
    this.scope = scope;
  }

  private call<T>(cmd: string, args: Record<string, unknown>, check: Check<T>): Promise<T> {
    return call(this.bridge, cmd, { rootId: this.rootId, ...args }, check);
  }

  /**
   * readAll lists only what core.scope says the project can reach, as the
   * fsaccess host does: the folders it walks (Rust lists node_modules only
   * when one of them reaches it) and the files it names. A walked folder or
   * a named file that Rust refuses to touch (a path out of the project) is
   * taken as not there, so lint reports it missing.
   */
  async readAll(): Promise<Files> {
    const walks = new Map<string, string[]>();
    const named = new Map<string, boolean>();
    const { files, content, listedOnly } = await selectFiles(
      {
        walk: async (dir) => {
          const paths = await this.walk(dir);
          walks.set(dir, paths);
          return paths;
        },
        // A named file that cannot be stat'ed at all (refused, or access
        // denied) is left out, as fsaccess leaves it out. selectFiles asks
        // only of the named files no walk listed.
        isFile: async (path) => {
          const there = await this.isThere(path);
          named.set(path, there);
          return there;
        },
        read: async (path) => {
          const text = await this.call("read_text", { path }, or(isString));
          if (text !== null) return text;
          if (path === CONFIG_FILE) throw new NoProjectError(this.name);
          throw new DesktopError("NotFoundError", `${path} disappeared while Starboard read the project; reload it.`);
        },
      },
      this.scope,
    );
    this.content = content;
    this.listed = listedOnly;
    this.walks = walks;
    this.named = named;
    this.own = new Set();
    return files;
  }

  /** isThere reports whether path is a file Rust can stat: one refused, or denied, is not. */
  private async isThere(path: string): Promise<boolean> {
    return (await this.stat(path).catch(() => null)) !== null;
  }

  /** walk lists dir; a folder Rust refuses to touch (a path out of the project) lists nothing. */
  private async walk(dir: string): Promise<string[]> {
    try {
      return await this.call("list", { dir }, isStrings);
    } catch (err) {
      if (err instanceof DesktopError && PATH_REFUSALS.has(err.name)) return [];
      throw err;
    }
  }

  /**
   * listingChanged lists again the folders the last readAll walked, and
   * asks again whether each file scope named outside them is there (a
   * screenshot, a vocabulary), and reports whether a file was made or
   * deleted since, other than by the app itself: the change to the project
   * that a check of the files already read cannot see.
   */
  async listingChanged(): Promise<boolean> {
    for (const [dir, before] of this.walks) {
      const now = new Set(await this.walk(dir));
      const was = new Set(before);
      const differs = (a: Set<string>, b: Set<string>) => [...a].some((p) => !b.has(p) && !this.own.has(p));
      if (differs(now, was) || differs(was, now)) return true;
    }
    const named = [...this.named].filter(([path]) => !this.own.has(path));
    const there = await Promise.all(named.map(([path]) => this.isThere(path)));
    return named.some(([, was], i) => there[i] !== was);
  }

  async read(path: string): Promise<string | null> {
    checkPath(path);
    return this.call("read_text", { path }, or(isString));
  }

  async stat(path: string): Promise<Stamp | null> {
    checkPath(path);
    return this.call("stat", { path }, or(isStamp));
  }

  listedOnly(): ReadonlySet<string> {
    return this.listed;
  }

  /**
   * write checks changes as every host does (checkChanges: clean paths,
   * deletions only under <content>/generated/), then sends them to Rust,
   * which checks them again against starboard.yaml as it read it and
   * writes each file atomically. A write that fails part way leaves the
   * files already written, and rejects; the app keeps the change to save again.
   */
  async write(changes: Record<string, string | null>): Promise<void> {
    checkChanges(changes, this.content);
    if (Object.keys(changes).length === 0) return;
    // Counted before the write, so one that lands part way is the app's too.
    for (const path of Object.keys(changes)) this.own.add(path);
    await this.call("write", { changes }, isNull);
  }
}

/**
 * desktopOpener is the desktop app's NativeOpener: its folder dialog, its
 * recent projects and the folder it was started with, each a TauriHost on
 * the root Rust opened. A recent project that has moved or gone rejects
 * with Rust's MovedError, and Rust has taken it off the list.
 */
export function desktopOpener(bridge: Bridge, scope: ScopeFn): NativeOpener {
  const host = (opened: Opened) => new TauriHost(bridge, opened, scope);
  return {
    kind: "tauri",
    pick: async () => {
      const opened = await call(bridge, "open_dialog", {}, or(isOpened));
      return opened && host(opened);
    },
    recents: () => call(bridge, "recents", {}, isRecents),
    reopen: async (path) => host(await call(bridge, "open_recent", { path }, isOpened)),
    arg: async () => {
      const opened = await call(bridge, "open_arg", {}, or(isOpened));
      return opened && host(opened);
    },
  };
}

/** The event Rust's watcher (watch.rs) sends, with no payload, once the open project has changed on disk. */
export const FILES_CHANGED = "files-changed";

/** The one end of Tauri's events the page needs: listening for one. */
export interface Events {
  listen(event: string, handler: (e: { payload: unknown }) => void): Promise<unknown>;
}

/** tauriEvents is Tauri's own listen. */
export function tauriEvents(): Events {
  return { listen: (event, handler) => listen(event, handler) };
}

/**
 * onFilesChanged runs check on each files-changed. The event says only that
 * something changed; check (followProject's answer) decides what did.
 */
export async function onFilesChanged(events: Events, check: () => Promise<unknown>): Promise<void> {
  await events.listen(FILES_CHANGED, () => {
    void check();
  });
}

/** The part of the app's state followProject answers through. */
export interface FollowedState {
  host: { readonly value: Host | null };
  checkDisk(): Promise<boolean>;
  reload(): Promise<void>;
}

/**
 * answerFilesChanged is the page's answer to one files-changed (D14): when
 * a file was made or deleted in a folder core's scope walks (a new flow an
 * agent wrote, say), or a file it names outside them (a screenshot), the
 * project is read again (state's reload, queued behind any save, as the
 * VS Code panel reads it again); otherwise the
 * app's own check runs (checkDisk), whose stamps decide whether anything
 * it read changed, so the app's own writes reload nothing. A failure is
 * left to the caller, which shows it.
 */
export async function answerFilesChanged(state: FollowedState): Promise<unknown> {
  const host = state.host.value;
  if (host instanceof TauriHost && (await host.listingChanged()) && state.host.value === host) {
    return state.reload();
  }
  return state.checkDisk();
}

/**
 * followProject answers each files-changed with answerFilesChanged, and
 * says through onError what went wrong when an answer fails.
 */
export function followProject(events: Events, state: FollowedState, onError: (err: unknown) => void): Promise<void> {
  return onFilesChanged(events, () => answerFilesChanged(state).catch(onError));
}

/** The event the native menu (menu.rs) sends: Open Folder…, or a project from Open Recent. */
export const MENU_OPEN = "menu-open";

/** What the page does for each menu-open: the start screen's own open actions. */
export interface MenuActions {
  folder(): Promise<unknown>;
  recent(path: string): Promise<unknown>;
}

/**
 * onMenuOpen runs the open action each menu-open names: the folder dialog
 * for {kind: "folder"}, a recent project for {kind: "recent", path}. A
 * payload of any other shape is ignored.
 */
export async function onMenuOpen(events: Events, actions: MenuActions): Promise<void> {
  await events.listen(MENU_OPEN, ({ payload }) => {
    if (!isRecord(payload)) return;
    if (payload["kind"] === "folder") void actions.folder();
    else if (payload["kind"] === "recent" && isString(payload["path"])) void actions.recent(payload["path"]);
  });
}
