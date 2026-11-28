// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The desktop build's entry (vite.config.desktop.ts): the whole web app in
// the desktop app's window (web/desktop), with the tauri host
// (host/tauri.ts) in place of the browser's. Open offers the app's own
// folder dialog and recent projects, both from Rust (store.ts
// nativeOpener), and a folder the app was started with opens at once. A
// change on disk to the open project reloads it (files-changed). No
// service worker is registered (startPwa is the browser entry's alone):
// the app is already local, and the update prompt never shows. Core runs
// in the page's worker, as in the browser.

import { render } from "preact";

import "./tokens.css";
import "./app.css";
import { App } from "./App.tsx";
import { getCore } from "./core.ts";
import { desktopOpener, onFilesChanged, tauriBridge, tauriEvents } from "./host/tauri.ts";
import { startRouter } from "./router.ts";
import { checkFailedNotice } from "./state.ts";
import { app, nativeOpener, openNativeArg } from "./store.ts";

startRouter();
nativeOpener.value = desktopOpener(tauriBridge(), (files) => getCore().scope(files));

// An agent or an editor may have changed the files: check them when Rust's
// watcher says the open project changed on disk (files-changed), and on
// focus, as the browser entry does (state also checks before each save).
// The stamps decide whether anything changed, so the app's own writes
// reload nothing, and an edit being saved is kept.
function checkDisk(): Promise<unknown> {
  return app.checkDisk().catch((err: unknown) => {
    app.notice.value = checkFailedNotice(err);
  });
}
addEventListener("focus", () => void checkDisk());
onFilesChanged(tauriEvents(), checkDisk).catch((err: unknown) => {
  console.warn("Starboard could not follow the project on disk; it checks on focus instead.", err);
});

const root = document.getElementById("app");
if (root) render(<App />, root);

// A folder named on the command line opens at once; without one, Open shows.
void openNativeArg();
