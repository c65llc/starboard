// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Open App Map, Open Screen… and Open Flow… show web/app's own views in a
// webview panel, one per project and view: web/app's embed build
// (vite.config.embed.ts, src/embed.tsx), copied into dist-embed/. The page
// runs no core and no WebAssembly: every read, write and core call is a
// message (web/app/src/host/vscode-messages.ts), checked here before
// anything acts on it, and answered from the project's WorkspaceHost
// (unsaved buffers laid over the disk) and its core, which is always given
// the extension's own read, never the page's files. The page may write
// only exactly a change core worked out for it (an edit or a fix since its
// last readAll), through applyCoreResult, which refuses it if the editor's
// text has changed since that read. When the project changes the page is
// told to check it again, as the PWA does on focus.

import * as vscode from "vscode";

import type { Files, Model } from "@c65llc/starboard-core";
import { checkToExtension } from "@c65llc/starboard-app/src/host/vscode-messages.ts";
import type { EmbedConfig, FromExtension, ReadAllResult, Reply, Request, ToExtension } from "@c65llc/starboard-app/src/host/vscode-messages.ts";

import type { Commands } from "./commands.ts";
import type { Project, Projects } from "./projects.ts";
import { OPEN_FLOW_COMMAND, OPEN_MAP_COMMAND, OPEN_SCREEN_COMMAND } from "./refs.ts";
import { applyCoreResult, currentText } from "./write.ts";

export const PANEL_VIEW_TYPE = "starboard.panel";
/** Set by the integration tests' runner only: turns on the panel's test-only messages. */
export const PANEL_TEST_ENV = "STARBOARD_PANEL_TEST";
/** How long after the last change to a project its panels are told to check it again. */
const RELOAD_DELAY_MS = 300;
/** How many of core's edit and fix results a panel keeps, the newest, for a write to match. */
export const MAX_EDITS = 8;
/** How long testApply waits for the page's answer. */
const TEST_APPLY_TIMEOUT_MS = 30_000;

/** The views a panel shows. */
export type PanelView = "screen" | "flow" | "map";

/** The page asked for something the extension will not do. */
export class PanelRefusal extends Error {
  override name = "PanelRefusal";
}

/** A change core worked out for a page: its files, and the read it was worked out from. */
interface Result {
  changes: Record<string, string | null>;
  base: Files;
}

/**
 * EditLog is the edit and fix results the extension gave one panel's
 * page, the newest MAX_EDITS of them, each with the extension's read it
 * was worked out from. The page is not trusted: it may write only a change
 * core made, exactly, and each once.
 */
export class EditLog {
  private results: Result[] = [];

  add(changes: Readonly<Record<string, string | null>>, base: Files): void {
    this.results.push({ changes: { ...changes }, base });
    if (this.results.length > MAX_EDITS) this.results.shift();
  }

  clear(): void {
    this.results = [];
  }

  private at(changes: Readonly<Record<string, string | null>>): number {
    const paths = Object.keys(changes);
    if (paths.length === 0) return -1;
    return this.results.findIndex(
      (r) => Object.keys(r.changes).length === paths.length && paths.every((p) => Object.hasOwn(r.changes, p) && r.changes[p] === changes[p]),
    );
  }

  /** find is the read a result was worked out from, when its files equal changes exactly (the same paths, the same text, null as null), else undefined. */
  find(changes: Readonly<Record<string, string | null>>): Files | undefined {
    return this.results[this.at(changes)]?.base;
  }

  /** take forgets that result, once written, so it is written once; a write that failed keeps it. */
  take(changes: Readonly<Record<string, string | null>>): void {
    const i = this.at(changes);
    if (i >= 0) this.results.splice(i, 1);
  }

  /** paths is every path a kept result changes. */
  paths(): string[] {
    return this.results.flatMap((r) => Object.keys(r.changes));
  }
}

/**
 * csp is the panel page's Content-Security-Policy: the bundle's scripts,
 * styles and fonts, and images from it or data: and blob:. No inline
 * script, no WebAssembly, no worker, no connection.
 */
