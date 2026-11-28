// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// What the Vite configs share: the version the header shows and the core's
// assets. Side-effect free, so importing it evaluates no config: the PWA's
// (vite.config.ts) refuses a pre-release STARBOARD_VERSION when it is
// evaluated, and the desktop build (vite.config.desktop.ts), which takes
// one, must not run that check.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

// The version the header shows, the same one the website shows
// (website/scripts/version.mjs): STARBOARD_VERSION, which the site and
// publish workflows set to the release tag; else the newest stable release
// tag reachable from HEAD; else "dev". Never package.json's version, which
// no release bumps. The desktop build (vite.config.desktop.ts) also takes
// a pre-release tag (vX.Y.Z-pre), which release.yml's desktop-bundle leg
// sets for a pre-release; the site and the PWA are built from stable ones.
const RELEASE = /^v\d+\.\d+\.\d+$/;
const PRERELEASE = /^v\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/;
export function appVersion({ prerelease = false }: { prerelease?: boolean } = {}): string {
  const env = process.env.STARBOARD_VERSION?.trim();
  if (env) {
    if (prerelease && PRERELEASE.test(env)) return env;
    if (!RELEASE.test(env) && env !== "dev") {
      throw new Error(`STARBOARD_VERSION must be vX.Y.Z${prerelease ? ", vX.Y.Z-pre" : ""} or dev, got ${env}`);
    }
    return env;
  }
  try {
    const tag = execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*", "--exclude", "*-*"], {
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (RELEASE.test(tag)) return tag;
  } catch {
    // No tag reachable (a shallow clone, or a fork without tags).
  }
  return "dev";
}

/**
 * coreAssets serves (under base) and emits starboard.wasm and wasm_exec.js as
 * <base>core/…, side by side as @c65llc/starboard-core expects: wasm_exec.js
 * must sit beside the module, so neither is content-hashed (the service
 * worker's precache revisions version them instead). The desktop build
 * (vite.config.desktop.ts) emits them the same way.
 */
export function coreAssets(base: string): Plugin {
  const files: Record<string, string> = {
    "starboard.wasm": "application/wasm",
    "wasm_exec.js": "text/javascript",
  };
  const source = (name: string) => fileURLToPath(import.meta.resolve(`@c65llc/starboard-core/${name}`));
  return {
    name: "starboard-core-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.startsWith(`${base}core/`) ? req.url.slice(`${base}core/`.length).split("?")[0] : undefined;
        const type = name ? files[name] : undefined;
        if (!name || !type) return next();
        res.setHeader("Content-Type", type);
        res.end(readFileSync(source(name)));
      });
    },
    generateBundle() {
      for (const name of Object.keys(files)) {
        this.emitFile({ type: "asset", fileName: `core/${name}`, source: readFileSync(source(name)) });
      }
    },
  };
}
