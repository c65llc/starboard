// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The shell: header, the current route's view, footer and toasts. Without
// an open project every route shows Open. Later tasks replace a route's
// Placeholder in views, and touch nothing else.

import type { ComponentType } from "preact";

import { OpenHeader, ProjectHeader } from "./components/AppHeader.tsx";
import { Toasts } from "./components/Toasts.tsx";
import { route } from "./router.ts";
import type { Route, RouteName } from "./router.ts";
import { app } from "./store.ts";
import { Open } from "./views/Open.tsx";
import { NotFound, Placeholder } from "./views/Placeholder.tsx";
import { Screens } from "./views/Screens.tsx";

/** The view for each route inside a project. */
const views: Record<Exclude<RouteName, "open">, ComponentType<{ route: Route }>> = {
  screens: Screens,
  flows: Placeholder,
  flowEdit: Placeholder,
  flowWalk: Placeholder,
  map: Placeholder,
  notFound: NotFound,
};

function Footer() {
  return (
    <footer class="app-footer">
      <a href="https://starboard.c65llc.com">Docs</a>
      <a href="https://github.com/c65llc/starboard">Source (AGPL-3.0)</a>
      <span>No account, no server, no telemetry.</span>
    </footer>
  );
}

export function App() {
  const r = route.value;
  const inProject = app.host.value !== null && r.name !== "open";
  const View = inProject ? views[r.name as Exclude<RouteName, "open">] : undefined;
  return (
    <>
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      {View ? <ProjectHeader /> : <OpenHeader />}
      {View ? <View route={r} /> : <Open />}
      <Footer />
      <Toasts />
    </>
  );
}
