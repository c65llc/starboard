#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
//
// A static server for website/dist that sends the headers dist/_headers
// gives, as Cloudflare Pages does, so the e2e tests run the site under its
// real Content-Security-Policy:
//   - a rule's URL pattern may hold one splat (*), which matches anything;
//   - every rule whose pattern matches applies, in file order, and a header
//     set by two rules is sent once with the values joined by ", " (for a
//     CSP that is two policies, both enforced); "! Name" removes a header
//     set by an earlier rule;
//   - a path ending in / serves its index.html, and a missing file the
//     site's 404.html with status 404.
//
// One addition for the tests only: GET /__test/bump-sw makes every later
// response for /app/sw.js end with a fresh comment, so the browser sees a
// new service worker, as after a deploy (e2e/site-app.spec.ts).
//
// Usage: node e2e/server.mjs [--port 4321] [--dist dist]

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
let port = 4321;
let dist = join(websiteDir, 'dist');
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--port') port = Number(argv[++i]);
  else if (argv[i] === '--dist') dist = resolve(argv[++i]);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

/** The rules of dist/_headers: [{ pattern: RegExp, set: [[name, value]], detach: [name] }]. */
function readRules() {
  const rules = [];
  let current;
  for (const line of readFileSync(join(dist, '_headers'), 'utf8').split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const glob = line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '.*');
      current = { pattern: new RegExp(`^${glob}$`), set: [], detach: [] };
      rules.push(current);
    } else if (current) {
      const t = line.trim();
      if (t.startsWith('!')) current.detach.push(t.slice(1).trim().toLowerCase());
      else {
        const at = t.indexOf(':');
        current.set.push([t.slice(0, at).trim(), t.slice(at + 1).trim()]);
      }
    }
  }
  return rules;
}

const rules = readRules();

function headersFor(pathname) {
  const out = new Map();
  for (const rule of rules) {
    if (!rule.pattern.test(pathname)) continue;
    for (const name of rule.detach) out.delete(name);
    for (const [name, value] of rule.set) {
      const key = name.toLowerCase();
      const prev = out.get(key);
      out.set(key, prev ? [prev[0], `${prev[1]}, ${value}`] : [name, value]);
    }
  }
  return [...out.values()];
}

let swBump = 0;

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (url.pathname === '/__test/bump-sw') {
    swBump += 1;
    res.writeHead(204).end();
    return;
  }
  let pathname = decodeURIComponent(url.pathname);
  let file = join(dist, pathname);
  if (!file.startsWith(dist)) {
    res.writeHead(400).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!pathname.endsWith('/')) {
      res.writeHead(308, { Location: `${pathname}/${url.search}` }).end();
      return;
    }
    file = join(file, 'index.html');
  }
  let status = 200;
  if (!existsSync(file)) {
    status = 404;
    file = join(dist, '404.html');
    pathname = '/404.html';
  }
  let body = readFileSync(file);
  if (url.pathname === '/app/sw.js' && swBump > 0) body = Buffer.concat([body, Buffer.from(`\n// bump ${swBump}\n`)]);
  const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' };
  for (const [name, value] of headersFor(url.pathname)) headers[name] = value;
  res.writeHead(status, headers).end(body);
}).listen(port, () => console.log(`serving ${dist} on http://localhost:${port}/`));
