// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Screen references in any file: hover, go-to-definition and completion for
// @screen.id and @screen.id#region, in a flow, a source file or a comment,
// whatever its language. The providers register for every file: and
// untitled: document with no language filter, so a Swift file's comment
// answers with no Swift extension installed. References are read with
// core's own pattern (model.refPattern); the extension parses no file of
// the project itself. A dangling reference has no hover and no definition.

import * as vscode from "vscode";

import type { Flow, Model, Region, Screen } from "@c65llc/starboard-core";
import { findRefs, refContext, refSyntax, regionNames } from "@c65llc/starboard-app/src/flows/refs.ts";
import type { Ref, RefSyntax } from "@c65llc/starboard-app/src/flows/refs.ts";

import type { Project, Projects } from "./projects.ts";

// ---------------------------------------------------------------------
// Pure parts.

/** The documents the providers answer for: every file and untitled one, in any language. */
export const SELECTOR: vscode.DocumentSelector = [{ scheme: "file" }, { scheme: "untitled" }];

/** The characters that open completion: after @ and #, and inside the dotted ID. */
export const TRIGGERS = ["@", "#", "."];

/** escape makes s, a model string, plain text in Markdown: no link, no emphasis, no HTML, one line. */
export function escape(s: string): string {
  return s.replace(/\s*\n\s*/g, " ").replace(/[\\`*_{}[\]()#+\-.!|<>~&:]/g, "\\$&");
}

/** completionContext says what to complete from the text before the cursor, or undefined where nothing is offered. */
export function completionContext(before: string, syntax: RefSyntax): { kind: "screen" | "region"; screen: string; from: number } | undefined {
  const c = refContext(before, 0, syntax);
  if (!c) return undefined;
  return { kind: c.kind, screen: c.kind === "region" ? c.screen : "", from: c.from };
}

/** findRegion is the first region named name in a screen's layouts, or undefined. */
export function findRegion(screen: Screen, name: string): Region | undefined {
  const search = (regions: Region[]): Region | undefined => {
    for (const r of regions) {
      if (r.name === name) return r;
      const found = search(r.children) ?? (r.item ? search([r.item]) : undefined);
      if (found) return found;
    }
    return undefined;
  };
  return search(screen.layout) ?? Object.values(screen.layouts).map(search).find((r) => r !== undefined);
}

/**
 * cardText is the hover card's Markdown for a reference: the screen, and
 * the region when the reference names one. Every model string goes through
 * escape, so a title cannot add a link or a command.
 */
export function cardText(model: Model, screen: Screen, region: string): string {
  const out: string[] = [`**${escape(screen.title || screen.id)}**`];
  out.push(`screen ${escape(screen.id)} · ${escape(screen.area)} · ${escape(screen.presentation)}`);
  if (screen.purpose !== "") out.push(escape(screen.purpose));
  const status = Object.entries(screen.status).map(([platform, s]) => `${escape(platform)}: ${escape(s)}`);
  if (status.length > 0) out.push(status.join(" · "));
  const flows = usedIn(model.flows, screen.id);
  if (flows.length > 0) out.push(`Used in: ${flows.map((f) => escape(f.title || f.id)).join(", ")}`);
  if (region !== "") {
    const r = findRegion(screen, region);
    if (r) out.push(`region ${escape(r.name)} · ${escape(r.kind)}${r.label !== "" ? ` · ${escape(r.label)}` : ""}`);
  }
  return out.join("\n\n");
}

/** usedIn is the flows that name screen id. */
function usedIn(flows: Flow[], id: string): Flow[] {
  return flows.filter((f) => f.screens.includes(id));
}

// ---------------------------------------------------------------------
// The providers.

/** The references of one document version, by document. */
export class RefsCache {
  private readonly entries = new Map<string, { version: number; pattern: string; refs: Ref[] }>();

  get(doc: vscode.TextDocument, syntax: RefSyntax): Ref[] {
    const id = doc.uri.toString();
    const hit = this.entries.get(id);
    if (hit && hit.version === doc.version && hit.pattern === syntax.pattern) return hit.refs;
    const refs = findRefs(doc.getText(), syntax);
    this.entries.set(id, { version: doc.version, pattern: syntax.pattern, refs });
    return refs;
  }

  drop(doc: vscode.TextDocument): void {
    this.entries.delete(doc.uri.toString());
  }
}

/** The project-relative path of each model's screens.yaml, read once per model. */
const registryPaths = new WeakMap<Model, Promise<string>>();

/** screenLocation is where screen is declared: its ID's line in the project's screens.yaml, or undefined when that file cannot be located. */
export async function screenLocation(project: Project, model: Model, screen: Screen): Promise<vscode.Location | undefined> {
  let path = registryPaths.get(model);
  if (!path) {
    path = project.host.readAll().then(({ content }) => (content === "." || content === "" ? "screens.yaml" : `${content}/screens.yaml`));
    registryPaths.set(model, path);
    path.catch(() => registryPaths.delete(model));
  }
  const rel = await path.catch(() => undefined);
  if (rel === undefined) return undefined;
  const uri = vscode.Uri.joinPath(project.root, ...rel.split("/"));
  return new vscode.Location(uri, new vscode.Position(Math.max(0, screen.line - 1), 0));
}

class RefProviders implements vscode.HoverProvider, vscode.DefinitionProvider, vscode.CompletionItemProvider {
  private readonly cache = new RefsCache();
  private readonly projects: Projects;

  constructor(projects: Projects) {
    this.projects = projects;
  }

  drop(doc: vscode.TextDocument): void {
    this.cache.drop(doc);
  }

  /** The project that answers for doc: the nearest above a file, or for an untitled buffer the workspace's only one. */
  private projectOf(doc: vscode.TextDocument): Project | undefined {
    if (doc.uri.scheme !== "untitled") return this.projects.projectFor(doc.uri);
    const all = this.projects.all();
    return all.length === 1 ? all[0] : undefined;
  }

  private async at(
    doc: vscode.TextDocument,
    pos: vscode.Position,
  ): Promise<{ project: Project; model: Model; screen: Screen; ref: Ref; range: vscode.Range } | undefined> {
    const project = this.projectOf(doc);
    if (!project) return undefined;
    const model = await project.model().catch(() => undefined);
    if (!model) return undefined;
    const offset = doc.offsetAt(pos);
    for (const ref of this.cache.get(doc, refSyntax(model.refPattern))) {
      if (offset < ref.from || offset > ref.to) continue;
      const screen = model.screens.find((s) => s.id === ref.screen);
      if (!screen) continue;
      return { project, model, screen, ref, range: new vscode.Range(doc.positionAt(ref.from), doc.positionAt(ref.to)) };
    }
    return undefined;
  }

  async provideHover(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Hover | undefined> {
    const hit = await this.at(doc, pos);
    if (!hit) return undefined;
    // Open in Starboard joins this card with the panel (Task 5).
    const md = new vscode.MarkdownString(cardText(hit.model, hit.screen, hit.ref.region));
    md.isTrusted = false;
    md.supportHtml = false;
    return new vscode.Hover(md, hit.range);
  }

  async provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Location | undefined> {
    const hit = await this.at(doc, pos);
    if (!hit) return undefined;
    return screenLocation(hit.project, hit.model, hit.screen);
  }

  async provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.CompletionItem[] | undefined> {
    const project = this.projectOf(doc);
    if (!project) return undefined;
    const model = await project.model().catch(() => undefined);
    if (!model) return undefined;
    const before = doc.lineAt(pos.line).text.slice(0, pos.character);
    const ctx = completionContext(before, refSyntax(model.refPattern));
    if (!ctx) return undefined;
    const range = new vscode.Range(pos.line, ctx.from, pos.line, pos.character);
    const item = (label: string, detail: string): vscode.CompletionItem => {
      const i = new vscode.CompletionItem(label, vscode.CompletionItemKind.Reference);
      i.detail = detail;
      i.range = range;
      i.filterText = label;
      return i;
    };
    if (ctx.kind === "screen") return model.screens.map((s) => item(s.id, s.title));
    const screen = model.screens.find((s) => s.id === ctx.screen);
    if (!screen) return undefined;
    return regionNames(screen).map((name) => item(name, findRegion(screen, name)?.kind ?? ""));
  }
}

/** registerRefs registers hover, definition and completion for screen references in any file. */
export function registerRefs(projects: Projects): vscode.Disposable {
  const providers = new RefProviders(projects);
  return vscode.Disposable.from(
    vscode.languages.registerHoverProvider(SELECTOR, providers),
    vscode.languages.registerDefinitionProvider(SELECTOR, providers),
    vscode.languages.registerCompletionItemProvider(SELECTOR, providers, ...TRIGGERS),
    vscode.workspace.onDidCloseTextDocument((doc) => providers.drop(doc)),
  );
}
