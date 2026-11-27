// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The request/response/restart logic every transport shares, driven by a
// fake transport whose replies the test sends by hand.

import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient, StarboardCrashError, StarboardError } from "../src/client.ts";
import type { TransportEvents } from "../src/client.ts";
import type { CallMessage, ToWorker } from "../src/protocol.ts";
import type { EditOp } from "../src/types.ts";

interface Fake {
  events: TransportEvents;
  sent: ToWorker[];
  terminated: boolean;
}

function fakes() {
  const spawned: Fake[] = [];
  const factory = (events: TransportEvents) => {
    const fake: Fake = { events, sent: [], terminated: false };
    spawned.push(fake);
    return {
      post: (msg: ToWorker) => void fake.sent.push(msg),
      terminate: () => void (fake.terminated = true),
    };
  };
  return { spawned, factory };
}

/** at is xs[i], failing the test when there is none. */
function at<T>(xs: T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`no element ${i} of ${xs.length}`);
  return x;
}

const files = { "starboard.yaml": "version: 1\n" };

/** calls are the calls fake was sent, each arg decoded from its JSON. */
function calls(fake: Fake): (Omit<CallMessage, "arg"> & { arg: unknown })[] {
  return fake.sent
    .filter((m): m is CallMessage => m.type === "call")
    .map((m) => {
      expect(typeof m.arg).toBe("string"); // encoded on the main thread
      return { ...m, arg: JSON.parse(m.arg) as unknown };
    });
}

