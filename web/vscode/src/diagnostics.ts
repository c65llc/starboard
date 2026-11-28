// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Lint as you type. Each project is linted again when one of its files is
// opened, changed (debounced), saved or closed, and when a file in it is
// created, changed, deleted or renamed on disk. The findings go to one
// DiagnosticCollection, "starboard", each with its rule as the code and the
// rule's page as the code's target. A project runs one lint at a time; a
// change during a run asks for one more run after it, and the run that
// read the older text publishes nothing.
//
// Projects can nest, and an outer project can read a nested one's files.
// So a buffer is laid over every project above it, and each file shows
// the union of every project's findings on it, each project replacing only
// its own.

import * as vscode from "vscode";

import type { Diagnostic as Finding } from "@c65llc/starboard-core";

import type { Project, Projects } from "./projects.ts";

/** How lint severities map to the editor's. Core says "warn"; "warning" and "info" are taken too. */
const SEVERITY: Record<string, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warn: vscode.DiagnosticSeverity.Warning,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

/** A finding with no file is about the project, so it goes on starboard.yaml. */
const PROJECT_FILE = "starboard.yaml";

/**
 * Folders whose changes on disk never re-lint: version control, installed
 * packages, and common build output, which a build rewrites by the
 * thousand and no project reads.
 */
export const UNWATCHED_DIRS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "dist",
  "target",
  "build",
  "out",
  ".next",
  "coverage",
]);

/** unwatched reports whether the project-relative path lies under an UNWATCHED_DIRS folder. */
export function unwatched(path: string): boolean {
  return path.split("/").slice(0, -1).some((part) => UNWATCHED_DIRS.has(part));
}

interface State {
  timer?: ReturnType<typeof setTimeout> | undefined;
  running?: Promise<void> | undefined;
  /** A change arrived during the run, so it runs once more. */
  again: boolean;
  /** Counts the changes seen; a run publishes only if none came after it read the files. */
  generation: number;
  /** This project's findings, by file URI. */
  findings: Map<string, { uri: vscode.Uri; list: vscode.Diagnostic[] }>;
}

export interface DiagnosticsOptions {
  /** The wait after the last keystroke before linting, in ms. */
  debounceMs(): number;
  /** Where a lint that failed is reported. */
  log(message: string): void;
}

export class Diagnostics implements vscode.Disposable {
  readonly collection = vscode.languages.createDiagnosticCollection("starboard");
  private readonly state = new Map<Project, State>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly projects: Projects;
  private readonly opts: DiagnosticsOptions;
  private disposed = false;

  constructor(projects: Projects, opts: DiagnosticsOptions) {
    this.projects = projects;
    this.opts = opts;
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    const onDisk = (uri: vscode.Uri) => this.changedOnDisk(uri);
    this.subscriptions.push(
      this.collection,
      watcher,
      watcher.onDidCreate(onDisk),
      // A change to an open file arrives as a document event (a save, or
      // the reload of an outside edit), so the watcher's copy of it would
      // only lint the same text twice.
      watcher.onDidChange((uri) => {
        if (!isOpen(uri)) onDisk(uri);
      }),
      watcher.onDidDelete(onDisk),
      // A rename in the editor; the watcher also sees it as a delete and a
      // create, which the debounce folds into the same run.
      vscode.workspace.onDidRenameFiles((e) => {
        for (const { oldUri, newUri } of e.files) {
          onDisk(oldUri);
          onDisk(newUri);
        }
      }),
      vscode.workspace.onDidOpenTextDocument((doc) => this.track(doc, 0)),
      vscode.workspace.onDidChangeTextDocument((e) => this.track(e.document, opts.debounceMs())),
      vscode.workspace.onDidSaveTextDocument((doc) => this.track(doc, 0)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.track(doc, 0, true)),
      projects.onDidChange(() => this.sync()),
    );
    this.sync();
  }

  /** settled resolves once no lint is waiting or running: for tests. */
  async settled(): Promise<void> {
    for (;;) {
      const busy = [...this.state.values()].filter((s) => s.timer !== undefined || s.running !== undefined);
      if (busy.length === 0) return;
      await Promise.all(busy.map((s) => s.running ?? new Promise((r) => setTimeout(r, 10))));
    }
  }

  /** relint lints p again now: something outside the editor changed its files. */
  relint(p: Project): void {
    this.lintSoon(p, 0);
  }

  dispose(): void {
    this.disposed = true;
    for (const s of this.state.values()) clearTimeout(s.timer);
    this.state.clear();
    for (const d of this.subscriptions) d.dispose();
  }

  /**
   * sync follows the project list: it drops the findings of a project that
   * is gone, and lints each new one with the open dirty buffers laid over it.
   */
  private sync(): void {
    const live = new Set(this.projects.all());
    for (const [p, s] of this.state) {
      if (live.has(p)) continue;
      clearTimeout(s.timer);
      this.state.delete(p);
      for (const { uri } of s.findings.values()) this.show(uri);
    }
    for (const p of live) {
      if (this.state.has(p)) continue;
      this.state.set(p, { again: false, generation: 0, findings: new Map() });
      for (const doc of vscode.workspace.textDocuments) this.overlay(doc, false);
      this.lintSoon(p, 0);
    }
  }

