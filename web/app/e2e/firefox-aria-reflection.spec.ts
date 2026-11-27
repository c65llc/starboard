// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The Firefox crash e2e/test.ts works around (Mozilla bug 2090055): an
// element named by aria-labelledby, its name computed by a role query in
// Playwright's utility world (count) and then in the page's main world
// (evaluateAll). Without e2e/test.ts's fixture Playwright's Firefox
// crashes its content process at the second query (c65llc/starboard#9);
// with it, both answer. The second test keeps the workaround sound: hiding
// those properties is safe only while the app's own code reads none of them.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "./test.ts";

const page_ = `<button id="tab">phone</button><div role="tabpanel" aria-labelledby="tab">x</div>`;

test("a name from aria-labelledby is read in both worlds without crashing the page", async ({ page }) => {
  let crashed = false;
  page.on("crash", () => {
    crashed = true;
  });
  await page.goto("about:blank");
  await page.setContent(page_);
  const panel = page.getByRole("tabpanel", { name: "phone" });
  await expect(panel).toHaveCount(1);
  expect(await panel.evaluateAll((els) => els.map((el) => el.textContent))).toEqual(["x"]);
  await expect(panel).toHaveText("x");
  expect(crashed).toBe(false);
});

test("the app's source reads no reflected ARIA element property", () => {
  const src = fileURLToPath(new URL("../src", import.meta.url));
  const readers = readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => /\baria[A-Z]\w*Elements?\b/.test(readFileSync(join(src, f), "utf8")));
  expect(readers).toEqual([]);
});
