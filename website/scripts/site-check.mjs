#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
//
// site-check.mjs — fail when the built site (website/dist) has drifted from
// the binary and the repository it documents:
//
//   1. /schema/v1/{config,screens}.json are byte-for-byte the schemas the
//      binary embeds (internal/schema/*.schema.json, and what
//      `starboard schema <name>` prints), and each one's $id is its own URL;
//   2. the set of /rules/<id>/ pages is exactly the set of rule IDs that
//      `starboard rules --json` lists, no more and no fewer;
//   3. every project under examples/ has its gallery page, /examples/<name>/;
//   4. the PWA is at /app/ (index.html and its service worker), without
//      Vite's build metadata (web/app/dist/.vite);
//   5. the release the site shows (the landing page's label, install command
//      and Action snippet, and the docs' pinned Action version) is the one
//      scripts/version.mjs gives, and no source map is published under /app/;
//   6. _headers is rendered (no placeholder left), /app/* allows what the
//      PWA needs ('wasm-unsafe-eval', worker-src 'self'), and *.wasm is
//      served as application/wasm.
//
// Usage, from the repository root after `make build` and the site build:
//   node website/scripts/site-check.mjs [--dist <dir>] [--bin <starboard>]

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { siteVersion } from './version.mjs';

const SITE = 'https://starboard.c65llc.com';
const websiteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(websiteDir, '..');

function parseArgs(argv) {
  let dist = join(websiteDir, 'dist');
  let bin = process.env.STARBOARD_BIN ?? join(repoRoot, 'bin', 'starboard');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dist' && argv[i + 1]) dist = resolve(argv[++i]);
    else if (argv[i] === '--bin' && argv[i + 1]) bin = resolve(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return { dist, bin };
}

const failures = [];
const fail = (msg) => failures.push(msg);
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const isFile = (p) => existsSync(p) && statSync(p).isFile();

function checkSchemas(dist, bin) {
  for (const name of ['config', 'screens']) {
    const source = join(repoRoot, 'internal', 'schema', `${name}.schema.json`);
    const served = join(dist, 'schema', 'v1', `${name}.json`);
    if (!isFile(served)) {
      fail(`missing ${served}: the schema's $id URL would not resolve`);
      continue;
    }
    const want = readFileSync(source);
    const got = readFileSync(served);
    if (!want.equals(got)) fail(`schema/v1/${name}.json differs from internal/schema/${name}.schema.json`);
    const printed = execFileSync(bin, ['schema', name]);
    if (!printed.equals(got)) fail(`schema/v1/${name}.json differs from \`starboard schema ${name}\``);
    const id = JSON.parse(got.toString('utf8')).$id;
    if (id !== `${SITE}/schema/v1/${name}.json`) fail(`schema/v1/${name}.json has $id ${id}, not its own URL`);
  }
}

function checkRules(dist, bin) {
  const out = JSON.parse(execFileSync(bin, ['rules', '--json'], { encoding: 'utf8' }));
  const ids = new Set(out.rules.map((r) => r.id));
  for (const r of out.rules) {
    if (r.docs !== `${SITE}/rules/${r.id}/`) fail(`rule ${r.id}: docs URL ${r.docs} is not ${SITE}/rules/${r.id}/`);
  }
  const rulesDir = join(dist, 'rules');
  const pages = new Set(
    isDir(rulesDir)
      ? readdirSync(rulesDir).filter((d) => isFile(join(rulesDir, d, 'index.html')))
      : [],
  );
  for (const id of ids) if (!pages.has(id)) fail(`rule ${id} has no page at /rules/${id}/`);
  for (const page of pages) if (!ids.has(page)) fail(`/rules/${page}/ is not a rule \`starboard rules\` lists`);
  if (ids.size === 0) fail('`starboard rules --json` listed no rules');
}

function checkExamples(dist) {
  const examples = readdirSync(join(repoRoot, 'examples')).filter((d) =>
    isFile(join(repoRoot, 'examples', d, 'starboard.yaml')),
  );
  if (examples.length === 0) fail('no example projects found under examples/');
  for (const name of examples) {
    if (!isFile(join(dist, 'examples', name, 'index.html'))) fail(`example ${name} has no gallery page at /examples/${name}/`);
    if (!isDir(join(dist, 'examples', name, 'wireframes'))) fail(`example ${name}: /examples/${name}/wireframes/ is missing`);
  }
}

function walkFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function checkApp(dist) {
  const app = join(dist, 'app');
  if (!isFile(join(app, 'index.html'))) fail('the PWA is missing: no /app/index.html');
  if (!isFile(join(app, 'sw.js'))) fail('the PWA has no service worker at /app/sw.js');
  if (existsSync(join(app, '.vite'))) fail('/app/.vite is published: sync-content must leave out web/app/dist/.vite');
  if (isDir(app)) {
    for (const f of walkFiles(app)) if (f.endsWith('.map')) fail(`source map published: ${f.slice(dist.length)}`);
  }
}

const decodeText = (html) => html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function checkVersion(dist) {
  const { version } = siteVersion();
  const released = version !== 'dev';
  const home = readFileSync(join(dist, 'index.html'), 'utf8');
  const label = /<span data-site-version="([^"]*)"[^>]*>([^<]*)<\/span>/.exec(home);
  if (!label) fail('the landing page has no release label (data-site-version)');
  else {
    if (label[1] !== version) fail(`the landing page was built for ${label[1]}, but the version is ${version}`);
    const want = released ? `Early release · ${version}` : 'Development build';
    if (decodeText(label[2]).trim() !== want) fail(`the landing page's release label reads "${label[2]}", not "${want}"`);
  }
  const install = /<code[^>]*data-install[^>]*>([\s\S]*?)<\/code>/.exec(home);
  const goRef = released ? version : 'latest';
  if (!install || !decodeText(install[1]).endsWith(`/cmd/starboard@${goRef}`)) fail(`the landing page's install command does not end in @${goRef}`);
  const snippet = /<code[^>]*data-action-snippet[^>]*>([\s\S]*?)<\/code>/.exec(home);
  const pin = released ? version : 'vX.Y.Z';
  if (!snippet || !decodeText(snippet[1]).includes(`version: ${pin}`)) fail(`the landing page's Action snippet does not pin version: ${pin}`);
  if (released) {
    for (const page of ['getting-started/ci', 'reference/github-action']) {
      const text = decodeText(readFileSync(join(dist, page, 'index.html'), 'utf8'));
      const pins = [...text.matchAll(/version: (v\d+\.\d+\.\d+)/g)].map((m) => m[1]);
      if (pins.length === 0) fail(`/${page}/ pins no Action version`);
      for (const p of pins) if (p !== version) fail(`/${page}/ pins version: ${p}, not ${version}`);
    }
  }
}

