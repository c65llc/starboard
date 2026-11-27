// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The specs' test and expect: Playwright's, with one Firefox-only change to
// the page under test, made before any page script runs.
//
// Firefox (Gecko, Mozilla bug 2090055) crashes its content process with a
// null dereference when an element's reflected ARIA element property
// (ariaLabelledByElements and its kin) is read from two JavaScript worlds.
// Playwright reads ariaLabelledByElements to compute accessible names: in
// its isolated utility world for count() and expect(), and in the page's
// main world for evaluateAll() and other main-world queries. So a page with
// any aria-labelledby, after a getByRole query with a name in each world,
// crashes, whatever the app does (e2e/firefox-aria-reflection.spec.ts pins
// this). The app reads none of these properties (no aria*Element(s) in
// src/), so taking them off Element.prototype in the main world changes
// nothing it does: Playwright's main-world code falls back to the
// aria-labelledby attribute, and its utility world, which sees the native
// prototype through Xrays, still reads the native property, alone.

import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

/** Takes the reflected ARIA element properties off Element.prototype, in the page's own world. */
function hideReflectedAriaElements(): void {
  for (const name of Object.getOwnPropertyNames(Element.prototype)) {
    if (/^aria[A-Z]\w*Elements?$/.test(name)) Reflect.deleteProperty(Element.prototype, name);
  }
}

export const test = base.extend({
  context: async ({ context, browserName }, use) => {
    if (browserName === "firefox") await context.addInitScript(hideReflectedAriaElements);
    await use(context);
  },
});
