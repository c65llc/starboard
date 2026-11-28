// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The desktop build's entry (vite.config.desktop.ts): the whole web app in
// the desktop app's window (web/desktop), with the tauri host
// (host/tauri.ts) in place of the browser's. Open offers the app's own
// folder dialog and recent projects, both from Rust (store.ts
// nativeOpener), and a folder the app was started with opens at once. No
// service worker is registered (startPwa is the browser entry's alone):
// the app is already local, and the update prompt never shows. Core runs
// in the page's worker, as in the browser.

import { render } from "preact";

import "./tokens.css";
import "./app.css";
import { App } from "./App.tsx";
import { getCore } from "./core.ts";
import { desktopOpener, tauriBridge } from "./host/tauri.ts";
import { startRouter } from "./router.ts";
import { checkFailedNotice } from "./state.ts";
import { app, nativeOpener, openNativeArg } from "./store.ts";

startRouter();
nativeOpener.value = desktopOpener(tauriBridge(), (files) => getCore().scope(files));

// An agent or an editor may have changed the files while the window was in
// the background: check them on focus, as the browser entry does (state
// also checks before each save).
addEventListener("focus", () => {
  app.checkDisk().catch((err: unknown) => {
    app.notice.value = checkFailedNotice(err);
  });
});

const root = document.getElementById("app");
if (root) render(<App />, root);

// A folder named on the command line opens at once; without one, Open shows.
void openNativeArg();