describe("createClient", () => {
  it("spawns lazily, once, and sends each call with an incrementing id", () => {
    const { spawned, factory } = fakes();
    const core = createClient(factory);
    expect(spawned).toHaveLength(0);

    void core.lint(files, true);
    void core.render(files, "home", "phone");
    expect(spawned).toHaveLength(1);
    expect(calls(at(spawned, 0))).toEqual([
      { type: "call", id: 1, fn: "lint", arg: { files, strict: true } },
      { type: "call", id: 2, fn: "render", arg: { files, screen: "home", formFactor: "phone" } },
    ]);
  });

  it("sends every function's named arguments", () => {
    const { spawned, factory } = fakes();
    const core = createClient(factory);
    const ops: EditOp[] = [{ op: "removeScreen", screen: "home" }];
    void core.lint(files);
    void core.format(files);
    void core.generate(files);
    void core.fix(files);
    void core.model(files);
    void core.walkthrough(files, "add-activity", "phone");
    void core.edit(files, ops);
    void core.scope(files);
    expect(calls(at(spawned, 0)).map(({ fn, arg }) => ({ fn, arg }))).toEqual([
      { fn: "lint", arg: { files, strict: false } },
      { fn: "format", arg: { files } },
      { fn: "generate", arg: { files } },
      { fn: "fix", arg: { files } },
      { fn: "model", arg: { files } },
      { fn: "walkthrough", arg: { files, flow: "add-activity", formFactor: "phone" } },
      { fn: "edit", arg: { files, ops } },
      { fn: "scope", arg: { files } },
    ]);
  });

  it("matches replies to calls by id, in any order", async () => {
    const { spawned, factory } = fakes();
    const core = createClient(factory);
    const a = core.render(files, "a", "phone");
    const b = core.render(files, "b", "phone");
    const { events } = at(spawned, 0);
    events.message({ type: "reply", id: 2, ok: true, value: "<svg b/>" });
    events.message({ type: "reply", id: 1, ok: true, value: "<svg a/>" });
    await expect(a).resolves.toBe("<svg a/>");
    await expect(b).resolves.toBe("<svg b/>");
  });

  it("rejects with StarboardError when core returns an error", async () => {
    const { spawned, factory } = fakes();
    const core = createClient(factory);
    const p = core.model(files);
    at(spawned, 0).events.message({ type: "reply", id: 1, ok: false, error: "model: unknown screen" });
    await expect(p).rejects.toBeInstanceOf(StarboardError);
    await expect(p).rejects.toThrow("model: unknown screen");
  });

  it("ignores a reply to no pending call", async () => {
    const { spawned, factory } = fakes();
    const core = createClient(factory);
    const p = core.model(files);
    at(spawned, 0).events.message({ type: "reply", id: 99, ok: true, value: "stray" });
    at(spawned, 0).events.message({ type: "reply", id: 1, ok: true, value: { screens: [], flows: [] } });
    at(spawned, 0).events.message({ type: "reply", id: 1, ok: true, value: "again" });
    await expect(p).resolves.toEqual({ screens: [], flows: [] });
  });

  it("on a crash rejects every in-flight call, terminates, and restarts on the next call", async () => {
    const { spawned, factory } = fakes();
    const core = createClient(factory);
    const a = core.model(files);
    const b = core.lint(files);
    at(spawned, 0).events.crash(new Error("RuntimeError: unreachable"));
    await expect(a).rejects.toBeInstanceOf(StarboardCrashError);
    await expect(b).rejects.toThrow("starboard core crashed: RuntimeError: unreachable");
    expect(at(spawned, 0).terminated).toBe(true);

    const c = core.format(files);
    expect(spawned).toHaveLength(2);
    expect(calls(at(spawned, 1))).toEqual([{ type: "call", id: 3, fn: "format", arg: { files } }]);
    at(spawned, 1).events.message({ type: "reply", id: 3, ok: true, value: {} });
    await expect(c).resolves.toEqual({});
  });

  it("treats a crash message from the worker as a crash", async () => {
    const { spawned, factory } = fakes();
    const core = createClient(factory);
    const p = core.model(files);
    at(spawned, 0).events.message({ type: "crash", error: "starboard.wasm exited" });
    await expect(p).rejects.toThrow("starboard core crashed: starboard.wasm exited");
    expect(at(spawned, 0).terminated).toBe(true);
  });

  it("ignores events from a worker it has replaced", async () => {
    const { spawned, factory } = fakes();
    const core = createClient(factory);
    const a = core.model(files);
    at(spawned, 0).events.crash(new Error("first"));
    await expect(a).rejects.toThrow("first");

    const b = core.model(files);
    at(spawned, 0).events.crash(new Error("late exit of the old worker"));
    at(spawned, 0).events.message({ type: "reply", id: 2, ok: true, value: "from the dead" });
    at(spawned, 1).events.message({ type: "reply", id: 2, ok: true, value: "live" });
    await expect(b).resolves.toBe("live");
    expect(spawned).toHaveLength(2);
  });

  it("rejects only the call whose arguments JSON cannot encode, without touching the worker", async () => {
    const { spawned, factory } = fakes();
    const core = createClient(factory);
    const ok = core.model(files);
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const bad = [
      core.edit(files, [{ op: "set", screen: "home", key: "title", value: cyclic }]),
      core.edit(files, [{ op: "set", screen: "home", key: "title", value: 1n }]),
    ];
    for (const p of bad) await expect(p).rejects.toBeInstanceOf(StarboardError);
    await expect(bad[0]).rejects.toThrow("edit: the arguments cannot be encoded as JSON");
    expect(calls(at(spawned, 0)).map((c) => c.id)).toEqual([1]); // nothing posted for the bad calls
    expect(at(spawned, 0).terminated).toBe(false);
    at(spawned, 0).events.message({ type: "reply", id: 1, ok: true, value: { screens: [], flows: [] } });
    await expect(ok).resolves.toEqual({ screens: [], flows: [] });
  });

  it("rejects a call whose message cannot be posted", async () => {
    const core = createClient(() => ({
      post: () => {
        throw new Error("DataCloneError");
      },
      terminate: () => undefined,
    }));
    await expect(core.model(files)).rejects.toThrow("DataCloneError");
  });

  it("rejects the call when the worker crashes while starting, and retries next time", async () => {
    let terminated = 0;
    let attempt = 0;
    const core = createClient((events) => {
      attempt++;
      if (attempt === 1) events.crash(new Error("no Worker support"));
      return {
        post: (msg: ToWorker) => {
          if (msg.type === "call") events.message({ type: "reply", id: msg.id, ok: true, value: "ok" });
        },
        terminate: () => void terminated++,
      };
    });
    await expect(core.model(files)).rejects.toThrow("starboard core crashed: no Worker support");
    expect(terminated).toBe(1);
    await expect(core.render(files, "a", "phone")).resolves.toBe("ok");
  });

  it("rejects the call when the factory throws, and retries next time", async () => {
    const { spawned, factory } = fakes();
    let first = true;
    const core = createClient((events) => {
      if (first) {
        first = false;
        throw new Error("blocked by CSP");
      }
      return factory(events);
    });
    await expect(core.model(files)).rejects.toThrow("blocked by CSP");
    void core.model(files);
    expect(spawned).toHaveLength(1);
  });

  it("close terminates the worker and rejects what is in flight", async () => {
    const { spawned, factory } = fakes();
    const core = createClient(factory);
    const p = core.model(files);
    core.close();
    await expect(p).rejects.toThrow("starboard core closed");
    expect(at(spawned, 0).terminated).toBe(true);
    core.close(); // closing twice is harmless
  });

  describe("watchdog", () => {
    afterEach(() => void vi.useRealTimers());

    it("treats a worker silent for timeoutMs with calls in flight as crashed", async () => {
      vi.useFakeTimers();
      const { spawned, factory } = fakes();
      const core = createClient(factory, { timeoutMs: 1000 });
      const p = core.model(files);
      const rejected = expect(p).rejects.toThrow("starboard core crashed: no reply in 1000 ms");
      vi.advanceTimersByTime(1000);
      await rejected;
      expect(at(spawned, 0).terminated).toBe(true);
      void core.model(files);
      expect(spawned).toHaveLength(2);
    });

    it("restarts the wait on every reply, and stops it when nothing is in flight", async () => {
      vi.useFakeTimers();
      const { spawned, factory } = fakes();
      const core = createClient(factory, { timeoutMs: 1000 });
      const a = core.model(files);
      const b = core.model(files);
      vi.advanceTimersByTime(900);
      at(spawned, 0).events.message({ type: "reply", id: 1, ok: true, value: "a" });
      await expect(a).resolves.toBe("a");
      vi.advanceTimersByTime(900); // 1800 ms since b was sent, 900 since the last reply
      at(spawned, 0).events.message({ type: "reply", id: 2, ok: true, value: "b" });
      await expect(b).resolves.toBe("b");
      vi.advanceTimersByTime(5000); // idle: no call to time out
      expect(at(spawned, 0).terminated).toBe(false);
    });

    it("never fires with timeoutMs 0", () => {
      vi.useFakeTimers();
      const { spawned, factory } = fakes();
      const core = createClient(factory, { timeoutMs: 0 });
      void core.model(files);
      vi.advanceTimersByTime(10 * 60_000);
      expect(at(spawned, 0).terminated).toBe(false);
    });
  });
});