export function csp(cspSource: string): string {
  return [
    "default-src 'none'",
    `script-src ${cspSource}`,
    `style-src ${cspSource}`,
    `font-src ${cspSource}`,
    `img-src ${cspSource} data: blob:`,
  ].join("; ");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The page's parts, as webview URIs, and what it shows. */
export interface PageParts {
  cspSource: string;
  script: string;
  style: string;
  title: string;
  config: EmbedConfig;
}

/** pageHtml is the panel's page; the route it opens rides in #app's data-embed as JSON, escaped as an attribute. */
export function pageHtml(p: PageParts): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp(p.cspSource))}" />`,
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<link rel="stylesheet" href="${escapeHtml(p.style)}" />`,
    `<title>${escapeHtml(p.title)}</title>`,
    "</head>",
    "<body>",
    `<div id="app" data-embed="${escapeHtml(JSON.stringify(p.config))}"></div>`,
    `<script type="module" src="${escapeHtml(p.script)}"></script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

/** routeOf is the app's hash route for a view: #/screens/<id>, #/flows/<id>, #/map or #/map/<id>. */
export function routeOf(view: PanelView, id: string): string {
  const e = encodeURIComponent;
  switch (view) {
    case "screen":
      return `#/screens/${e(id)}`;
    case "flow":
      return `#/flows/${e(id)}`;
    case "map":
      return id === "" ? "#/map" : `#/map/${e(id)}`;
  }
}

/** titleOf is a panel's title: Starboard: <screen or flow id>, or Starboard: App map. */
export function titleOf(view: PanelView, id: string): string {
  return view === "map" ? "Starboard: App map" : `Starboard: ${id}`;
}

/** What a panel reports under the integration tests. */
export interface PanelReport {
  view: PanelView;
  id: string;
  heading: string;
  tabs: string[];
  nodes: number;
}

/** stampOf is the stamp of the file at uri: an unsaved buffer's version, else the file's mtime and size, or null. */
async function stampOf(uri: vscode.Uri): Promise<{ mtime: number; size: number } | null> {
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (doc?.isDirty) {
    // A buffer has no mtime; its version, negated so it is never a time,
    // moves with every keystroke, so it alone is the stamp.
    return { mtime: -doc.version, size: 0 };
  }
  try {
    const s = await vscode.workspace.fs.stat(uri);
    return { mtime: s.mtime, size: s.size };
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === "FileNotFound") return null;
    throw err;
  }
}

