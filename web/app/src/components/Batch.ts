// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A batch of a large list drawn a batch per frame (the app map's screens
// and edges, its link table's rows). Each batch is rendered again only when
// one of its props changes, so the frame that adds a batch renders that
// batch alone, not every element drawn before it (#22).

import { Component } from "preact";
import type { ComponentChild } from "preact";

export abstract class Batch<P extends object> extends Component<P> {
  override shouldComponentUpdate(next: P): boolean {
    const now = this.props as Record<string, unknown>;
    return Object.entries(next).some(([k, v]) => now[k] !== v);
  }
  abstract override render(): ComponentChild;
}
