// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { render } from "preact";

import "./tokens.css";
import "./app.css";
import { App } from "./App.tsx";
import { startPwa } from "./pwa.ts";
import { startRouter } from "./router.ts";
import { checkFailedNotice } from "./state.ts";
import { app } from "./store.ts";

startRouter();
startPwa();

// An agent or an editor may have changed the files while the app was in
// the background: check them on focus (state also checks before each save).
// checkDisk turns its own failures into a notice; anything else that
// escapes is shown too, never dropped as an unhandled rejection.
addEventListener("focus", () => {
  app.checkDisk().catch((err: unknown) => {
    app.notice.value = checkFailedNotice(err);
  });
});

// Under browser automation only (Playwright sets navigator.webdriver), a
// hook lets the e2e tests open fixtures and read the memory host.
if (navigator.webdriver) void import("./e2e-hook.ts").then((m) => m.install());

const root = document.getElementById("app");
if (root) render(<App />, root);
