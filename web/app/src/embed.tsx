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
// runs, as the PWA's does on focus; when a file was made or deleted, which
// that check of the files already read cannot see, the project is read
// again; when it refused a write, the project is read afresh, and the
// refusal is the notice.

import { effect, signal } from "@preact/signals";
import { render } from "preact";
import type { ComponentType } from "preact";
import type { EditOp } from "@c65llc/starboard-core";

import "./tokens.css";
import "./app.css";
import { lintSummary } from "./components/AppHeader.tsx";
import { Toasts } from "./components/Toasts.tsx";
import { FlowSession } from "./flows/session.ts";
import { EDITOR_RELOADED_NOTICE, getChannel, refusedNotice, VscodeHost } from "./host/vscode.ts";
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
 * what the view shows whenever it changes: its h1, its tabs' labels, how
 * many screens the app map draws, the notice, and the model's flows.
 */
function startTestReport(channel: Channel): void {
  let last = "";
  const report = () => {
    const heading = document.querySelector("#main h1")?.textContent?.trim() ?? "";
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim() ?? "");
    const nodes = document.querySelectorAll(".map-node").length;
    const notice = app.notice.peek() ?? "";
    const flows = app.model.peek()?.flows.map((f) => f.id) ?? [];
    const key = JSON.stringify([heading, tabs, nodes, notice, flows]);
    if (key === last) return;
    last = key;
    channel.send({ type: "rendered", heading, tabs, nodes, notice, flows });
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(report, 50);
  };
  new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, characterData: true });
  // A view that does not draw the flows (the app map) still reports a change to them.
  effect(() => {
    void app.model.value;
    void app.notice.value;
    soon();
  });
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
        if (msg.fileSetChanged) {
          // A file made (New flow, say) changes no stamp the check reads:
          // read the project again, as the check does when one changed.
          app.reload().catch((err: unknown) => {
            app.notice.value = checkFailedNotice(err);
          });
          return;
        }
        // The PWA's external-change path: stat what was read, reload if any changed.
        app.checkDisk().catch((err: unknown) => {
          app.notice.value = checkFailedNotice(err);
        });
        return;
      case "reread":
        // A refused write: read afresh (after the failed save, in the
        // queue), dropping the change kept to save again, which the
        // extension would refuse with every later edit. The refusal, not
        // the reload, is the notice.
        app.reload().then(
          () => {
            app.notice.value = refusedNotice(msg.reason);
          },
          (err: unknown) => {
            app.notice.value = checkFailedNotice(err);
          },
        );
        return;
      case "test-apply":
        if (!config.test) return;
        // Asked as soon as the page loads, it waits for the project to open.
        void opened.then(() => app.applyEdit(msg.ops as unknown as EditOp[])).then(
          (outcome) => channel.send({ type: "applied", outcome }),
          (err: unknown) => channel.send({ type: "applied", outcome: `error: ${String(err)}` }),
        );
        return;
      case "test-fix":
        if (!config.test) return;
        void opened.then(() => app.applyFix()).then(
          (outcome) => channel.send({ type: "applied", outcome }),
          (err: unknown) => channel.send({ type: "applied", outcome: `error: ${String(err)}` }),
        );
        return;
      case "test-lint": {
        if (!config.test) return;
        // The flow editor's own lint, of its unsaved text; the outcome is its marks' rules.
        const lint = async () => {
          const flow = app.model.value?.flows.find((f) => f.id === msg.flow);
          if (!flow) throw new Error(`no flow ${msg.flow}`);
          const marks = await new FlowSession(flow.id, flow.file).lint(msg.body);
          return JSON.stringify(marks.map((m) => m.rule));
        };
        void opened.then(lint).then(
          (outcome) => channel.send({ type: "applied", outcome }),
          (err: unknown) => channel.send({ type: "applied", outcome: `error: ${String(err)}` }),
        );
        return;
      }
    }
  });
  if (config.test) startTestReport(channel);
  render(<Embed config={config} />, root);
}

start();