/** One panel: a view of one project, and its page's messages. */
class Panel {
  readonly panel: vscode.WebviewPanel;
  private readonly owner: Panels;
  readonly project: Project;
  readonly view: PanelView;
  readonly id: string;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];
  private applied: ((outcome: string) => void)[] = [];
  /** The edit and fix results given to this page, which alone it may write. */
  private readonly edits = new EditLog();
  /** The paths the page's last readAll gave it: what it may read and stat, with those its results change. */
  private known = new Set<string>();

  constructor(owner: Panels, project: Project, view: PanelView, id: string, panel: vscode.WebviewPanel) {
    this.owner = owner;
    this.project = project;
    this.view = view;
    this.id = id;
    this.panel = panel;
    this.subscriptions.push(
      panel.webview.onDidReceiveMessage((msg: unknown) => void this.receive(msg)),
      owner.projects.onDidInvalidate((p) => {
        if (p === project) this.reloadSoon();
      }),
    );
  }

  /**
   * post sends msg to the page. A panel closed meanwhile (a reply to a
   * request still in flight, a reload timer) has no page to tell: its
   * webview throws, or its postMessage rejects, and either is dropped.
   */
  private post(msg: FromExtension): void {
    try {
      this.panel.webview.postMessage(msg).then(undefined, () => undefined);
    } catch {
      // Disposed: nobody is listening.
    }
  }

  private reloadSoon(): void {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => this.post({ type: "reload" }), RELOAD_DELAY_MS);
  }

  /** testApply has the page apply ops through the app's state, and resolves with the outcome. */
  testApply(ops: Record<string, unknown>[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.applied = this.applied.filter((r) => r !== settle);
        reject(new Error(`the panel did not apply the ops in ${TEST_APPLY_TIMEOUT_MS} ms`));
      }, TEST_APPLY_TIMEOUT_MS);
      const settle = (outcome: string) => {
        clearTimeout(timer);
        resolve(outcome);
      };
      this.applied.push(settle);
      this.post({ type: "test-apply", ops });
    });
  }

  /** testRequest answers raw as if the page had sent it, and resolves with the reply: the tests' forged page. */
  testRequest(raw: unknown): Promise<Reply> {
    return new Promise((resolve) => void this.receive(raw, (m) => m.type === "reply" && resolve(m)));
  }

  private async receive(raw: unknown, reply: (msg: FromExtension) => void = (m) => this.post(m)): Promise<void> {
    const checked = checkToExtension(raw);
    if (!checked.ok) {
      this.owner.log(`Starboard's panel ${titleOf(this.view, this.id)} refused a message: ${checked.error}`);
      // A request that carried an id is answered, so the page does not wait on it.
      const id = (raw as { id?: unknown } | null)?.id;
      if (typeof id === "number" && Number.isSafeInteger(id) && id >= 0) {
        reply({ type: "reply", id, ok: false, error: `Refused: ${checked.error}.`, name: "PanelRefusal" });
      }
      return;
    }
    const msg: ToExtension = checked.value;
    switch (msg.type) {
      case "rendered":
        if (this.owner.testing) this.owner.report({ view: this.view, id: this.id, heading: msg.heading, tabs: msg.tabs, nodes: msg.nodes });
        return;
      case "applied":
        if (this.owner.testing) this.applied.shift()?.(msg.outcome);
        return;
      default:
        await this.answer(msg, reply);
    }
  }

  private async answer(req: Request, reply: (msg: FromExtension) => void): Promise<void> {
    try {
      reply({ type: "reply", id: req.id, ok: true, value: await this.run(req) });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (req.type === "write") this.owner.log(`Starboard's panel ${titleOf(this.view, this.id)} wrote nothing: ${e.message}`);
      reply({ type: "reply", id: req.id, ok: false, error: e.message || String(err), name: e.name });
    }
  }

  private uri(path: string): vscode.Uri {
    return vscode.Uri.joinPath(this.project.root, ...path.split("/"));
  }

  /** readable throws PanelRefusal unless path is a file the page was given, or one a result of its changes. */
  private readable(path: string): void {
    if (!this.known.has(path) && !this.edits.paths().includes(path)) {
      throw new PanelRefusal(`${path} is not a file of the project the panel read.`);
    }
  }

  private async run(req: Request): Promise<unknown> {
    switch (req.type) {
      case "readAll": {
        // A fresh read: the changes worked out from the old one are stale.
        this.edits.clear();
        const read = await this.project.host.readAll();
        this.known = new Set(Object.keys(read.files));
        const out: ReadAllResult = { files: read.files, content: read.content, listedOnly: [...read.listedOnly] };
        return out;
      }
      case "read":
        this.readable(req.path);
        return (await currentText(this.uri(req.path))) ?? null;
      case "stat":
        this.readable(req.path);
        return stampOf(this.uri(req.path));
      case "write": {
        const base = this.edits.find(req.changes);
        if (base === undefined) throw new PanelRefusal("the write is not a change core worked out for this panel, so nothing was written.");
        await applyCoreResult(this.project, req.changes, base);
        this.edits.take(req.changes);
        for (const path of Object.keys(req.changes)) this.known.add(path);
        return null;
      }
      case "core":
        return this.core(req);
    }
  }

  /**
   * core answers a core call on the extension's own read of the project:
   * the page's files are not trusted, so they are replaced, and of its
   * arguments only the rest (edit's ops, lint's strict, render's screen)
   * are kept, as checkToExtension checked them. An edit's or a fix's
   * result is kept, with that read, as a change the page may write.
   */
  private async core(req: Request & { type: "core" }): Promise<unknown> {
    const read = (await this.project.host.readAll()).files;
    const args = [read, ...req.args.slice(1)];
    const core = this.project.core;
    switch (req.fn) {
      case "edit": {
        const result = await core.edit(read, args[1] as Parameters<typeof core.edit>[1]);
        this.edits.add(result.files, read);
        return result;
      }
      case "fix": {
        const result = await core.fix(read);
        const changes: Record<string, string | null> = { ...result.write };
        for (const path of result.remove) changes[path] = null;
        if (Object.keys(changes).length > 0) this.edits.add(changes, read);
        return result;
      }
      case "model":
        return core.model(read);
      case "lint":
        return args.length > 1 ? core.lint(read, args[1] as boolean) : core.lint(read);
      case "render":
        return core.render(read, args[1] as string, args[2] as string, args[3] as string | undefined);
      case "walkthrough":
        return core.walkthrough(read, args[1] as string, args[2] as string);
      case "scope":
        return core.scope(read);
    }
  }

  dispose(): void {
    clearTimeout(this.reloadTimer);
    for (const d of this.subscriptions) d.dispose();
    for (const resolve of this.applied) resolve("disposed");
    this.applied = [];
  }
}

