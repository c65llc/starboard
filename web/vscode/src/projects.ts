// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The Starboard projects in the workspace: one per starboard.yaml, each
// with its own core session and WorkspaceHost. A file belongs to the
// nearest project above it; a file under none belongs to no project.

import * as vscode from "vscode";

import type { Model, StarboardCore } from "@c65llc/starboard-core";

import { WorkspaceHost } from "./host.ts";

export const CONFIG_GLOB = "**/starboard.yaml";
/** Installed packages hold other projects' examples, never this workspace's. */
export const CONFIG_EXCLUDE = "**/node_modules/**";

export interface Project {
  /** The folder holding starboard.yaml. */
  root: vscode.Uri;
  host: WorkspaceHost;
  /** The project's session; it runs one call at a time, whoever asks (serial). */
  core: StarboardCore;
  /**
   * The project's model, read from its files with the open buffers laid
   * over them. It is read when first asked for and kept until the project
   * changes (Projects.invalidate, which each re-lint calls), so hover and
   * completion cost no core call while the editor is quiet.
   */
  model(): Promise<Model>;
}

/** The model a project holds, while no change has come since it was read. */
const models = new WeakMap<Project, Promise<Model>>();

export class Projects implements vscode.Disposable {
  private readonly byRoot = new Map<string, Project>();
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires when refresh adds or removes a project. */
  readonly onDidChange = this.changed.event;
  private readonly invalidated = new vscode.EventEmitter<Project>();
  /** Fires, with the project, each time a file or buffer of it changes: its model is then stale. */
  readonly onDidInvalidate = this.invalidated.event;

  private readonly makeCore: () => StarboardCore;
  /** The refresh running or last run. */
  private queue: Promise<void> = Promise.resolve();
  /** Set by dispose: a refresh still waiting on its listing then starts nothing. */
  private disposed = false;

  /** makeCore starts a core session; each project gets its own. */
  constructor(makeCore: () => StarboardCore) {
    this.makeCore = makeCore;
  }

  /**
   * refresh finds every starboard.yaml in the workspace again, starting a
   * session for each new project and closing the session of each one that
   * is gone. Refreshes run one after another, so of two at once (a watcher
   * and a folder change) the later listing is the one that stands.
   */
  refresh(): Promise<void> {
    // A refresh that failed does not stop the ones after it.
    this.queue = this.queue.catch(() => undefined).then(() => this.find());
    return this.queue;
  }

  private async find(): Promise<void> {
    if (this.disposed) return;
    const found = await vscode.workspace.findFiles(CONFIG_GLOB, CONFIG_EXCLUDE);
    if (this.disposed) return;
    const roots = new Map(found.map((uri) => [key(parent(uri)), parent(uri)]));
    let changed = false;
    for (const [k, p] of this.byRoot) {
      if (roots.has(k)) continue;
      p.core.close();
      this.byRoot.delete(k);
      changed = true;
    }
    for (const [k, root] of roots) {
      if (this.byRoot.has(k)) continue;
      this.byRoot.set(k, project(root, serial(this.makeCore())));
      changed = true;
    }
    if (changed) this.changed.fire();
  }

  /** Every project, by root. */
  all(): Project[] {
    return [...this.byRoot.values()].sort((a, b) => key(a.root).localeCompare(key(b.root)));
  }

  /** projectFor is the project whose root is nearest above uri, or undefined. */
  projectFor(uri: vscode.Uri): Project | undefined {
    return this.projectsFor(uri)[0];
  }

  /**
   * projectsFor is every project whose root is above uri, nearest first. A
   * nested project's files can also be its outer project's (a root or a
   * screenFiles glob reaching into it), so each of them reads the file.
   */
  projectsFor(uri: vscode.Uri): Project[] {
    return [...this.byRoot.values()]
      .filter((p) => inside(uri, p.root))
      .sort((a, b) => b.root.path.length - a.root.path.length);
  }

  /** invalidate drops p's model: a file or buffer of it changed. */
  invalidate(p: Project): void {
    models.delete(p);
    this.invalidated.fire(p);
  }

  /** relativePath is uri's slash path inside project's root. */
  relativePath(project: Project, uri: vscode.Uri): string {
    return uri.path.slice(trimmed(project.root.path).length + 1);
  }

  /** dispose closes every session; a refresh still in flight starts none. */
  dispose(): void {
    this.disposed = true;
    for (const p of this.byRoot.values()) p.core.close();
    this.byRoot.clear();
    this.changed.dispose();
    this.invalidated.dispose();
  }
}

/** project is the project at root on core, its model read once until invalidated. */
function project(root: vscode.Uri, core: StarboardCore): Project {
  const p: Project = {
    root,
    core,
    host: new WorkspaceHost(root, (files) => core.scope(files)),
    model() {
      const cached = models.get(p);
      if (cached) return cached;
      const read = p.host.readAll().then(({ files }) => core.model(files));
      models.set(p, read);
      // A failed read is not kept, so the next ask tries again.
      read.catch(() => {
        if (models.get(p) === read) models.delete(p);
      });
      return read;
    },
  };
  return p;
}

function parent(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(uri, "..");
}

function key(uri: vscode.Uri): string {
  return `${uri.scheme}://${uri.authority}${trimmed(uri.path)}`;
}

function trimmed(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

/** inside reports whether uri lies under the folder root. */
function inside(uri: vscode.Uri, root: vscode.Uri): boolean {
  return (
    uri.scheme === root.scheme &&
    uri.authority === root.authority &&
    uri.path.startsWith(`${trimmed(root.path)}/`)
  );
}

/**
 * serial is core with every call but close queued behind the one before
 * it, so a project's core runs one call at a time whoever asks: lint,
 * model, and the later hover, completion and commands. A call that fails
 * does not stop the ones after it. close is not queued: it must end a
 * call that is stuck.
 */
export function serial(core: StarboardCore): StarboardCore {
  let tail: Promise<unknown> = Promise.resolve();
  return new Proxy(core, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop);
      if (typeof value !== "function") return value;
      const fn = value as (...args: unknown[]) => unknown;
      if (prop === "close") return fn.bind(target);
      return (...args: unknown[]) => {
        const run = tail.then(() => fn.apply(target, args));
        tail = run.catch(() => undefined);
        return run;
      };
    },
  });
}
