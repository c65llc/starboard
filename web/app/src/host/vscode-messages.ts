// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The messages between the VS Code extension and the app in its panel
// (embed.tsx), and the guards each side reads them through. Both sides
// import this file, so the two agree on one shape. A message that is not
// one of these, or that names a path other than a clean project-relative
// one, is refused before anything acts on it.
//
// The page asks; the extension answers with a reply of the same id: the
// project's files (its WorkspaceHost, unsaved buffers laid over the disk),
// one file's text, a stamp, a write (through applyCoreResult), or a core
// call answered by the extension's own core for the project, so the panel
// and the editor read one model and the page runs no WebAssembly. A core
// call's files are checked here for their shape alone: the extension
// ignores them and passes core its own read of the project. The extension
// also tells the page when the project changed (reload), and, when it
// refused a write, to read the project afresh (reread), since the change
// the page kept to save again can never be written.

import { checkPath } from "./host.ts";

/**
 * The core calls the page may make: those web/app makes (state.ts's model,
 * lint, edit and fix; the wireframes' render; the walkthrough; and the
 * screen editor's scope, which finds screens.yaml). No other.
 */
export const CORE_FNS = ["model", "lint", "edit", "fix", "render", "walkthrough", "scope"] as const;
export type CoreFn = (typeof CORE_FNS)[number];

/** The most bytes of text one write may carry, all its files together. */
export const MAX_WRITE_BYTES = 4 * 1024 * 1024;
/**
 * The most text, in UTF-16 code units, a core call's files may hold
 * together: far past any real project, and counted without encoding it.
 */
export const MAX_CORE_CHARS = 64 * 1024 * 1024;

/** What the panel's page gives the bundle, as JSON in its #app element's data-embed. */
export interface EmbedConfig {
  /** The route the panel opens on: #/screens/<id>, #/flows/<id>, #/map or #/map/<id>. */
  route: string;
  /** The project folder's name, shown in the header. */
  name: string;
  /** Set only under the integration tests (STARBOARD_PANEL_TEST): turns on the test-only messages. */
  test?: boolean;
}

// ---------------------------------------------------------------------
// Page → extension.

export type Request =
  | { type: "readAll"; id: number }
  | { type: "read"; id: number; path: string }
  | { type: "stat"; id: number; path: string }
  /**
   * changes is each file's new text, or null to delete it: exactly the
   * files of one edit or fix result the extension gave this page.
   */
  | { type: "write"; id: number; changes: Record<string, string | null> }
  | { type: "core"; id: number; fn: CoreFn; args: unknown[] };

export type RequestType = Request["type"];

export type ToExtension =
  | Request
  /** Test-only: what the view shows: its h1, its tabs' labels, how many screens the app map draws, and the notice ("" for none). */
  | { type: "rendered"; heading: string; tabs: string[]; nodes: number; notice: string }
  /** Test-only: the outcome of a test-apply or a test-fix. */
  | { type: "applied"; outcome: string };

// ---------------------------------------------------------------------
// Extension → page.

export type Reply =
  | { type: "reply"; id: number; ok: true; value: unknown }
  | { type: "reply"; id: number; ok: false; error: string; name: string };

export type FromExtension =
  | Reply
  /** The project changed (a file, or a buffer typed in): check it again. */
  | { type: "reload" }
  /**
   * A write was refused (reason is why): read the project afresh, dropping
   * the change kept to save again, and say why. A reload would only check
   * what changed, and a refusal changes nothing.
   */
  | { type: "reread"; reason: string }
  /** Test-only: apply these ops through the app's state, as a form's change would. */
  | { type: "test-apply"; ops: Record<string, unknown>[] }
  /** Test-only: run Fix through the app's state, as the lint panel's Fix button does. */
  | { type: "test-fix" };

/** What readAll answers: the files, the content root, and the paths listed by name only. */
export interface ReadAllResult {
  files: Record<string, string>;
  content: string;
  listedOnly: string[];
}

// ---------------------------------------------------------------------
// The guards.

/** A guard's verdict: the message, typed, or why it was refused. */
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const refuse = (error: string): { ok: false; error: string } => ({ ok: false, error });

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v);
}

