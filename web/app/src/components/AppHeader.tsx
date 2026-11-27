// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The Midnight header bar: the brand, and inside a project its name, the
// view tabs, the lint summary, and (on a view-only host) Download changes.

import type { LintResult } from "@c65llc/starboard-core";

import { hrefFor, route } from "../router.ts";
import type { RouteName } from "../router.ts";
import { app, downloadChanges } from "../store.ts";

// The simplified star: the brand uses the full mark only at larger sizes.
const markUrl = `${import.meta.env.BASE_URL}favicon.svg`;

function Brand() {
  return (
    <a class="brand" href={hrefFor({ name: "open" })} aria-label="Starboard home">
      <img src={markUrl} width={24} height={24} alt="" />
      <span>Starboard</span>
    </a>
  );
}

/** count is "1 error" or "3 warnings". */
function count(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

export function lintSummary(lint: LintResult | null): { text: string; label: string; tone: string } {
  if (!lint) return { text: "Linting…", label: "Linting the project", tone: "busy" };
  const errors = count(lint.errors, "error");
  const warnings = count(lint.warnings, "warning");
  const tone = lint.errors > 0 ? "error" : lint.warnings > 0 ? "warn" : "ok";
  return { text: `${errors} · ${warnings}`, label: `Lint: ${errors}, ${warnings}`, tone };
}

const tabs: { label: string; to: RouteName; match: RouteName[] }[] = [
  { label: "Screens", to: "screens", match: ["screens"] },
  { label: "Flows", to: "flows", match: ["flows", "flowEdit", "flowWalk"] },
  { label: "App map", to: "map", match: ["map"] },
];

export function OpenHeader() {
  return (
    <header class="app-header">
      <div class="app-header__start">
        <Brand />
      </div>
      <span class="app-header__meta">v{__APP_VERSION__} · works offline</span>
    </header>
  );
}

export function ProjectHeader() {
  const host = app.host.value;
  const current = route.value.name;
  const summary = lintSummary(app.lint.value);
  const pending = app.dirty.value.size;
  return (
    <header class="app-header">
      <div class="app-header__start">
        <Brand />
        <span class="app-header__sep" aria-hidden="true">
          /
        </span>
        <span class="app-header__project">{host?.name}</span>
        {host?.kind === "readonly" ? <span class="badge">View only</span> : null}
        <nav class="project-nav" aria-label="Project">
          {tabs.map((t) => (
            <a
              key={t.to}
              href={hrefFor({ name: t.to } as Parameters<typeof hrefFor>[0])}
              aria-current={t.match.includes(current) ? "page" : undefined}
            >
              {t.label}
            </a>
          ))}
        </nav>
      </div>
      <div class="app-header__end">
        {host?.kind === "readonly" && pending > 0 ? (
          <button type="button" class="button button--small" onClick={downloadChanges}>
            Download changes ({pending})
          </button>
        ) : null}
        <a class={`pill pill--${summary.tone}`} href={hrefFor({ name: "screens" })} aria-label={summary.label}>
          {summary.text}
        </a>
      </div>
    </header>
  );
}