/** The panels, and the commands that open them. */
export class Panels implements vscode.Disposable {
  readonly projects: Projects;
  private readonly commands: Commands;
  private readonly embed: vscode.Uri;
  readonly log: (message: string) => void;
  /** Whether the page's test-only messages are on: under the integration tests alone. */
  readonly testing: boolean;
  private readonly open = new Map<string, Panel>();
  private readonly reported = new vscode.EventEmitter<PanelReport>();
  /** Fires, under the integration tests, each time a panel's page reports what it shows. */
  readonly onDidReport = this.reported.event;
  private readonly registration: vscode.Disposable;

  constructor(
    projects: Projects,
    commands: Commands,
    extensionUri: vscode.Uri,
    log: (message: string) => void,
    testing = process.env[PANEL_TEST_ENV] === "1",
  ) {
    this.projects = projects;
    this.commands = commands;
    this.embed = vscode.Uri.joinPath(extensionUri, "dist-embed");
    this.log = log;
    this.testing = testing;
    this.registration = vscode.Disposable.from(
      this.reported,
      vscode.commands.registerCommand(OPEN_MAP_COMMAND, (id: unknown, at: unknown) => this.openMap(id, at)),
      vscode.commands.registerCommand(OPEN_SCREEN_COMMAND, (id: unknown, at: unknown) => this.openScreen(id, at)),
      vscode.commands.registerCommand(OPEN_FLOW_COMMAND, (id: unknown, at: unknown) => this.openFlow(id, at)),
      projects.onDidChange(() => {
        // A project that is gone takes its panels with it.
        const live = new Set(projects.all());
        for (const p of [...this.open.values()]) if (!live.has(p.project)) p.panel.dispose();
      }),
    );
  }

  report(r: PanelReport): void {
    this.reported.fire(r);
  }

