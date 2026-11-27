// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The worker loop, with a fake Go runtime and bridge in place of
// wasm_exec.js and starboard.wasm.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { FromWorker, ToWorker } from "../src/protocol.ts";
import { serve } from "../src/serve.ts";
import type { Instantiate } from "../src/serve.ts";

const wasmExecUrl = new URL("./empty-module.ts", import.meta.url).href;
const init: ToWorker = { type: "init", wasmUrl: "file:///starboard.wasm", wasmExecUrl };

type Global = Record<string, unknown>;
const g = globalThis as unknown as Global;

afterEach(() => {
  delete g["Go"];
  delete g["__starboard"];
});

/** fakeGo installs a Go runtime whose run registers bridge and returns exit. */
function fakeGo(bridge: Record<string, (arg: string) => string> | undefined) {
  let exit: (() => void) | undefined;
  g["Go"] = class {
    importObject = { go: {} };
    run(): Promise<void> {
      if (bridge) g["__starboard"] = bridge;
      return new Promise<void>((resolve) => (exit = resolve));
    }
  };
  return { exit: () => exit?.() };
}

/** start serves on a fake port; send delivers messages, got collects replies. */
function start(instantiate: Instantiate = async () => ({}) as WebAssembly.Instance) {
  const got: FromWorker[] = [];
  let handle: ((msg: ToWorker) => void) | undefined;
  serve({ postMessage: (msg) => void got.push(msg), onMessage: (h) => (handle = h) }, instantiate);
  return { got, send: (msg: ToWorker) => handle?.(msg) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const echo = {
  model: (arg: string) => JSON.stringify({ ok: true, value: JSON.parse(arg) as unknown }),
  render: () => JSON.stringify({ ok: false, error: "render: unknown screen" }),
  lint: () => {
    throw new Error("Go program has already exited");
  },
};

describe("serve", () => {
  it("answers calls that arrive while loading, in order, with the bridge's envelope", async () => {
    fakeGo(echo);
    const urls: string[] = [];
    const { got, send } = start(async (url: string) => {
      urls.push(url);
      return {} as WebAssembly.Instance;
    });
    send(init);
    send(init); // a second init is ignored
    send({ type: "call", id: 1, fn: "model", arg: '{"files":{}}' });
    send({ type: "call", id: 2, fn: "render", arg: "{}" });
    send({ type: "call", id: 3, fn: "format", arg: "{}" });
    await vi.waitFor(() => expect(got).toHaveLength(3));
    expect(urls).toEqual(["file:///starboard.wasm"]);
    expect(got).toEqual([
      { type: "reply", id: 1, ok: true, value: { files: {} } },
      { type: "reply", id: 2, ok: false, error: "render: unknown screen" },
      { type: "reply", id: 3, ok: false, error: 'unknown function "format"' },
    ]);
  });

  it("reports a throw out of the module as a crash, once, and answers nothing after", async () => {
    fakeGo(echo);
    const { got, send } = start();
    send(init);
    send({ type: "call", id: 1, fn: "lint", arg: "{}" });
    send({ type: "call", id: 2, fn: "model", arg: "{}" });
    await vi.waitFor(() => expect(got).toHaveLength(1));
    await settle(); // the crash is final: nothing follows it
    expect(got).toEqual([
      { type: "crash", error: "starboard.wasm failed in lint: Error: Go program has already exited" },
    ]);
  });

  it("reports the program exiting as a crash", async () => {
    const go = fakeGo(echo);
    const { got, send } = start();
    send(init);
    await vi.waitFor(() => expect(g["__starboard"]).toBeDefined());
    go.exit();
    await vi.waitFor(() => expect(got).toHaveLength(1));
    expect(got).toEqual([{ type: "crash", error: "starboard.wasm exited" }]);
  });

  it("reports a module that will not load as a crash", async () => {
    fakeGo(echo);
    const { got, send } = start(async () => {
      throw new Error("404 Not Found");
    });
    send(init);
    send({ type: "call", id: 1, fn: "model", arg: "{}" });
    await vi.waitFor(() => expect(got).toHaveLength(1));
    expect(got).toEqual([{ type: "crash", error: "loading starboard.wasm failed: Error: 404 Not Found" }]);
  });

  it("reports a wasm_exec.js that defines no Go as a crash", async () => {
    const { got, send } = start();
    send(init);
    await vi.waitFor(() => expect(got).toHaveLength(1));
    expect(got).toEqual([
      { type: "crash", error: `loading starboard.wasm failed: Error: ${wasmExecUrl} did not define Go` },
    ]);
  });

  it("reports a module that registers no bridge as a crash", async () => {
    fakeGo(undefined);
    const { got, send } = start();
    send(init);
    await vi.waitFor(() => expect(got).toHaveLength(1));
    expect(got).toEqual([
      {
        type: "crash",
        error: "loading starboard.wasm failed: Error: starboard.wasm did not register globalThis.__starboard",
      },
    ]);
  });

  it("reports a call before init as a crash", () => {
    const { got, send } = start();
    send({ type: "call", id: 1, fn: "model", arg: "{}" });
    expect(got).toEqual([{ type: "crash", error: "call 1 arrived before init" }]);
  });
});
