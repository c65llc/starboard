// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
// @vitest-environment jsdom

// Open in the desktop app (DesktopOpen), against a fake of the desktop
// app's NativeOpener: Recent is Rust's list, read again after each open
// or cancel, and a Windows path shows without its \\?\ prefix.

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import type { NativeOpener, NativeRecent } from "../../src/host/host.ts";
import { nativeOpener, nativeRecentsChanged, openNativeRecent } from "../../src/store.ts";
import { Open, shownPath } from "../../src/views/Open.tsx";

/** fakeOpener lists recents, counts each read of it, and cancels the dialog; reopening one that has moved takes it off. */
function fakeOpener(initial: NativeRecent[]) {
  let list = initial;
  let reads = 0;
  const opener: NativeOpener = {
    kind: "tauri",
    pick: () => Promise.resolve(null),
    recents: () => {
      reads++;
      return Promise.resolve(list);
    },
    reopen: (path) => {
      list = list.filter((r) => r.path !== path);
      const err = new Error(`${path} has moved, so it was removed from Recent.`);
      err.name = "MovedError";
      return Promise.reject(err);
    },
    arg: () => Promise.resolve(null),
  };
  return {
    opener,
    get reads() {
      return reads;
    },
  };
}

/** flush lets the open, the re-render it causes and the list's read all settle. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(() => new Promise((r) => setTimeout(r, 0)));
};

const names = () => [...document.querySelectorAll(".recent__name")].map((n) => n.textContent);

afterEach(() => {
  render(null, document.body);
  nativeOpener.value = null;
});

describe("Open in the desktop app", () => {
  it("reads Recent again after the folder dialog is cancelled", async () => {
    const fake = fakeOpener([{ path: "/work/alpha", name: "alpha", openedAt: Date.now() }]);
    nativeOpener.value = fake.opener;
    await act(() => render(h(Open, {}), document.body));
    await flush();
    expect(names()).toEqual(["alpha"]);
    const before = fake.reads;
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Open folder"));
    await act(() => button?.click());
    await flush();
    expect(fake.reads).toBeGreaterThan(before);
  });

  it("reads Recent again after an open, from its own button or the menu, so a moved project leaves the list", async () => {
    const fake = fakeOpener([
      { path: "/work/alpha", name: "alpha", openedAt: Date.now() },
      { path: "/work/moved", name: "moved", openedAt: Date.now() },
    ]);
    nativeOpener.value = fake.opener;
    await act(() => render(h(Open, {}), document.body));
    await flush();
    expect(names()).toEqual(["alpha", "moved"]);
    await act(() => (document.querySelector('[aria-label="Open moved"]') as HTMLButtonElement).click());
    await flush();
    expect(names()).toEqual(["alpha"]);
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/removed from Recent/);
    // The menu's Open Recent opens through the same action, and Recent follows it too.
    await act(() => openNativeRecent("/work/alpha"));
    await flush();
    expect(names()).toEqual([]);
  });

  it("drops a Recent answer that arrives after a newer one", async () => {
    // The first read is slow; the list changes and is read again, and that
    // newer read answers first. The slow, older answer must not overwrite it.
    const pending: Array<(entries: NativeRecent[]) => void> = [];
    const opener: NativeOpener = {
      kind: "tauri",
      pick: () => Promise.resolve(null),
      recents: () => new Promise<NativeRecent[]>((resolve) => pending.push(resolve)),
      reopen: () => Promise.reject(new Error("unused")),
      arg: () => Promise.resolve(null),
    };
    nativeOpener.value = opener;
    await act(() => render(h(Open, {}), document.body));
    await act(() => {
      nativeRecentsChanged.value++;
    });
    expect(pending).toHaveLength(2);
    const stale = [{ path: "/work/moved", name: "moved", openedAt: Date.now() }];
    const fresh = [{ path: "/work/alpha", name: "alpha", openedAt: Date.now() }];
    await act(() => pending[1]?.(fresh));
    await flush();
    expect(names()).toEqual(["alpha"]);
    await act(() => pending[0]?.(stale));
    await flush();
    expect(names()).toEqual(["alpha"]);
  });

  it("shows a Windows path without its \\\\?\\ prefix, and reopens it by the path Rust gave", async () => {
    expect(shownPath("\\\\?\\C:\\Users\\me\\travel-app")).toBe("C:\\Users\\me\\travel-app");
    expect(shownPath("\\\\?\\UNC\\server\\share\\app")).toBe("\\\\?\\UNC\\server\\share\\app");
    expect(shownPath("/Users/me/travel-app")).toBe("/Users/me/travel-app");
    const reopened: string[] = [];
    const fake = fakeOpener([{ path: "\\\\?\\C:\\work\\alpha", name: "alpha", openedAt: Date.now() }]);
    fake.opener.reopen = (path) => {
      reopened.push(path);
      return Promise.reject(new Error("stop"));
    };
    nativeOpener.value = fake.opener;
    await act(() => render(h(Open, {}), document.body));
    await flush();
    expect(document.querySelector(".recent__meta")?.textContent).toContain("C:\\work\\alpha");
    expect(document.querySelector(".recent__meta")?.textContent).not.toContain("\\\\?\\");
    await act(() => (document.querySelector('[aria-label="Open alpha"]') as HTMLButtonElement).click());
    await flush();
    expect(reopened).toEqual(["\\\\?\\C:\\work\\alpha"]);
  });
});
