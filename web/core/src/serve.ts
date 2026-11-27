// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The worker side: load Go's wasm_exec.js and starboard.wasm once, then
// answer each call from globalThis.__starboard. Only instantiation differs
// between hosts, so the browser worker and the Node test shim both call
// serve with their own Instantiate.

import type { CallMessage, FnName, FromWorker, InitMessage, ReplyMessage, ToWorker } from "./protocol.ts";

/** The host's message port. */
export interface Port {
  postMessage(msg: FromWorker): void;
  onMessage(handle: (msg: ToWorker) => void): void;
}

/** Instantiates the module at url with Go's imports. */
export type Instantiate = (url: string, imports: WebAssembly.Imports) => Promise<WebAssembly.Instance>;

type Bridge = Record<FnName, (arg: string) => string>;

interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

interface StarboardGlobal {
  Go?: new () => GoRuntime;
  __starboard?: Bridge;
}

const scope = globalThis as typeof globalThis & StarboardGlobal;

/**
 * serve answers port's calls. The first message must be the InitMessage;
 * calls that arrive while the module loads wait for it. A module that will
 * not load, that exits, or that throws out of a call is reported once as a
 * CrashMessage, and calls after that are not answered: the client
 * terminates the worker.
 */
export function serve(port: Port, instantiate: Instantiate): void {
  let bridge: Promise<Bridge> | undefined;
  let crashed = false;
  const crash = (what: string, err?: unknown) => {
    if (crashed) return;
    crashed = true;
    port.postMessage({ type: "crash", error: err === undefined ? what : `${what}: ${String(err)}` });
  };

  port.onMessage((msg) => {
    if (msg.type === "init") {
      if (bridge) return; // loaded once
      bridge = load(msg, instantiate, crash);
      bridge.catch((err: unknown) => crash("loading starboard.wasm failed", err));
      return;
    }
    if (!bridge) {
      crash(`call ${msg.id} arrived before init`);
      return;
    }
    bridge.then(
      (api) => {
        if (crashed) return;
        try {
          port.postMessage(invoke(api, msg));
        } catch (err) {
          crash(`starboard.wasm failed in ${msg.fn}`, err);
        }
      },
      () => undefined, // reported by the catch above
    );
  });
}

async function load(init: InitMessage, instantiate: Instantiate, crash: (what: string) => void): Promise<Bridge> {
  await import(init.wasmExecUrl);
  if (!scope.Go) throw new Error(`${init.wasmExecUrl} did not define Go`);
  const go = new scope.Go();
  const instance = await instantiate(init.wasmUrl, go.importObject);
  // run returns once main has registered the bridge and blocked; its
  // promise settles only if the program exits.
  void go.run(instance).then(
    () => crash("starboard.wasm exited"),
    () => crash("starboard.wasm exited"),
  );
  const api = scope.__starboard;
  if (!api) throw new Error("starboard.wasm did not register globalThis.__starboard");
  return api;
}

/** invoke runs one call; the bridge never throws for core's own errors. */
function invoke(api: Bridge, msg: CallMessage): ReplyMessage {
  const fn = api[msg.fn];
  if (typeof fn !== "function") {
    return { type: "reply", id: msg.id, ok: false, error: `unknown function ${JSON.stringify(msg.fn)}` };
  }
  const out = JSON.parse(fn(msg.arg)) as { ok: true; value: unknown } | { ok: false; error: string };
  return out.ok
    ? { type: "reply", id: msg.id, ok: true, value: out.value }
    : { type: "reply", id: msg.id, ok: false, error: out.error };
}
