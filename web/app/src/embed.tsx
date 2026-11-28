// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The embed build's entry (vite.config.embed.ts): web/app's Screens,
// Flows and App map views in a VS Code panel. The panel's page says which
// route and project in its #app element's data-embed, as JSON (the page's
// CSP runs no inline script). The
// project opens at once, through the extension (host/vscode.ts), whose
// core answers the app's core calls (core-proxy.ts): there is no Open
// screen, no service worker and no update prompt, and the Screens view
// hides its Source tab, since VS Code is where text is edited. When the
// extension says the project changed, the app's external-change check
// runs, as the PWA's does on focus.

import { effect, signal } from "@preact/signals";
import { render } from "preact";
import type { ComponentType } from "preact";
import type { EditOp } from "@c65llc/starboard-core";

import "./tokens.css";
import "./app.css";
import { lintSummary } from "./components/AppHeader.tsx";
import { Toasts } from "./components/Toasts.tsx";
import { EDITOR_RELOADED_NOTICE, getChannel, VscodeHost } from "./host/vscode.ts";
import type { Channel } from "./host/vscode.ts";
import type { EmbedConfig } from "./host/vscode-messages.ts";
import { parseRoute, route, startRouter } from "./router.ts";
import type { Route, RouteName } from "./router.ts";
import { checkFailedNotice, RELOADED_NOTICE } from "./state.ts";
import { app } from "./store.ts";
import { FlowEdit } from "./views/FlowEdit.tsx";
import { Flows } from "./views/Flows.tsx";
import { FlowWalk } from "./views/FlowWalk.tsx";
import { LazyAppMap } from "./views/LazyAppMap.tsx";
import { NotFound } from "./views/NotFound.tsx";
import { Screens } from "./views/Screens.tsx";

/** The view for each route inside a project, as App.tsx has them; the panel has no Open screen. */
const views: Record<Exclude<RouteName, "open">, ComponentType<{ route: Route }>> = {
  screens: Screens,
  flows: Flows,
  flowEdit: FlowEdit,
  flowWalk: FlowWalk,
  map: LazyAppMap,
  notFound: NotFound,
};

/** readConfig is the #app element's data-embed, parsed and checked, or null when it is not one. */
function readConfig(json: string | undefined): EmbedConfig | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json ?? "");
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c["route"] !== "string" || !c["route"].startsWith("#/") || typeof c["name"] !== "string") return null;
  const r = parseRoute(c["route"]);
  if (r.name === "open" || r.name === "notFound") return null;
  return { route: c["route"], name: c["name"], test: c["test"] === true };
}

/**
 * startTestReport, under the integration tests only, tells the extension
 * what the view shows whenever it changes: its h1, its tabs' labels, and
 * how many screens the app map draws.
 */
function startTestReport(channel: Channel): void {
  let last = "";
  const report = () => {
    const heading = document.querySelector("#main h1")?.textContent?.trim() ?? "";
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim() ?? "");
    const nodes = document.querySelectorAll(".map-node").length;
    const key = JSON.stringify([heading, tabs, nodes]);
    if (key === last) return;
    last = key;
    channel.send({ type: "rendered", heading, tabs, nodes });
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(report, 50);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

function Header({ name }: { name: string }) {
  const summary = lintSummary(app.lint.value);
  return (
    <header class="app-header">
      <div class="app-header__start">
        <span class="app-header__project">{name}</span>
      </div>
      <div class="app-header__end">
        <span class={`pill pill--${summary.tone}`} role="status" aria-label={summary.label}>
          {summary.text}
        </span>
      </div>
    </header>
  );
}

/** Why the project could not be opened, if it could not. */
const failed = signal<string | null>(null);

function Embed({ config }: { config: EmbedConfig }) {
  // A link home (#/) has no Open screen to go to here: it shows the panel's own view.
  const r = route.value.name === "open" ? parseRoute(config.route) : route.value;
  const View = views[r.name as Exclude<RouteName, "open">];
  return (
    <>
      <Header name={config.name} />
      {app.host.value ? (
        <View route={r} />
      ) : (
        <main id="main" class="view">
          <p class="view__note">{failed.value ?? "Reading the project…"}</p>
        </main>
      )}
      <Toasts />
    </>
  );
}

function start(): void {
  const root = document.getElementById("app");
  const config = readConfig(root?.dataset["embed"]);
  if (!root || !config) return;
  history.replaceState(history.state, "", config.route);
  startRouter();
  const channel = getChannel();
  const opened = app.open(new VscodeHost(channel, config.name)).catch((err: unknown) => {
    failed.value = `Starboard could not read the project: ${err instanceof Error ? err.message : String(err)}`;
  });
  // The state says "changed on disk"; here it may as well be a buffer.
  effect(() => {
    if (app.notice.value === RELOADED_NOTICE) app.notice.value = EDITOR_RELOADED_NOTICE;
  });
  channel.on((msg) => {
    switch (msg.type) {
      case "reload":
        // The PWA's external-change path: stat what was read, reload if any changed.
        app.checkDisk().catch((err: unknown) => {
          app.notice.value = checkFailedNotice(err);
        });
        return;
      case "test-apply":
        if (!config.test) return;
        // Asked as soon as the page loads, it waits for the project to open.
        void opened.then(() => app.applyEdit(msg.ops as unknown as EditOp[])).then(
          (outcome) => channel.send({ type: "applied", outcome }),
          (err: unknown) => channel.send({ type: "applied", outcome: `error: ${String(err)}` }),
        );
        return;
    }
  });
  if (config.test) startTestReport(channel);
  render(<Embed config={config} />, root);
}

start();
