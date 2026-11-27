// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// "Open a project": the mockup's first screen. Where the File System Access
// API exists (feature detection, never the user agent) the folder opens
// read-write and is remembered in Recent; elsewhere it opens view-only from
// a directory picker or a drop, and edits download as files.

import { useEffect, useRef, useState } from "preact/hooks";

import { canOpenInPlace, restoreRecent } from "../host/fsaccess.ts";
import type { RecentEntry } from "../host/fsaccess.ts";
import { openDropped, openError, openExample, opening, openInPlace, openRecent, openViewOnly } from "../store.ts";

function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 7h6l2 2h10v10H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
    </svg>
  );
}

/** when is "Today", "Yesterday" or a short date. */
function when(at: number, now = Date.now()): string {
  const day = (t: number) => Math.floor((t - new Date(t).getTimezoneOffset() * 60_000) / 86_400_000);
  const ago = day(now) - day(at);
  if (ago <= 0) return "Today";
  if (ago === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(at);
}

function RecentRow({ entry, onOpen }: { entry: RecentEntry; onOpen: (entry: RecentEntry) => void }) {
  const s = entry.summary;
  const nameId = `recent-${entry.id}`;
  const lint = s
    ? s.errors > 0
      ? { text: `${s.errors} error${s.errors === 1 ? "" : "s"}`, tone: "error" }
      : s.warnings > 0
        ? { text: `${s.warnings} warning${s.warnings === 1 ? "" : "s"}`, tone: "warn" }
        : { text: "Clean", tone: "ok" }
    : null;
  return (
    <li class="recent__item">
      <div class="recent__info">
        <span class="recent__name" id={nameId}>
          {entry.name}
        </span>
        <span class="recent__meta">
          {s ? <span>{`${s.screens} screens · ${s.flows} flows`}</span> : null}
          {lint ? <span class={`pill pill--${lint.tone}`}>{lint.text}</span> : null}
          <span>{when(entry.openedAt)}</span>
        </span>
      </div>
      {entry.permission === "granted" ? (
        <button
          type="button"
          class="button button--small"
          aria-label={`Open ${entry.name}`}
          onClick={() => onOpen(entry)}
          disabled={opening.value}
        >
          Open
        </button>
      ) : entry.permission === "prompt" ? (
        <button
          type="button"
          class="button button--small button--primary"
          aria-label={`Reconnect folder ${entry.name}`}
          onClick={() => onOpen(entry)}
          disabled={opening.value}
        >
          Reconnect folder
        </button>
      ) : (
        <p class="recent__denied">
          Access to this folder is blocked. Allow it in the browser’s site settings for this page, or use Open folder…
          to pick it again.
        </p>
      )}
    </li>
  );
}

export function Open() {
  const inPlace = canOpenInPlace();
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const refreshRecent = () => {
    if (!inPlace) return;
    restoreRecent()
      .then((entries) => setRecent(entries))
      .catch(() => undefined); // no IndexedDB (a private window, say): Recent stays empty
  };

  useEffect(refreshRecent, [inPlace]);

  // Reconnecting must run in the click itself (the browser asks only then);
  // afterwards Recent is read again, as a refusal may have changed it.
  const reopen = (entry: RecentEntry) => {
    void openRecent(entry).finally(refreshRecent);
  };

  useEffect(() => {
    if (picker.current) picker.current.webkitdirectory = true;
  }, []);

  const error = openError.value;
  const busy = opening.value;

  return (
    <main
      id="main"
      class={`open${dragging ? " open--dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer) void openDropped(e.dataTransfer.items);
      }}
    >
      <div class="open__inner">
        <section class="open__intro" aria-labelledby="open-title">
          <h1 id="open-title">Open a Starboard project</h1>
          <p class="open__lede">
            Pick the folder that holds <code>starboard.yaml</code>.{" "}
            {inPlace
              ? "Starboard reads and writes the files in place."
              : "Starboard reads the files in place; your edits download as files to copy into the project."}{" "}
            Nothing leaves this device.
          </p>
          <div class="open__actions">
            {inPlace ? (
              <button type="button" class="button button--primary" onClick={() => void openInPlace()} disabled={busy}>
                <FolderIcon />
                Open folder…
              </button>
            ) : (
              <button type="button" class="button button--primary" onClick={() => picker.current?.click()} disabled={busy}>
                <FolderIcon />
                Open folder (view only)
              </button>
            )}
            <button type="button" class="button" onClick={() => void openExample()} disabled={busy}>
              Explore the example project
            </button>
          </div>
          <input
            ref={picker}
            type="file"
            hidden
            onChange={(e) => {
              const files = e.currentTarget.files;
              if (files && files.length > 0) void openViewOnly(files);
              e.currentTarget.value = "";
            }}
          />
          <p class="open__hint">You can also drop the project folder on this page.</p>
          {busy ? (
            <p class="open__hint" role="status">
              Opening…
            </p>
          ) : null}
          {error ? (
            <p class="alert" role="alert">
              {error}
            </p>
          ) : null}
        </section>

        {recent.length > 0 ? (
          <section class="recent" aria-labelledby="recent-title">
            <h2 id="recent-title" class="section-title">
              Recent
            </h2>
            <ul class="recent__list">
              {recent.map((entry) => (
                <RecentRow key={entry.id} entry={entry} onOpen={reopen} />
              ))}
            </ul>
          </section>
        ) : null}

        <section class="cards" aria-label="What this browser can do">
          {inPlace ? (
            <>
              <div class="card">
                <h2>Edits in place</h2>
                <p>This browser saves straight to the folder. Every save is formatted and linted, just like CI.</p>
              </div>
              <div class="card">
                <h2>Safari and Firefox</h2>
                <p>View, lint and preview wireframes. Edits download as files you copy into the project.</p>
              </div>
            </>
          ) : (
            <>
              <div class="card">
                <h2>View only here</h2>
                <p>
                  This browser opens projects to view, lint and preview wireframes. Edits download as files you copy
                  into the project.
                </p>
              </div>
              <div class="card">
                <h2>Edits in place</h2>
                <p>Chrome and Edge can save straight to the folder. Every save is formatted and linted, just like CI.</p>
              </div>
            </>
          )}
          <div class="card">
            <h2>Same rules as the CLI</h2>
            <p>
              One core, compiled to WebAssembly. What passes here passes <code>starboard lint</code>.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
