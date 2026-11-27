// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
// @vitest-environment jsdom

// A drawing Mermaid does not finish in time: the caller hears so at once,
// but the shims stay until Mermaid's late work ends (or a second timeout
// passes), so it never runs unshimmed, and the next drawing waits for it.

import { afterEach, describe, expect, it, vi } from "vitest";

const renders: { resolve(v: { svg: string }): void }[] = [];
vi.mock("mermaid", () => ({
  default: {
    initialize: () => undefined,
    render: () => new Promise<{ svg: string }>((resolve) => renders.push({ resolve })),
  },
}));

import { draw, DRAW_TIMEOUT_MS } from "../../src/flows/mermaid.ts";
import { syntax } from "./ref-pattern.ts";

const link = { syntax, known: () => false, href: () => "#" };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" id="x"><g class="node"><rect/></g></svg>';

afterEach(() => {
  vi.useRealTimers();
  renders.length = 0;
});

describe("a Mermaid drawing that times out", () => {
  it("rejects at once, keeps the shims while Mermaid still works, and holds the next drawing back", async () => {
    vi.useFakeTimers();
    const original = Element.prototype.setAttribute;
    const first = draw("flowchart TD\n A", new CSSStyleSheet(), link);
    const rejected = expect(first).rejects.toThrow(/took more than/);
    await vi.advanceTimersByTimeAsync(0);
    expect(renders).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(DRAW_TIMEOUT_MS);
    await rejected;
    expect(Element.prototype.setAttribute).not.toBe(original); // Mermaid's late work is still shimmed

    const second = draw("flowchart TD\n B", new CSSStyleSheet(), link);
    await vi.advanceTimersByTimeAsync(0);
    expect(renders).toHaveLength(1); // waits for the first to finish

    renders[0]?.resolve({ svg: SVG }); // Mermaid finishes late
    await vi.advanceTimersByTimeAsync(0);
    expect(renders).toHaveLength(2);
    renders[1]?.resolve({ svg: SVG });
    await expect(second).resolves.toMatchObject({ id: expect.stringMatching(/^sb-diagram-/) as unknown });
    expect(Element.prototype.setAttribute).toBe(original);
  });

  it("gives up on a drawing that never finishes after a second timeout", async () => {
    vi.useFakeTimers();
    const original = Element.prototype.setAttribute;
    const first = draw("flowchart TD\n A", new CSSStyleSheet(), link);
    const rejected = expect(first).rejects.toThrow(/took more than/);
    await vi.advanceTimersByTimeAsync(DRAW_TIMEOUT_MS);
    await rejected;
    await vi.advanceTimersByTimeAsync(DRAW_TIMEOUT_MS);
    expect(Element.prototype.setAttribute).toBe(original);
  });
});
