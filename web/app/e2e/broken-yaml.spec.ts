// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Review Focus 3: a screens.yaml with a syntax error still opens. The lint
// panel shows yaml-syntax at its line, the editor shows an error state,
// and the Source tab, editable while the registry does not parse, mends it.

import { expect, test } from "./test.ts";
import { cspViolations, expectNoAxeViolations, hostFiles, openFiles, REGISTRY } from "./helpers.ts";
import type { Files } from "./helpers.ts";

const BROKEN_LINE = "  broken.screen: [\n";

test("a broken screens.yaml opens, says where it breaks, and the Source tab fixes it", async ({ page }) => {
  const csp = cspViolations(page);
  await page.goto("./");
  // The example project, as the app bundles it, with its registry broken.
  await page.getByRole("button", { name: "Explore the example project" }).click();
  await expect(page.getByRole("link", { name: /0 errors, 0 warnings/ })).toBeVisible({ timeout: 30_000 });
  const good: Files = await hostFiles(page);
  const original = good[REGISTRY] ?? "";
  const brokenAt = original.split("\n").length; // the appended line's number: the text ends with "\n"
  await openFiles(page, { ...good, [REGISTRY]: original + BROKEN_LINE }, "broken");

  // The flows' references to its screens fail too, so there is more than one error.
  await expect(page.getByRole("link", { name: /Lint: [1-9]\d* errors?/ })).toBeVisible({ timeout: 30_000 });
  const lint = page.getByRole("region", { name: "Lint findings" });
  // The example's many flows put more than the first page of findings ahead of it.
  await lint.getByRole("button", { name: /^Show all \d+ findings$/ }).click();
  const finding = lint.getByRole("button", { name: /yaml-syntax/ });
  await expect(finding).toBeVisible();
  await expect(finding).toContainText(`screens.yaml:${brokenAt}`);

  await expect(page.getByRole("alert")).toContainText("screens.yaml does not parse");
  await expect(page.getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true");
  const editor = page.getByRole("textbox", { name: "screens.yaml source" });
  await expect(editor).toBeVisible();
  await expect(editor).not.toHaveAttribute("aria-readonly", "true");
  await expectNoAxeViolations(page);

  // Delete the broken last line: go to the end, then remove the line.
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Backspace");
  await page.getByRole("button", { name: "Save screens.yaml" }).click();

  await expect(page.getByRole("link", { name: /0 errors, 0 warnings/ })).toBeVisible({ timeout: 30_000 });
  expect((await hostFiles(page))[REGISTRY]).toBe(original);
  await expect(page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: /^trip\.timeline/ })).toBeVisible();
  expect(csp).toEqual([]);
});
