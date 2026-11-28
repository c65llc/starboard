// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The extension-host side of runTest.ts: runs STARBOARD_SUITE's Mocha
// file, the one written for the workspace runTest opened.

import { join } from "node:path";

import Mocha from "mocha";

export function run(): Promise<void> {
  const suite = process.env["STARBOARD_SUITE"];
  if (!suite) return Promise.reject(new Error("STARBOARD_SUITE is not set"));
  const mocha = new Mocha({ ui: "bdd", timeout: 60_000, color: true });
  mocha.addFile(join(__dirname, `${suite}.test.js`));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures > 0 ? reject(new Error(`${failures} test(s) failed`)) : resolve()));
  });
}
