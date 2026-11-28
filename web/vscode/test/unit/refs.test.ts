// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Reference completion's triggers and the hover card's Markdown: pure
// parts of refs.ts, run without VS Code.

import { describe, expect, it } from "vitest";

import type { Model, Screen } from "@c65llc/starboard-core";
import { refSyntax } from "@c65llc/starboard-app/src/flows/refs.ts";

import { cardText, completionContext, escape, findRegion } from "../../src/refs.ts";

/** internal/flows.RefPattern, as core.model reports it. */
const syntax = refSyntax("(^|[^\\w@.])@([a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)+)(?:#([a-z][a-z0-9-]*))?");

describe("completionContext", () => {
  it("completes right after @, in a partial ID, and after #", () => {
    expect(completionContext("@", syntax)).toMatchObject({ kind: "screen", from: 1 });
    expect(completionContext("see @auth.si", syntax)).toMatchObject({ kind: "screen", from: 5 });
    expect(completionContext("@auth.sign-in#", syntax)).toMatchObject({ kind: "region", screen: "auth.sign-in", from: 14 });
    expect(completionContext("@auth.sign-in#em", syntax)).toMatchObject({ kind: "region", screen: "auth.sign-in", from: 14 });
  });

  it("offers nothing in an e-mail address or anywhere else", () => {
    expect(completionContext("email@domain.com", syntax)).toBeUndefined();
    expect(completionContext("a@", syntax)).toBeUndefined();
    expect(completionContext("a@b", syntax)).toBeUndefined();
    expect(completionContext("plain text", syntax)).toBeUndefined();
    expect(completionContext("@@", syntax)).toBeUndefined();
  });
});

const screen = {
  id: "auth.sign-in",
  title: "[x](command:workbench.action.quit)",
  area: "auth",
  presentation: "full",
  purpose: "Sign in.\n[click](command:workbench.action.quit)",
  status: { ios: "built" },
  layout: [{ name: "form", kind: "form", label: "<b>Hi</b>", children: [{ name: "email", kind: "field", label: "Email", children: [], item: null }], item: null }],
  layouts: {},
} as unknown as Screen;
const model = { flows: [{ id: "f", title: "Flow *one*", screens: ["auth.sign-in"] }] } as unknown as Model;

describe("cardText", () => {
  it("renders a hostile title as text, never a link", () => {
    const text = cardText(model, screen, "");
    expect(text).toContain("\\[x\\]\\(command\\:workbench\\.action\\.quit\\)");
    expect(text).not.toMatch(/(^|[^\\])\[/);
    expect(text).not.toMatch(/(^|[^\\])</);
    expect(text).not.toContain("\n[");
  });

  it("lists the flows using the screen and the region's kind and label", () => {
    const text = cardText(model, screen, "email");
    expect(text).toContain("Used in: Flow \\*one\\*");
    expect(text).toContain("region email · field · Email");
    expect(text).toContain("ios: built");
    expect(cardText(model, screen, "nowhere")).not.toContain("region");
  });

  it("finds a nested region", () => {
    expect(findRegion(screen, "email")?.kind).toBe("field");
    expect(escape("a\nb")).toBe("a b");
  });
});
