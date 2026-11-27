// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The Midnight header bar: the brand, and inside a project its name, the
// view tabs, the lint summary, and (on a view-only host) the changes not
// saved to disk, with Download changes.

import type { LintResult } from "@c65llc/starboard-core";
import { useRef, useState } from "preact/hooks";

import { ReadonlyHost } from "../host/readonly.ts";
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

/**
 * Pending is a view-only host's changes not saved to disk: a button with
 * their count that opens a panel listing the files changed and the files to
 * delete, and Download changes. One changed file downloads by its base
 * name, so the panel shows the path to save it at.
 */
function Pending({ host }: { host: ReadonlyHost }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  // The host's pending changes are not a signal: read the state the header
  // re-renders on (dirty moves with every edit and download; lint with every
  // save) so the panel follows them.
  void app.dirty.value;
  void app.lint.value;
  const { changed, deleted } = host.summary();
  const count = changed.length + deleted.length;
  if (count === 0) return null;
  const only = host.downloadPath();
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  return (
    <div class="pending">
      <button
        ref={toggle}
        type="button"
        class="button button--small pending__toggle"
        aria-expanded={open}
        aria-controls="pending-panel"
        onClick={() => setOpen(!open)}
      >
        Not saved to disk ({count})
      </button>
      {open ? (
        <section
          id="pending-panel"
          class="pending__panel"
          aria-labelledby="pending-title"
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <h2 id="pending-title" class="pending__title">
            Changes not saved to disk
          </h2>
          <p class="pending__lede">
            This browser opened {host.name} view only. Download your changes and copy them into the project.
          </p>
          {changed.length > 0 ? (
            <>
              <h3 class="pending__heading" id="pending-changed">
                Changed
              </h3>
              <ul class="pending__list" aria-labelledby="pending-changed">
                {changed.map((p) => (
                  <li key={p}>
                    <code>{p}</code>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {deleted.length > 0 ? (
            <>
              <h3 class="pending__heading" id="pending-deleted">
                To delete
              </h3>
              <ul class="pending__list" aria-labelledby="pending-deleted">
                {deleted.map((p) => (
                  <li key={p}>
                    <code>{p}</code>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <div class="pending__actions">
            <button
              type="button"
              class="button button--small button--primary"
              onClick={() => {
                setOpen(false);
                downloadChanges();
              }}
            >
              Download changes
            </button>
            <p class="pending__where">
              {only !== null ? (
                <>
                  Save as <code>{only}</code> in your project
                </>
              ) : (
                <>
                  Downloads <code>{host.downloadName()}</code>: unzip it into the project folder
                  {deleted.length > 0 ? ", then delete the files its DELETED.txt lists" : ""}
                </>
              )}
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function ProjectHeader() {
  const host = app.host.value;
  const current = route.value.name;
  const summary = lintSummary(app.lint.value);
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
        {host instanceof ReadonlyHost ? <Pending host={host} /> : null}
        <a class={`pill pill--${summary.tone}`} href={hrefFor({ name: "screens" })} aria-label={summary.label}>
          {summary.text}
        </a>
      </div>
    </header>
  );
}
