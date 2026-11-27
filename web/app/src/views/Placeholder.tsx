// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The stand-in for the view a later task builds (the app map): it lists
// the screens and links on, so the route works end to end now and the
// later task only swaps its view in.

import { hrefFor } from "../router.ts";
import type { Route } from "../router.ts";
import { app } from "../store.ts";

function ScreenIndex() {
  const screens = app.model.value?.screens ?? [];
  return (
    <ul class="index" aria-label="Screens">
      {screens.map((s) => (
        <li key={s.id}>
          <a class="index__id" href={hrefFor({ name: "screens", screen: s.id })}>
            {s.id}
          </a>
          <span class="index__title">{s.title}</span>
        </li>
      ))}
    </ul>
  );
}

const titles: Record<string, string> = {
  screens: "Screens",
  map: "App map",
};

export function Placeholder({ route }: { route: Route }) {
  const loading = app.model.value === null;
  return (
    <main id="main" class="view">
      <h1>{titles[route.name] ?? "Not found"}</h1>
      {loading ? <p class="view__note">Reading the project…</p> : <ScreenIndex />}
    </main>
  );
}

export function NotFound() {
  return (
    <main id="main" class="view">
      <h1>Not found</h1>
      <p class="view__note">
        There is no page at this address. <a href={hrefFor({ name: "screens" })}>Go to the screens</a>.
      </p>
    </main>
  );
}
