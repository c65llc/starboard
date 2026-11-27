// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// WCAG 1.4.11: the app map's idle edges and proposed outlines are
// graphics a person must see, so each needs 3:1 against the ground and
// the surface it can sit on, in the light theme and the dark.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/tokens.css"), "utf8");
const darkAt = css.indexOf("@media (prefers-color-scheme: dark)");
const themes = { light: css.slice(0, darkAt), dark: blockAt(css, darkAt) };

/** blockAt is the rule starting at at, to the brace that closes it: not the rest of the file. */
function blockAt(text: string, at: number): string {
  let depth = 0;
  for (let i = text.indexOf("{", at); i >= 0 && i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(at, i + 1);
  }
  throw new Error("the dark theme's block is not closed");
}

function token(block: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(block);
  if (!m?.[1]) throw new Error(`--${name} is not a #rrggbb colour here`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("map graphics contrast", () => {
  it("reads the dark theme from its own block only", () => {
    expect(darkAt).toBeGreaterThan(0);
    expect(blockAt("a{} @media x { b { c: d; } } e{}", 4)).toBe("@media x { b { c: d; } }");
  });

  it("computes WCAG contrast", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  for (const [theme, block] of Object.entries(themes)) {
    for (const fg of ["color-edge-idle", "color-proposed", "color-nav"]) {
      for (const bg of ["color-ground", "color-surface"]) {
        it(`${theme}: --${fg} is at least 3:1 against --${bg}`, () => {
          expect(contrast(token(block, fg), token(block, bg))).toBeGreaterThanOrEqual(3);
        });
      }
    }
  }
});
