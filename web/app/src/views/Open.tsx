// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// "Open a project": the mockup's first screen. Where the File System Access
// API exists (feature detection, never the user agent) the folder opens
// read-write and is remembered in Recent; elsewhere it opens view-only from
// a directory picker or a drop, and edits download as files. In the
// desktop app (a NativeOpener installed, of kind "tauri"), Open folder… is
// the app's own folder dialog and Recent is the app's list, both from
// Rust; every project opens read-write.

import { useEffect, useRef, useState } from "preact/hooks";

import { canOpenInPlace, restoreRecent } from "../host/fsaccess.ts";
import type { RecentEntry } from "../host/fsaccess.ts";
import type { NativeOpener, NativeRecent } from "../host/host.ts";
import {
  nativeOpener,
  nativeRecentsChanged,
  openDropped,
  openError,
  openExample,
  opening,
  openInPlace,
  openNativeFolder,
  openNativeRecent,
  openRecent,
  openViewOnly,
} from "../store.ts";

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
  const native = nativeOpener.value;
  return native?.kind === "tauri" ? <DesktopOpen opener={native} /> : <BrowserOpen />;
}

/** useMounted is a ref that is true while the component is on screen: an answer after it is gone is dropped. */
function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/**
 * shownPath is a recent project's path as the list shows it: on Windows a
 * canonical path is written \\?\C:\…, and the \\?\ before a drive letter
 * is dropped. The path itself stays the entry's key, and is what reopens it.
 */
export function shownPath(path: string): string {
  return /^\\\\\?\\[A-Za-z]:\\/.test(path) ? path.slice(4) : path;
}

function DesktopRecentRow({ entry, onOpen }: { entry: NativeRecent; onOpen: (path: string) => void }) {
  return (
    <li class="recent__item">
      <div class="recent__info">
        <span class="recent__name">{entry.name}</span>
        <span class="recent__meta">
          <span>{shownPath(entry.path)}</span>
          <span>{when(entry.openedAt)}</span>
        </span>
      </div>
      <button
        type="button"
        class="button button--small"
        aria-label={`Open ${entry.name}`}
        onClick={() => onOpen(entry.path)}
        disabled={opening.value}
      >
        Open
      </button>
    </li>
  );
}

/** DesktopOpen is Open in the desktop app: its folder dialog and its recent projects, from Rust. */
function DesktopOpen({ opener }: { opener: NativeOpener }) {
  const [recent, setRecent] = useState<NativeRecent[]>([]);
  const mounted = useMounted();

  const refreshRecent = () => {
    opener
      .recents()
      .then((entries) => {
        if (mounted.current) setRecent(entries);
      })
      .catch(() => undefined); // no list to show: Recent stays empty
  };

  // Read again after each open or cancel, from here or the app's menu
  // (nativeRecentsChanged): opening moves a project to the top, and one
  // that has moved or gone has left the list.
  const changed = nativeRecentsChanged.value;
  useEffect(refreshRecent, [opener, changed]);

  const pick = () => void openNativeFolder();
  const reopen = (path: string) => void openNativeRecent(path);

  const error = openError.value;
  const busy = opening.value;

  return (
    <main id="main" class="open">
      <div class="open__inner">
        <section class="open__intro" aria-labelledby="open-title">
          <h1 id="open-title">Open a Starboard project</h1>
          <p class="open__lede">
            Pick the folder that holds <code>starboard.yaml</code>. Starboard reads and writes the files in place.
            Nothing leaves this device.
          </p>
          <div class="open__actions">
            <button type="button" class="button button--primary" onClick={pick} disabled={busy}>
              <FolderIcon />
              Open folder…
            </button>
            <button type="button" class="button" onClick={() => void openExample()} disabled={busy}>
              Explore the example project
            </button>
          </div>
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
                <DesktopRecentRow key={entry.path} entry={entry} onOpen={reopen} />
              ))}
            </ul>
          </section>
        ) : null}

        <section class="cards" aria-label="What the desktop app can do">
          <div class="card">
            <h2>Edits in place</h2>
            <p>Starboard saves straight to the folder. Every save is formatted and linted, just like CI.</p>
          </div>
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

/** BrowserOpen is Open in a browser: the File System Access API where it exists, else view only. */
function BrowserOpen() {
  const inPlace = canOpenInPlace();
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  // dragenter and dragleave fire on every child the pointer crosses, a
  // child's enter before its parent's leave, so the page counts them and is
  // left only when the count is back to 0.
  const drags = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  // Recent is read asynchronously; an answer after the screen is gone (a
  // project opened meanwhile) is dropped.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshRecent = () => {
    if (!inPlace) return;
    restoreRecent()
      .then((entries) => {
        if (mounted.current) setRecent(entries);
      })
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
      onDragEnter={() => {
        drags.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => {
        drags.current = Math.max(drags.current - 1, 0);
        if (drags.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        drags.current = 0;
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
