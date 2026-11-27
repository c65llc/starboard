// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The request/response/restart logic, independent of how the worker is
// hosted: the browser's module Worker (index.ts) and the tests'
// worker_threads shim are both a TransportFactory.

import type { FnName, FromWorker, ToWorker } from "./protocol.ts";
import type {
  EditOp,
  EditResult,
  Files,
  FixResult,
  LintResult,
  Model,
  ScopeResult,
  Walk,
} from "./types.ts";

/** Starboard's core, each call answered by starboard.wasm in a worker. */
export interface StarboardCore {
  /** Lint as `starboard lint` does; strict also fails on warnings. */
  lint(files: Files, strict?: boolean): Promise<LintResult>;
  /** The files `starboard fmt` would rewrite, in canonical form. */
  format(files: Files): Promise<Record<string, string>>;
  /** Every file `starboard generate` writes. */
  generate(files: Files): Promise<Record<string, string>>;
  /** What `starboard lint --fix` would write and remove. */
  fix(files: Files): Promise<FixResult>;
  /**
   * The SVG wireframe `starboard render` prints; "" formFactor is the
   * screen's first. With region, that region is outlined, as a walkthrough
   * step's is, without a step badge.
   */
  render(files: Files, screen: string, formFactor: string, region?: string): Promise<string>;
  /** The screens and flows, as far as they loaded. */
  model(files: Files): Promise<Model>;
  /** The flow (its file's stem) as a storyboard on formFactor. */
  walkthrough(files: Files, flow: string, formFactor: string): Promise<Walk>;
  /** Applies ops in order; returns the changed files and the lint of the result. */
  edit(files: Files, ops: EditOp[]): Promise<EditResult>;
  /**
   * Which of a folder's files the project uses, so a host reads only those.
   * files is the folder as listed: starboard.yaml read, the rest present
   * with or without contents.
   */
  scope(files: Files): Promise<ScopeResult>;
  /** Stops the worker and rejects what is in flight; a later call starts a new one. */
  close(): void;
}

/** Core refused the call, such as for an unknown screen; the worker is fine. */
export class StarboardError extends Error {
  override name = "StarboardError";
}

/** The worker died, failed to load the module, or the module exited; the call never finished. */
export class StarboardCrashError extends Error {
  override name = "StarboardCrashError";
}

/** What a transport reports back to the client. */
export interface TransportEvents {
  message(msg: FromWorker): void;
  /** The worker is unusable: it errored, exited, or could not start. */
  crash(error: Error): void;
}

/** A started worker; the factory has already sent it its InitMessage. */
export interface Transport {
  post(msg: ToWorker): void;
  terminate(): void;
}

export type TransportFactory = (events: TransportEvents) => Transport;

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export interface ClientOptions {
  /**
   * How long, in ms, a worker with calls in flight may go without sending
   * anything before it is taken for hung and treated as crashed. 0 turns
   * the watchdog off.
   *
   * The module runs each call synchronously, so it cannot report progress
   * mid-call; silence is the only sign of a hang, and the wait has to
   * outlast the slowest real call. So: the watchdog is not armed until a
   * worker has answered once (fetching and compiling the module, however
   * slow the link, never trips it); the wait restarts on every reply (a
   * queue of slow calls is not cut short); and the default is ten minutes,
   * far past any lint or edit of a real project, so only a module that has
   * stopped is caught.
   */
  timeoutMs?: number;
}

/** The default ClientOptions.timeoutMs: ten minutes. */
export const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * createClient returns a StarboardCore over workers from spawn. It starts
 * one on the first call, gives every call the next id and settles it with
 * the reply of that id. When the worker crashes, or, once its module is
 * up, goes silent for timeoutMs with calls in flight, it is terminated, every call in flight
 * is rejected with StarboardCrashError, and the next call starts a fresh
 * worker. Events from a replaced worker are ignored.
 */
export function createClient(spawn: TransportFactory, opts: ClientOptions = {}): StarboardCore {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // The live worker's slot; a replaced worker's events find it changed.
  // loaded: the worker has answered once, so its module is up and the watchdog may run.
  let current: { transport?: Transport; loaded?: boolean } | undefined;
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  /** watch (re)starts the wait for the worker while calls are in flight, and stops it otherwise. */
  function watch(): void {
    clearTimeout(watchdog);
    watchdog = undefined;
    const slot = current;
    if (timeoutMs <= 0 || pending.size === 0 || !slot?.loaded) return;
    watchdog = setTimeout(() => {
      if (current !== slot) return;
      const error = new Error(`no reply in ${timeoutMs} ms`);
      stop(new StarboardCrashError(`starboard core crashed: ${error.message}`, { cause: error }));
    }, timeoutMs);
  }

  function stop(error: Error): void {
    current?.transport?.terminate();
    current = undefined;
    const calls = [...pending.values()];
    pending.clear();
    watch();
    for (const call of calls) call.reject(error);
  }

  function worker(): Transport {
    if (current?.transport) return current.transport;
    const slot: { transport?: Transport; loaded?: boolean } = {};
    const live = () => current === slot;
    const crash = (error: Error) => {
      if (live()) stop(new StarboardCrashError(`starboard core crashed: ${error.message}`, { cause: error }));
    };
    current = slot; // before spawn, so an event it sends synchronously counts
    try {
      slot.transport = spawn({
        message(msg) {
          if (!live()) return;
          slot.loaded = true;
          if (msg.type === "crash") {
            crash(new Error(msg.error));
            return;
          }
          const call = pending.get(msg.id);
          if (!call) return;
          pending.delete(msg.id);
          watch();
          if (msg.ok) call.resolve(msg.value);
          else call.reject(new StarboardError(msg.error));
        },
        crash,
      });
    } catch (err) {
      if (live()) current = undefined;
      throw err;
    }
    if (!live()) {
      slot.transport.terminate(); // it crashed while starting; stop could not reach it
      throw new StarboardCrashError("starboard core crashed while starting");
    }
    return slot.transport;
  }

  function call<T>(fn: FnName, args: Record<string, unknown>): Promise<T> {
    let arg: string;
    try {
      arg = JSON.stringify(args);
    } catch (err) {
      return Promise.reject(new StarboardError(`${fn}: the arguments cannot be encoded as JSON`, { cause: err }));
    }
    return new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      try {
        worker().post({ type: "call", id, fn, arg });
        if (pending.size === 1) watch(); // the first in flight; later ones wait on the replies before them
      } catch (err) {
        pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  return {
    lint: (files, strict = false) => call("lint", { files, strict }),
    format: (files) => call("format", { files }),
    generate: (files) => call("generate", { files }),
    fix: (files) => call("fix", { files }),
    render: (files, screen, formFactor, region) =>
      call("render", region ? { files, screen, formFactor, region } : { files, screen, formFactor }),
    model: (files) => call("model", { files }),
    walkthrough: (files, flow, formFactor) => call("walkthrough", { files, flow, formFactor }),
    edit: (files, ops) => call("edit", { files, ops }),
    scope: (files) => call("scope", { files }),
    close: () => stop(new Error("starboard core closed")),
  };
}
