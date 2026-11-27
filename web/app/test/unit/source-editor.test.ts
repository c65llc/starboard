// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
// @vitest-environment jsdom

// The Source tab keeps unsaved typing when the file is read again, and
// tells the user's own save apart from a change made by someone else.

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { signal } from "@preact/signals";
import { afterEach, describe, expect, it, vi } from "vitest";

interface Fake {
  doc: string;
  editable: boolean;
}
const views: Fake[] = [];

vi.mock("../../src/screens/codemirror.ts", () => ({
  mount: (_host: HTMLElement, text: string, editable: boolean) => {
    const v: Fake = { doc: text, editable };
    views.push(v);
    return {
      text: () => v.doc,
      update: (t: string, e: boolean) => {
        v.doc = t;
        v.editable = e;
      },
      reveal: () => undefined,
      focus: () => undefined,
      destroy: () => undefined,
    };
  },
}));
vi.mock("../../src/screens/editor.ts", () => ({ sourceLine: signal<number | null>(null) }));

import { SourceEditor } from "../../src/components/SourceEditor.tsx";

const saves: string[] = [];
async function show(text: string, editable: boolean): Promise<void> {
  await act(() => {
    render(h(SourceEditor, { path: "docs/flows/screens.yaml", text, editable, onSave: (t: string) => void saves.push(t) }), document.body);
  });
  await act(() => new Promise((r) => setTimeout(r, 0))); // the editor mounts after its import
}
const view = () => {
  const v = views[views.length - 1];
  if (!v) throw new Error("no editor");
  return v;
};
const note = () => document.querySelector(".source__stale");
const button = (name: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith(name));

afterEach(() => {
  render(null, document.body);
  views.length = 0;
  saves.length = 0;
});

describe("the Source tab", () => {
  it("keeps unsaved typing when the file is read again and now parses, and says so", async () => {
    await show("broken: [\n", true);
    view().doc = "broken: [\n# mine\n";
    await show("screens: {}\n", false); // someone fixed it on disk
    expect(view().doc).toBe("broken: [\n# mine\n");
    expect(note()?.getAttribute("role")).toBe("status");
    expect(button("Save screens.yaml")).toBeDefined();
    await act(() => button("Discard my text")?.click());
    expect(view().doc).toBe("screens: {}\n");
    expect(view().editable).toBe(false);
    expect(note()).toBeNull();
  });

  it("takes the user's own save, landing late, as theirs, keeping what they typed after it", async () => {
    await show("broken: [\n", true);
    view().doc = "broken: [\n# saved\n";
    await act(() => button("Save screens.yaml")?.click());
    expect(saves).toEqual(["broken: [\n# saved\n"]);
    view().doc = "broken: [\n# saved\n# more\n"; // typed while the save waited
    await show("broken: [\n# saved\n", true); // the save lands
    expect(note()).toBeNull();
    expect(view().doc).toBe("broken: [\n# saved\n# more\n");
  });
});
