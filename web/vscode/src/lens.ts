// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// CodeLens over the files that implement a screen. A file gets a lens when
// its project-relative path is listed, exactly, in some screen's
// files[platform] (an exact path, not a pattern). One lens per screen, on
// line 0, titled "Starboard: <screen id>"; it opens the screen's panel.

import * as vscode from "vscode";

import type { Model, Screen } from "@c65llc/starboard-core";

import type { Projects } from "./projects.ts";
import { OPEN_SCREEN_COMMAND, openArgs } from "./refs.ts";

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
    return listed.map(
      (screen) =>
        new vscode.CodeLens(range, { title: `Starboard: ${screen.id}`, command: OPEN_SCREEN_COMMAND, arguments: openArgs(project, screen.id) }),
    );
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