function checkHeaders(dist) {
  const path = join(dist, '_headers');
  if (!isFile(path)) {
    fail('dist/_headers is missing');
    return;
  }
  const text = readFileSync(path, 'utf8');
  const rules = new Map();
  let current;
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    if (!/^\s/.test(line)) {
      current = line.trim();
      rules.set(current, []);
    } else if (current) {
      rules.get(current).push(line.trim());
    }
  }
  for (const [pattern, lines] of rules) {
    for (const l of lines) if (l.includes('__CSP_')) fail(`_headers ${pattern}: placeholder left unrendered`);
  }
  const csp = (pattern) => (rules.get(pattern) ?? []).find((l) => l.startsWith('Content-Security-Policy:'));
  const site = csp('/*');
  const app = csp('/app/*');
  if (!site) fail('_headers has no Content-Security-Policy for /*');
  if (!app) fail('_headers has no Content-Security-Policy for /app/*');
  if (app && !/script-src [^;]*'wasm-unsafe-eval'/.test(app)) fail("/app/* CSP lacks 'wasm-unsafe-eval' in script-src");
  if (app && !/worker-src 'self'/.test(app)) fail("/app/* CSP lacks worker-src 'self'");
  if (site && /worker-src/.test(site)) fail('the /* CSP must not carry worker-src: only /app/* runs workers');
  for (const l of [site, app].filter(Boolean)) {
    const scriptSrc = /script-src[^;]*/.exec(l)?.[0] ?? '';
    const styleSrc = /style-src [^;]*/.exec(l)?.[0] ?? '';
    if (/'unsafe-inline'|'unsafe-eval'/.test(scriptSrc + styleSrc)) fail(`CSP relaxed with unsafe-inline/unsafe-eval: ${l}`);
  }
  const wasm = rules.get('/*.wasm') ?? [];
  if (!wasm.includes('Content-Type: application/wasm')) fail('_headers does not serve *.wasm as application/wasm');
}

function main() {
  const { dist, bin } = parseArgs(process.argv.slice(2));
  if (!isDir(dist)) throw new Error(`${dist} does not exist: build the site first (cd website && pnpm build)`);
  if (!isFile(bin)) throw new Error(`${bin} does not exist: run make build first`);
  checkSchemas(dist, bin);
  checkRules(dist, bin);
  checkExamples(dist);
  checkApp(dist);
  checkVersion(dist);
  checkHeaders(dist);
  if (failures.length > 0) {
    console.error(`site-check: ${failures.length} problem(s):\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`site-check: schemas, rule pages, example galleries, /app/, the version (${siteVersion().version}) and _headers all match.`);
}

try {
  main();
} catch (error) {
  console.error(`site-check: ${error.message}`);
  process.exit(1);
}