  /**
   * projectAndModel is the project a command acts on, and its model: the
   * project of at (a file URI string, as the hover and CodeLens pass), or
   * else the active editor's, the only one, or the one picked.
   */
  private async projectAndModel(at: unknown): Promise<{ project: Project; model: Model } | undefined> {
    let project: Project | undefined;
    if (typeof at === "string") {
      try {
        project = this.projects.projectFor(vscode.Uri.parse(at, true));
      } catch {
        project = undefined;
      }
      if (!project) return undefined;
    } else {
      project = await this.commands.projectOf();
    }
    if (!project) return undefined;
    const model = await project.model().catch((err: unknown) => {
      this.commands.ui.error(`Starboard could not read the project: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    });
    return model ? { project, model } : undefined;
  }

  /** openMap opens the project's app map, centred on screen id when one is given. */
  async openMap(id?: unknown, at?: unknown): Promise<void> {
    const got = await this.projectAndModel(at);
    if (!got) return;
    if (typeof id === "string" && id !== "" && !got.model.screens.some((s) => s.id === id)) {
      this.log(`Starboard's app map was asked to centre on ${id}, which the project does not have.`);
      return;
    }
    await this.show(got.project, "map", typeof id === "string" ? id : "");
  }

  /** openScreen opens screen id, or the one picked from the project's screens. */
  async openScreen(id?: unknown, at?: unknown): Promise<void> {
    const got = await this.projectAndModel(at);
    if (!got) return;
    const ids = got.model.screens.map((s) => ({ label: s.id, description: s.title, value: s.id }));
    const chosen = await this.choose(id, ids, "Starboard: Open screen", "Which screen?");
    if (chosen !== undefined) await this.show(got.project, "screen", chosen);
  }

  /** openFlow opens flow id, or the one picked from the project's flows. */
  async openFlow(id?: unknown, at?: unknown): Promise<void> {
    const got = await this.projectAndModel(at);
    if (!got) return;
    const ids = got.model.flows.map((f) => ({ label: f.id, description: f.title, value: f.id }));
    const chosen = await this.choose(id, ids, "Starboard: Open flow", "Which flow?");
    if (chosen !== undefined) await this.show(got.project, "flow", chosen);
  }

  /** choose is id when it is one of items, nothing when it is another, or the item picked when there is no id. */
  private async choose(id: unknown, items: { label: string; description: string; value: string }[], title: string, placeHolder: string): Promise<string | undefined> {
    if (id !== undefined && id !== null) {
      if (typeof id === "string" && items.some((i) => i.value === id)) return id;
      this.log(`Starboard's panel was asked to open ${String(id)}, which the project does not have.`);
      return undefined;
    }
    if (items.length === 0) {
      this.commands.ui.info("The project has none to open yet.");
      return undefined;
    }
    return (await this.commands.ui.pickOne(items, { title, placeHolder }))?.value;
  }

  /** find is the open panel of a view, if any. */
  find(view: PanelView, id: string, project?: Project): vscode.WebviewPanel | undefined {
    for (const p of this.open.values()) {
      if (p.view === view && p.id === id && (!project || p.project === project)) return p.panel;
    }
    return undefined;
  }

  private entry(view: PanelView, id: string): Panel | undefined {
    return [...this.open.values()].find((x) => x.view === view && x.id === id);
  }

  /** testApply has the open panel of a view apply ops, under the integration tests alone. */
  testApply(view: PanelView, id: string, ops: Record<string, unknown>[]): Promise<string> {
    const p = this.entry(view, id);
    if (!this.testing || !p) return Promise.reject(new Error(`no panel of ${view} ${id} to apply to`));
    return p.testApply(ops);
  }

  /** testRequest has the open panel of a view answer raw as if its page sent it, under the integration tests alone. */
  testRequest(view: PanelView, id: string, raw: unknown): Promise<Reply> {
    const p = this.entry(view, id);
    if (!this.testing || !p) return Promise.reject(new Error(`no panel of ${view} ${id} to ask`));
    return p.testRequest(raw);
  }

  /** show reveals the panel of view id in project, opening one if there is none. */
  async show(project: Project, view: PanelView, id: string): Promise<void> {
    const key = `${project.root.toString()}|${view}|${id}`;
    const have = this.open.get(key);
    if (have) {
      have.panel.reveal();
      return;
    }
    const title = titleOf(view, id);
    const panel = vscode.window.createWebviewPanel(PANEL_VIEW_TYPE, title, vscode.ViewColumn.Active, {
      enableScripts: true,
      // The page loads its own bundle alone: every file of the project comes as a message.
      localResourceRoots: [this.embed],
    });
    const entry = new Panel(this, project, view, id, panel);
    this.open.set(key, entry);
    panel.onDidDispose(() => {
      entry.dispose();
      if (this.open.get(key) === entry) this.open.delete(key);
    });
    const name = project.root.path.split("/").filter((s) => s !== "").pop() ?? "";
    panel.webview.html = pageHtml({
      cspSource: panel.webview.cspSource,
      script: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.embed, "embed.js")).toString(),
      style: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.embed, "embed.css")).toString(),
      title,
      config: { route: routeOf(view, id), name, ...(this.testing ? { test: true } : {}) },
    });
  }

  dispose(): void {
    for (const p of [...this.open.values()]) p.panel.dispose();
    this.open.clear();
    this.registration.dispose();
  }
}
