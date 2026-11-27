// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The #/map route: loads the app map (views/AppMap.tsx, with ELK) as its
// own chunk the first time it is shown, so the shell never carries it.

import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";

let loaded: ComponentType | undefined;

export function LazyAppMap() {
  const [View, setView] = useState<ComponentType | undefined>(() => loaded);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (View) return;
    let live = true;
    import("./AppMap.tsx")
      .then((m) => {
        loaded = m.AppMap;
        if (live) setView(() => m.AppMap);
      })
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [View]);
  if (View) return <View />;
  return (
    <main id="main" class="view">
      <h1>App map</h1>
      <p class="view__note">{error ? `Starboard could not load the map: ${error}` : "Loading the map…"}</p>
    </main>
  );
}
