// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The extension's entry point. It activates in a workspace holding a
// starboard.yaml, finds every project, and lints each as you type.

import * as vscode from "vscode";

import { createCore } from "./core.ts";
import { Diagnostics } from "./diagnostics.ts";
import { CONFIG_GLOB, Projects } from "./projects.ts";

/** What activate returns, so the integration tests can see inside. */
export interface StarboardApi {
  projects: Projects;
  diagnostics: Diagnostics;
}

export async function activate(context: vscode.ExtensionContext): Promise<StarboardApi> {
  const dist = vscode.Uri.joinPath(context.extensionUri, "dist").fsPath;
  const output = vscode.window.createOutputChannel("Starboard");
  const projects = new Projects(() => createCore(dist));
  const diagnostics = new Diagnostics(projects, {
    debounceMs: () => vscode.workspace.getConfiguration("starboard").get<number>("lint.debounceMs", 300),
    log: (message) => output.appendLine(message),
  });

  // A starboard.yaml created or deleted, or a folder added to the
  // workspace, can add or remove a project.
  const configs = vscode.workspace.createFileSystemWatcher(CONFIG_GLOB);
  const refresh = () => void projects.refresh();
  context.subscriptions.push(
    output,
    diagnostics,
    projects,
    configs,
    configs.onDidCreate(refresh),
    configs.onDidDelete(refresh),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
  );
  await projects.refresh();
  return { projects, diagnostics };
}

export function deactivate(): void {
  // context.subscriptions disposes everything.
}
