// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// CodeLens over the files that implement a screen. A file gets a lens when
// its project-relative path is listed, exactly, in some screen's
// files[platform] (an exact path, not a pattern). One lens per screen, on
// line 0, titled "Starboard: <screen id>". Until the panel lands (Task 5)
// the lens goes to the screen's definition, as go-to-definition does.

import * as vscode from "vscode";

import type { Model, Screen } from "@c65llc/starboard-core";

import type { Projects } from "./projects.ts";
import { screenLocation } from "./refs.ts";

/** screensListing is the screens whose files list rel, in model order, once each. */
export function screensListing(model: Model, rel: string): Screen[] {
  return model.screens.filter((s) => Object.values(s.files).some((paths) => paths.includes(rel)));
}

class Lenses implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private readonly projects: Projects;
  private readonly subscription: vscode.Disposable;

  constructor(projects: Projects) {
    this.projects = projects;
    // The model changed (a re-lint of a changed project) or a project came or went.
    this.subscription = vscode.Disposable.from(
      projects.onDidInvalidate(() => this.changed.fire()),
      projects.onDidChange(() => this.changed.fire()),
    );
  }

  async provideCodeLenses(doc: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const project = this.projects.projectFor(doc.uri);
    if (!project) return [];
    const model = await project.model().catch(() => undefined);
    if (!model) return [];
    const listed = screensListing(model, this.projects.relativePath(project, doc.uri));
    const range = new vscode.Range(0, 0, 0, 0);
    const lenses: vscode.CodeLens[] = [];
    for (const screen of listed) {
      const where = await screenLocation(project, model, screen);
      const command: vscode.Command = where
        ? { title: `Starboard: ${screen.id}`, command: "vscode.open", arguments: [where.uri, { selection: where.range }] }
        : { title: `Starboard: ${screen.id}`, command: "" };
      lenses.push(new vscode.CodeLens(range, command));
    }
    return lenses;
  }

  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }
}

/** registerLens registers the CodeLens provider for every file, refreshed when a project's model changes. */
export function registerLens(projects: Projects): vscode.Disposable {
  const lenses = new Lenses(projects);
  return vscode.Disposable.from(vscode.languages.registerCodeLensProvider([{ scheme: "file" }], lenses), lenses);
}
