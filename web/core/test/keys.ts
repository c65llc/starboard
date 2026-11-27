// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Every field of the result types in src/types.ts, as data, for the Go to
// TypeScript drift test in core.test.ts. Each list is a Record over the
// type's keys, so tsc fails when a field is added to or removed from a type
// without this file; the test fails when Go marshals a field the type lacks.

import type { Diagnostic, Flow, LintResult, Model, Region, Screen, ScopeResult, WalkStep } from "../src/types.ts";

/** fields lists T's keys; `true` marks a field Go always sends, `false` one it may omit (omitempty). */
type Fields<T> = Record<keyof T, boolean>;

export const MODEL: Fields<Model> = {
  screens: true,
  flows: true,
  areas: true,
  idPattern: true,
  refPattern: true,
  flowIdPattern: true,
  flowKeys: true,
  kinds: true,
  presentations: true,
};

export const SCREEN: Fields<Screen> = {
  id: true,
  title: true,
  area: true,
  purpose: true,
  presentation: true,
  status: true,
  platforms: true,
  formFactors: true,
  layout: true,
  layouts: true,
  edges: true,
  files: true,
  line: true,
};

export const REGION: Fields<Region> = {
  name: true,
  kind: true,
  label: true,
  to: true,
  requires: true,
  status: true,
  platformNote: true,
  width: true,
  children: true,
  item: true,
  empty: true,
  items: true,
  path: true,
  line: true,
};

export const FLOW: Fields<Flow> = {
  id: true,
  file: true,
  title: true,
  status: true,
  entry: true,
  frontMatterId: true,
  actors: true,
  platforms: true,
  steps: true,
  screens: true,
};

export const LINT: Fields<LintResult> = { diagnostics: true, errors: true, warnings: true, passed: true };

export const DIAGNOSTIC: Fields<Diagnostic> = {
  rule: true,
  severity: true,
  file: true,
  path: true,
  line: false,
  message: true,
  fix: false,
};

export const WALK_STEP: Fields<WalkStep> = {
  number: true,
  text: true,
  screen: true,
  region: true,
  presentation: true,
  next: true,
  branches: true,
  svg: true,
};

export const SCOPE: Fields<ScopeResult> = { content: true, read: true, present: true };

/**
 * keysMatch reports how value's keys differ from fields: the keys Go sent
 * that the type lacks, and the always-sent keys missing. Both empty is a match.
 */
export function keysMatch(value: object, fields: Record<string, boolean>): { unknown: string[]; missing: string[] } {
  const got = Object.keys(value);
  return {
    unknown: got.filter((k) => !(k in fields)).sort(),
    missing: Object.keys(fields)
      .filter((k) => fields[k] && !got.includes(k))
      .sort(),
  };
}
