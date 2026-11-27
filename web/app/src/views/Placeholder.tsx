// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Stand-ins for the views later tasks build (screen editor, flow editor and
// walkthrough, app map): each lists what the project holds and links on,
// so the routes work end to end now and a later task only swaps its view in.

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

function FlowIndex() {
  const flows = app.model.value?.flows ?? [];
  return (
    <ul class="index" aria-label="Flows">
      {flows.map((f) => (
        <li key={f.id}>
          <span class="index__id">{f.id}</span>
          <span class="index__title">{f.title}</span>
          <a href={hrefFor({ name: "flowEdit", flow: f.id })} aria-label={`Edit ${f.title}`}>
            Edit
          </a>
          <a href={hrefFor({ name: "flowWalk", flow: f.id })} aria-label={`Walk through ${f.title}`}>
            Walk through
          </a>
        </li>
      ))}
    </ul>
  );
}

const titles: Record<string, string> = {
  screens: "Screens",
  flows: "Flows",
  flowEdit: "Flows",
  flowWalk: "Flows",
  map: "App map",
};

export function Placeholder({ route }: { route: Route }) {
  const isFlows = route.name === "flows" || route.name === "flowEdit" || route.name === "flowWalk";
  const loading = app.model.value === null;
  return (
    <main id="main" class="view">
      <h1>{titles[route.name] ?? "Not found"}</h1>
      {loading ? <p class="view__note">Reading the project…</p> : isFlows ? <FlowIndex /> : <ScreenIndex />}
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
