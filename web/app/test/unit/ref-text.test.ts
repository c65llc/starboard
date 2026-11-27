// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
// @vitest-environment jsdom

import { h, render } from "preact";
import { afterEach, describe, expect, it } from "vitest";

import { RefText } from "../../src/components/RefText.tsx";
import { syntax } from "./ref-pattern.ts";

afterEach(() => render(null, document.body));

describe("RefText", () => {
  it("links a reference to a registered screen, and shows any other as text", () => {
    render(
      h(RefText, { text: "Tap @trip.timeline#add, then @nowhere.screen.", syntax, known: (s: string) => s === "trip.timeline" }),
      document.body,
    );
    const links = [...document.querySelectorAll("a")];
    expect(links.map((a) => a.textContent)).toEqual(["@trip.timeline#add"]);
    expect(document.body.textContent).toBe("Tap @trip.timeline#add, then @nowhere.screen.");
    expect(document.querySelector(".ref-unknown")?.textContent).toBe("@nowhere.screen");
  });
});