  /**
   * track lays doc's text over its file, in every project above it, while
   * it is dirty (closed: never), and lints those projects after delay ms.
   */
  private track(doc: vscode.TextDocument, delay: number, closed = false): void {
    for (const p of this.overlay(doc, closed)) this.lintSoon(p, delay);
  }

  /** overlay sets or clears doc's buffer on each project above it, and returns them. */
  private overlay(doc: vscode.TextDocument, closed: boolean): Project[] {
    if (doc.uri.scheme !== "file") return [];
    const ps = this.projects.projectsFor(doc.uri);
    for (const p of ps) {
      p.host.overlay(this.projects.relativePath(p, doc.uri), !closed && doc.isDirty ? doc.getText() : null);
    }
    return ps;
  }

  /** changedOnDisk lints each project above a file that changed on disk, unless it is under UNWATCHED_DIRS. */
  private changedOnDisk(uri: vscode.Uri): void {
    for (const p of this.projects.projectsFor(uri)) {
      if (!unwatched(this.projects.relativePath(p, uri))) this.lintSoon(p, this.opts.debounceMs());
    }
  }

  /** lintSoon notes a change to p, drops its model, and lints it after delay ms. */
  private lintSoon(p: Project, delay: number): void {
    const s = this.state.get(p);
    if (!s) return;
    s.generation++;
    this.projects.invalidate(p);
    clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      s.timer = undefined;
      this.run(p, s);
    }, delay);
  }

  private run(p: Project, s: State): void {
    if (s.running) {
      s.again = true;
      return;
    }
    s.running = (async () => {
      do {
        s.again = false;
        await this.lint(p, s);
      } while (s.again && this.live(p, s));
    })().finally(() => {
      s.running = undefined;
    });
  }

  /** live reports whether s is still p's state: the project was not removed, nor the extension disposed. */
  private live(p: Project, s: State): boolean {
    return !this.disposed && this.state.get(p) === s;
  }

  private async lint(p: Project, s: State): Promise<void> {
    const generation = s.generation;
    let findings: Finding[];
    try {
      const { files } = await p.host.readAll();
      findings = (await p.core.lint(files)).diagnostics;
    } catch (err) {
      // A project removed mid-run had its session closed under it: no news.
      if (this.live(p, s)) {
        this.opts.log(`Linting ${p.root.fsPath} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
    // Gone, or a newer change is waiting on its own run: these findings are stale.
    if (!this.live(p, s) || s.generation !== generation) return;
    this.publish(p, s, findings);
  }

  /** publish replaces p's findings, and shows every file whose findings changed. */
  private publish(p: Project, s: State, findings: Finding[]): void {
    const before = s.findings;
    s.findings = new Map();
    for (const f of findings) {
      const uri = vscode.Uri.joinPath(p.root, ...(f.file || PROJECT_FILE).split("/"));
      const entry = s.findings.get(uri.toString()) ?? { uri, list: [] };
      entry.list.push(toDiagnostic(f, uri));
      s.findings.set(uri.toString(), entry);
    }
    const touched = new Map([...before, ...s.findings]);
    for (const { uri } of touched.values()) this.show(uri);
  }

  /** show sets uri's diagnostics to every live project's findings on it, or deletes them when there are none. */
  private show(uri: vscode.Uri): void {
    const key = uri.toString();
    const list = [...this.state.values()].flatMap((s) => s.findings.get(key)?.list ?? []);
    if (list.length > 0) this.collection.set(uri, list);
    else this.collection.delete(uri);
  }
}

/** isOpen reports whether uri is open as a text document. */
function isOpen(uri: vscode.Uri): boolean {
  const key = uri.toString();
  return vscode.workspace.textDocuments.some((d) => d.uri.toString() === key);
}

/** toDiagnostic is f as the editor shows it on the file at uri. */
export function toDiagnostic(f: Finding, uri: vscode.Uri): vscode.Diagnostic {
  const d = new vscode.Diagnostic(rangeOf(f, uri), f.message, SEVERITY[f.severity] ?? vscode.DiagnosticSeverity.Error);
  d.source = "starboard";
  d.code = f.docs ? { value: f.rule, target: vscode.Uri.parse(f.docs) } : f.rule;
  return d;
}

/**
 * rangeOf is the whole line f names (1-based in core, 0-based here), to
 * its last character when the file is open, or the start of the file when
 * f names no line.
 */
function rangeOf(f: Finding, uri: vscode.Uri): vscode.Range {
  if (f.line === undefined || f.line < 1) return new vscode.Range(0, 0, 0, 0);
  const line = f.line - 1;
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (doc && line < doc.lineCount) {
    const l = doc.lineAt(line);
    return new vscode.Range(line, 0, line, l.text.length);
  }
  return new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
}