function isId(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

/** isPath reports whether v is a clean project-relative slash path (host.ts's checkPath). */
export function isPath(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try {
    checkPath(v);
    return true;
  } catch {
    return false;
  }
}

/** isFiles reports whether v is project-relative paths to text. */
function isFiles(v: unknown): v is Record<string, string> {
  return isObject(v) && Object.entries(v).every(([k, t]) => isPath(k) && typeof t === "string");
}

const isString = (v: unknown): v is string => typeof v === "string";

/** coreFilesTooBig reports whether a core call's files hold more than MAX_CORE_CHARS of text together. */
function coreFilesTooBig(files: Record<string, string>): boolean {
  let n = 0;
  for (const [k, t] of Object.entries(files)) {
    n += k.length + t.length;
    if (n > MAX_CORE_CHARS) return true;
  }
  return false;
}

/** checkCoreArgs checks a core call's arguments: the project's files first, then that call's own. */
function checkCoreArgs(fn: CoreFn, args: unknown[]): string | undefined {
  const files = args[0];
  if (!isFiles(files)) return `${fn} takes the project's files first`;
  if (coreFilesTooBig(files)) return `the files are over ${MAX_CORE_CHARS} characters`;
  const rest = args.slice(1);
  switch (fn) {
    case "model":
    case "fix":
    case "scope":
      return rest.length === 0 ? undefined : `${fn} takes only the project's files`;
    case "lint":
      return rest.length === 0 || (rest.length === 1 && typeof rest[0] === "boolean") ? undefined : "lint takes the files and strict";
    case "edit":
      return rest.length === 1 && Array.isArray(rest[0]) && rest[0].every(isObject) ? undefined : "edit takes the files and a list of ops";
    case "render":
      return (rest.length === 2 || rest.length === 3) && rest.every(isString)
        ? undefined
        : "render takes the files, a screen, a form factor and a region";
    case "walkthrough":
      return rest.length === 2 && rest.every(isString) ? undefined : "walkthrough takes the files, a flow and a form factor";
  }
}

/** checkWrite checks a write's changes: clean paths, text or null, within MAX_WRITE_BYTES. */
function checkWrite(changes: unknown): string | undefined {
  if (!isObject(changes)) return "a write carries changes";
  const paths = Object.keys(changes);
  if (paths.length === 0) return "a write changes at least one file";
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const path of paths) {
    if (!isPath(path)) return `${JSON.stringify(path)} is not a path inside the project`;
    const text = changes[path];
    if (text === null) continue;
    if (typeof text !== "string") return `${path}: a write is text, or null to delete`;
    bytes += encoder.encode(text).length;
    if (bytes > MAX_WRITE_BYTES) return `the write is over ${MAX_WRITE_BYTES} bytes`;
  }
  return undefined;
}

/** checkToExtension reads a message from the page; the extension acts on nothing else. */
export function checkToExtension(msg: unknown): Checked<ToExtension> {
  if (!isObject(msg) || typeof msg["type"] !== "string") return refuse("not a message");
  const m = msg;
  const pathOf = (key: string) => (isPath(m[key]) ? undefined : `${JSON.stringify(m[key])} is not a path inside the project`);
  const withId = (check?: string): Checked<ToExtension> => {
    if (!isId(m["id"])) return refuse(`${String(m["type"])} has no id`);
    return check === undefined ? { ok: true, value: m as unknown as ToExtension } : refuse(check);
  };
  switch (m["type"]) {
    case "readAll":
      return withId();
    case "read":
    case "stat":
      return withId(pathOf("path"));
    case "write":
      return withId(checkWrite(m["changes"]));
    case "core": {
      const fn = m["fn"];
      if (!(CORE_FNS as readonly unknown[]).includes(fn)) return withId(`core has no call ${JSON.stringify(fn)} here`);
      const args = m["args"];
      return withId(Array.isArray(args) ? checkCoreArgs(fn as CoreFn, args) : "core's args are a list");
    }
    case "rendered":
      return typeof m["heading"] === "string" && Array.isArray(m["tabs"]) && m["tabs"].every(isString) && isId(m["nodes"]) && typeof m["notice"] === "string"
        ? { ok: true, value: m as unknown as ToExtension }
        : refuse("rendered carries a heading, the tabs, a count and the notice");
    case "applied":
      return typeof m["outcome"] === "string" ? { ok: true, value: m as unknown as ToExtension } : refuse("applied carries an outcome");
    default:
      return refuse(`unknown message type ${JSON.stringify(m["type"])}`);
  }
}

/** checkFromExtension reads a message from the extension; the page acts on nothing else. */
export function checkFromExtension(msg: unknown): Checked<FromExtension> {
  if (!isObject(msg) || typeof msg["type"] !== "string") return refuse("not a message");
  switch (msg["type"]) {
    case "reply": {
      if (!isId(msg["id"]) || typeof msg["ok"] !== "boolean") return refuse("a reply has an id and ok");
      if (!msg["ok"] && !(typeof msg["error"] === "string" && typeof msg["name"] === "string")) return refuse("a failed reply has an error");
      return { ok: true, value: msg as unknown as FromExtension };
    }
    case "reload":
      return { ok: true, value: { type: "reload" } };
    case "reread":
      return typeof msg["reason"] === "string" ? { ok: true, value: { type: "reread", reason: msg["reason"] } } : refuse("reread carries a reason");
    case "test-fix":
      return { ok: true, value: { type: "test-fix" } };
    case "test-apply":
      return Array.isArray(msg["ops"]) && msg["ops"].every(isObject)
        ? { ok: true, value: msg as unknown as FromExtension }
        : refuse("test-apply carries ops");
    default:
      return refuse(`unknown message type ${JSON.stringify(msg["type"])}`);
  }
}

/**
 * checkValue checks a successful reply's value against what its request
 * asked for, so a reply to stat is a stamp and readAll's paths are clean.
 */
export function checkValue(type: RequestType, value: unknown): Checked<unknown> {
  const ok = (good: boolean, what: string): Checked<unknown> => (good ? { ok: true, value } : refuse(`${type} did not answer ${what}`));
  switch (type) {
    case "readAll":
      return ok(
        isObject(value) &&
          isFiles(value["files"]) &&
          typeof value["content"] === "string" &&
          Array.isArray(value["listedOnly"]) &&
          value["listedOnly"].every(isPath),
        "the project's files",
      );
    case "read":
      return ok(value === null || typeof value === "string", "text");
    case "stat":
      return ok(
        value === null || (isObject(value) && typeof value["mtime"] === "number" && typeof value["size"] === "number"),
        "a stamp",
      );
    case "write":
      return ok(value === null, "that it wrote");
    case "core":
      // render answers an SVG's text; the others an object.
      return ok(typeof value === "string" || (typeof value === "object" && value !== null), "a result");
  }
}
