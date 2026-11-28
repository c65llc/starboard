// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The Vite configs as a release evaluates them: release.yml's desktop leg
// sets STARBOARD_VERSION to the tag, a pre-release one included, which the
// desktop build takes and the PWA's build refuses. Each config is imported
// afresh, so its module is evaluated under the version given.

import type { UserConfig } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saved = process.env.STARBOARD_VERSION;

async function evaluate(config: string, version: string): Promise<UserConfig> {
  process.env.STARBOARD_VERSION = version;
  vi.resetModules();
  return ((await import(config)) as { default: UserConfig }).default;
}

describe("the version each build is stamped with", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    if (saved === undefined) delete process.env.STARBOARD_VERSION;
    else process.env.STARBOARD_VERSION = saved;
  });

  it("the desktop build takes a pre-release tag", async () => {
    const config = await evaluate("../../vite.config.desktop.ts", "v1.2.3-rc.1");
    expect(config.define?.["__APP_VERSION__"]).toBe(JSON.stringify("v1.2.3-rc.1"));
  });

  it("the desktop build takes a release tag", async () => {
    const config = await evaluate("../../vite.config.desktop.ts", "v1.2.3");
    expect(config.define?.["__APP_VERSION__"]).toBe(JSON.stringify("v1.2.3"));
  });

  it("the PWA's build still refuses a pre-release tag, and takes a release one", async () => {
    await expect(evaluate("../../vite.config.ts", "v1.2.3-rc.1")).rejects.toThrow(/STARBOARD_VERSION must be vX\.Y\.Z or dev, got v1\.2\.3-rc\.1/);
    const config = await evaluate("../../vite.config.ts", "v1.2.3");
    expect(config.define?.["__APP_VERSION__"]).toBe(JSON.stringify("v1.2.3"));
  });
});
