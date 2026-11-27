// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A part of a large list drawn a batch per frame (the app map's screens
// and edges, its link table's rows). It is rendered again only when one of
// its props changes, so the frame that adds a batch renders that batch
// alone, not every element drawn before it (#22).
//
// Each render is counted, by kind, in globalThis.__starboardRenders when a
// test has put an object there (test/unit/map-canvas.test.ts, the e2e
// perf spec), so a test can tell memoisation that works from DOM that
// merely looks right. Without that object, which the app never makes, the
// count is one property read.

import { Component } from "preact";
import type { ComponentChild } from "preact";

function tally(kind: string): void {
  const counts = (globalThis as { __starboardRenders?: Record<string, number> }).__starboardRenders;
  if (counts) counts[kind] = (counts[kind] ?? 0) + 1;
}

export abstract class Batch<P extends object> extends Component<P> {
  /** What the counts call it. */
  abstract readonly kind: string;
  override shouldComponentUpdate(next: P): boolean {
    const now = this.props as Record<string, unknown>;
    return Object.entries(next).some(([k, v]) => now[k] !== v);
  }
  override componentDidMount(): void {
    tally(this.kind);
  }
  override componentDidUpdate(): void {
    tally(this.kind);
  }
  abstract override render(): ComponentChild;
}
