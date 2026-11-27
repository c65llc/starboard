#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
//
// version.mjs — the one Starboard version the site shows: on the landing
// page (its release label, the install command and the Action snippet) and
// in the docs' pinned `version: vX.Y.Z` lines. It is, in order:
//   1. STARBOARD_VERSION, which the site and publish workflows set to the
//      release tag;
//   2. the newest release tag reachable from HEAD
//      (git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*');
//   3. "dev", when there is no tag.
//
// `node scripts/version.mjs --write` writes src/generated/version.json
// (gitignored), which index.astro imports; sync-content.sh runs it and uses
// the printed version for the docs. site-check.mjs imports siteVersion() to
// check that the built site shows this same version.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = /^v\d+\.\d+\.\d+$/;

/** The version and where it came from. */
export function siteVersion() {
  const env = process.env.STARBOARD_VERSION?.trim();
  if (env) {
    if (!RELEASE.test(env) && env !== 'dev') throw new Error(`STARBOARD_VERSION must be vX.Y.Z or dev, got ${env}`);
    return { version: env, source: 'STARBOARD_VERSION' };
  }
  try {
    const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*'], {
      cwd: websiteDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (RELEASE.test(tag)) return { version: tag, source: 'git describe' };
  } catch {
    // No tag reachable (a shallow clone, or a fork without tags).
  }
  return { version: 'dev', source: 'none' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const v = siteVersion();
  if (process.argv.includes('--write')) {
    const dir = join(websiteDir, 'src', 'generated');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'version.json'), JSON.stringify(v, null, 2) + '\n');
  }
  console.log(v.version);
}
