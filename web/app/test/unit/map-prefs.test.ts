// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { beforeEach, describe, expect, it } from "vitest";

import { resetPrefsForTest, saveLevel, savedLevel, saveRecentre, savedRecentre } from "../../src/map/prefs.ts";
import type { KeyValue } from "../../src/flows/walk.ts";

/** memoryStore is a Storage stand-in backed by a Map. */
function memoryStore(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

/** refusingStore is storage that throws on every access, as a private window's does. */
function refusingStore(): KeyValue {
  return {
    getItem: () => {
      throw new Error("storage refused");
    },
    setItem: () => {
      throw new Error("storage refused");
    },
  };
}

beforeEach(() => {
  resetPrefsForTest();
});

describe("map prefs", () => {
  it("defaults to level 1 and picks re-centring with an empty store", () => {
    const store = memoryStore();
    expect(savedLevel(store)).toBe(1);
    expect(savedRecentre(store)).toBe("picks");
  });

  it("reads back what was saved", () => {
    const store = memoryStore();
    saveLevel(2, store);
    saveRecentre("every", store);
    expect(savedLevel(store)).toBe(2);
    expect(savedRecentre(store)).toBe("every");
    expect(store.data.get("starboard.map.focusLevel")).toBe("2");
    expect(store.data.get("starboard.map.recentre")).toBe("every");
  });

  it("reads an unknown stored value as the default", () => {
    const store = memoryStore();
    store.data.set("starboard.map.focusLevel", "3");
    store.data.set("starboard.map.recentre", "sometimes");
    expect(savedLevel(store)).toBe(1);
    expect(savedRecentre(store)).toBe("picks");
  });

  it("keeps the choice for the page when storage refuses", () => {
    const store = refusingStore();
    saveLevel(0, store);
    saveRecentre("every", store);
    expect(savedLevel(store)).toBe(0);
    expect(savedRecentre(store)).toBe("every");
  });

  it("keeps the page's choice when no storage is passed", () => {
    saveLevel(2, undefined);
    saveRecentre("every", undefined);
    expect(savedLevel(undefined)).toBe(2);
    expect(savedRecentre(undefined)).toBe("every");
  });
});
