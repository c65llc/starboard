// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The messages between the client and the worker that hosts starboard.wasm.

/** The functions cmd/starboard-wasm puts on globalThis.__starboard. */
export type FnName = "lint" | "format" | "generate" | "fix" | "render" | "model" | "walkthrough" | "edit";

/** The first message to a new worker: where to load the module from. */
export interface InitMessage {
  type: "init";
  wasmUrl: string;
  /** Go's wasm_exec.js from the toolchain that built wasmUrl. */
  wasmExecUrl: string;
}

/**
 * One call. arg is the JSON of the named arguments the Go bridge decodes,
 * encoded by the client, so a value JSON cannot hold (a cycle, a BigInt)
 * fails that call on the main thread instead of crashing the worker.
 */
export interface CallMessage {
  type: "call";
  id: number;
  fn: FnName;
  arg: string;
}

export type ToWorker = InitMessage | CallMessage;

/** The answer to the call with the same id: the bridge's envelope. */
export type ReplyMessage =
  | { type: "reply"; id: number; ok: true; value: unknown }
  | { type: "reply"; id: number; ok: false; error: string };

/** The module failed to load, exited or trapped; the worker is unusable. */
export interface CrashMessage {
  type: "crash";
  error: string;
}

export type FromWorker = ReplyMessage | CrashMessage;
