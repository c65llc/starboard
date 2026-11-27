// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { render } from "preact";

import "./tokens.css";
import "./app.css";
import { App } from "./App.tsx";
import { startPwa } from "./pwa.ts";
import { startRouter } from "./router.ts";
import { app } from "./store.ts";

startRouter();
startPwa();

// An agent or an editor may have changed the files while the app was in
// the background: check them on focus (state also checks before each save).
addEventListener("focus", () => void app.checkDisk());

const root = document.getElementById("app");
if (root) render(<App />, root);
