// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The values core returns, field for field as the Go package
// github.com/c65llc/starboard/core marshals them (its JSON tags are the
// source of truth; keep this file in step with core/*.go and
// internal/diag). Lists and maps are never null; a field Go tags
// omitempty is optional here.

/** A project: file contents keyed by project-relative slash path. */
export type Files = Record<string, string>;

/** How serious a finding is. "off" never appears in results. */
export type Severity = "error" | "warn" | "off";

/** internal/diag.Fix: how to clear a finding. */
export interface Fix {
  description: string;
}

/** internal/diag.Diagnostic: one finding. */
export interface Diagnostic {
  rule: string;
  severity: Severity;
  file: string;
  /** Where in the file, such as "screens.home.layout[1]", or "". */
  path: string;
  /** 1-based; absent when the finding is about the whole file. */
  line?: number;
  message: string;
  fix?: Fix;
}

/** core.LintResult. passed is the CLI's exit status: no errors and, when strict, no warnings. */
export interface LintResult {
  diagnostics: Diagnostic[];
  errors: number;
  warnings: number;
  passed: boolean;
}

/** core.FixResult: what `starboard lint --fix` would write and remove. */
export interface FixResult {
  write: Record<string, string>;
  remove: string[];
}

/** core.ModelResult: the screens in registry order and the flows in file order. */
export interface Model {
  screens: Screen[];
  flows: Flow[];
}

/** core.Screen. */
export interface Screen {
  id: string;
  title: string;
  area: string;
  purpose: string;
  presentation: string;
  /** Status on each of platforms. */
  status: Record<string, string>;
  /** The configured platforms the screen is on, in config order. */
  platforms: string[];
  formFactors: string[];
  layout: Region[];
  /** Per-form-factor layout overrides. */
  layouts: Record<string, Region[]>;
  /** The default layout's navigation edges. */
  edges: Edge[];
  /** The line of the screen's ID in screens.yaml. */
  line: number;
}

/** core.Region: one node of a layout tree. */
export interface Region {
  name: string;
  kind: string;
  label: string;
  to: string;
  requires: string;
  status: string;
  platformNote: string;
  /** As written: pixels such as "240", a fraction such as "1/3", or "". */
  width: string;
  children: Region[];
  item: Region | null;
  empty: EmptyState | null;
  items: NavItem[];
  /** Locates the region below its screen, such as "layout[1].item"; EditOp.path takes it. */
  path: string;
  line: number;
}

/** core.EmptyState: a list's empty state. */
export interface EmptyState {
  label: string;
}

/** core.NavItem: one entry of a tabs, nav or menu region. */
export interface NavItem {
  label: string;
  to: string;
  requires: string;
  status: string;
  path: string;
  line: number;
}

/** core.Edge: one navigation from a screen. */
export interface Edge {
  from: string;
  to: string;
  region: string;
  path: string;
  line: number;
}

/**
 * core.Flow: one flow document. id is the flow file's stem (not its front
 * matter id, which lint's flow-id-mismatch keeps equal to it); it is the
 * key walkthrough and the setFlowMeta and writeFlowBody edits take.
 */
export interface Flow {
  id: string;
  file: string;
  title: string;
  status: string;
  entry: string;
  steps: FlowStep[];
}

/** core.FlowStep: screen and region are the step's first reference's, or "". */
export interface FlowStep {
  number: number;
  text: string;
  screen: string;
  region: string;
  branches: string[];
  line: number;
}

/** core.Walk: a flow as a storyboard. */
export interface Walk {
  steps: WalkStep[];
}

/** core.WalkStep. svg is "" when the step has no reference or its screen is not registered. */
export interface WalkStep {
  number: number;
  text: string;
  screen: string;
  region: string;
  presentation: string;
  /** The next step's screen, or "". */
  next: string;
  branches: string[];
  svg: string;
}

/** The operations core.EditOp knows; see its Go doc for each one's fields. */
export type EditOpName =
  | "set"
  | "addScreen"
  | "removeScreen"
  | "insertRegion"
  | "removeRegion"
  | "moveRegion"
  | "setFlowMeta"
  | "writeFlowBody";

/** core.EditOp. Fields an op does not use may be left out. */
export interface EditOp {
  op: EditOpName;
  screen?: string;
  /** A region path as Model gives it, such as "layout[2].children[0]". */
  path?: string;
  /** May be dotted, such as "status.web". */
  key?: string;
  /** Any JSON value; null removes the key. */
  value?: unknown;
  index?: number;
  /** A flow file's stem, as Flow.id. */
  flow?: string;
}

/** core.EditResult: the files the edit changed, formatted, and the lint of the result. */
export interface EditResult {
  files: Record<string, string>;
  diagnostics: Diagnostic[];
}
