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
// Loaded only by the desktop entry (src/desktop.tsx), so the browser build
// does not carry @tauri-apps/api.

import { invoke } from "@tauri-apps/api/core";

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
    const { files, content, listedOnly } = await selectFiles(
      {
        walk: async (dir) => {
          try {
            return await this.call("list", { dir }, isStrings);
          } catch (err) {
            if (err instanceof DesktopError && PATH_REFUSALS.has(err.name)) return [];
            throw err;
          }
        },
        // A named file that cannot be stat'ed at all (refused, or access
        // denied) is left out, as fsaccess leaves it out.
        isFile: async (path) => (await this.stat(path).catch(() => null)) !== null,
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
    return files;
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
