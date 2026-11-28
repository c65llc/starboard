// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import type { KeyValue } from "../flows/walk.ts";
import type { FocusLevel } from "../router.ts";

/** Recentre is whether the map re-centres on picks only, or on every move. */
export type Recentre = "picks" | "every";

const LEVEL_KEY = "starboard.map.focusLevel";
const RECENTRE_KEY = "starboard.map.recentre";
const DEFAULT_LEVEL: FocusLevel = 1;
const DEFAULT_RECENTRE: Recentre = "picks";

// The choices made on this page, for when storage refuses (a private window, say).
let chosenLevel: FocusLevel | undefined;
let chosenRecentre: Recentre | undefined;

/** Store is the optional storage argument. Omitting it means localStorage; passing undefined means none. */
type Store = [store?: KeyValue];

/** savedLevel is the focus level the user last chose, 1 by default. */
export function savedLevel(...store: Store): FocusLevel {
  const stored = readValue(LEVEL_KEY, store);
  if (stored === "0") return 0;
  if (stored === "1") return 1;
  if (stored === "2") return 2;
  return chosenLevel ?? DEFAULT_LEVEL;
}

/** saveLevel remembers level for later visits, and for this page if storage refuses. */
export function saveLevel(level: FocusLevel, ...store: Store): void {
  chosenLevel = level;
  writeValue(LEVEL_KEY, String(level), store);
}

/** savedRecentre is the re-centre setting the user last chose, "picks" by default. */
export function savedRecentre(...store: Store): Recentre {
  const stored = readValue(RECENTRE_KEY, store);
  if (stored === "picks" || stored === "every") return stored;
  return chosenRecentre ?? DEFAULT_RECENTRE;
}

/** saveRecentre remembers mode for later visits, and for this page if storage refuses. */
export function saveRecentre(mode: Recentre, ...store: Store): void {
  chosenRecentre = mode;
  writeValue(RECENTRE_KEY, mode, store);
}

/** resetPrefsForTest clears the page's remembered choices so each test starts from the defaults. */
export function resetPrefsForTest(): void {
  chosenLevel = undefined;
  chosenRecentre = undefined;
}

// The args tell an omitted store (use localStorage) from an explicit undefined (use none),
// which a default parameter could not.
function storeOf(args: Store): KeyValue | undefined {
  return args.length === 0 ? local() : args[0];
}

function readValue(key: string, args: Store): string | null {
  try {
    return storeOf(args)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeValue(key: string, value: string, args: Store): void {
  try {
    storeOf(args)?.setItem(key, value);
  } catch {
    // Remembering is a convenience; the page keeps the choice in chosen*.
  }
}

function local(): KeyValue | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
