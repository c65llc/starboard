// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The core of the VS Code extension's panel: a StarboardCore whose calls
// the extension answers with its own core for the project, so the panel
// and the editor read one model and the page starts no worker and runs no
// WebAssembly. The embed build (vite.config.embed.ts) puts this module's
// getCore in place of src/core.ts's. The extension passes core its own
// read of the project, never the files the page sends; it answers only
// the calls web/app makes (CORE_FNS), and the rest are refused here.

import type { EditOp, EditResult, FixResult, Files, LintResult, Model, ScopeResult, StarboardCore, Walk } from "@c65llc/starboard-core";

import { getChannel, PanelError } from "./host/vscode.ts";
import type { Channel } from "./host/vscode.ts";
import type { CoreFn } from "./host/vscode-messages.ts";

function call<T>(channel: Channel, fn: CoreFn, args: unknown[]): Promise<T> {
  return channel.request<T>({ type: "core", fn, args });
}

function unavailable(fn: string): Promise<never> {
  return Promise.reject(new PanelError(`core.${fn} is not available in the editor's panel`));
}

/** proxyCore is a StarboardCore over channel: the calls web/app makes go to the extension, the rest refuse. */
export function proxyCore(channel: Channel): StarboardCore {
  return {
    model: (files: Files) => call<Model>(channel, "model", [files]),
    lint: (files: Files, strict?: boolean) => call<LintResult>(channel, "lint", strict === undefined ? [files] : [files, strict]),
    edit: (files: Files, ops: EditOp[]) => call<EditResult>(channel, "edit", [files, ops]),
    fix: (files: Files) => call<FixResult>(channel, "fix", [files]),
    render: (files: Files, screen: string, formFactor: string, region?: string) =>
      call<string>(channel, "render", region === undefined ? [files, screen, formFactor] : [files, screen, formFactor, region]),
    walkthrough: (files: Files, flow: string, formFactor: string) => call<Walk>(channel, "walkthrough", [files, flow, formFactor]),
    scope: (files: Files) => call<ScopeResult>(channel, "scope", [files]),
    format: () => unavailable("format"),
    generate: () => unavailable("generate"),
    close: () => undefined,
  };
}

let core: StarboardCore | undefined;

/** getCore is the panel's one core, over the page's channel to the extension. */
export function getCore(): StarboardCore {
  core ??= proxyCore(getChannel());
  return core;
}
