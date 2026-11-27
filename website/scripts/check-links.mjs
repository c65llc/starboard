#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
//
// check-links.mjs — every internal link and image in the built site
// resolves. It reads each HTML page under website/dist and checks every
// href, src and srcset that points into the site (a relative or root path,
// or an absolute https://starboard.c65llc.com URL): the target must be a
// file in dist (a path ending in / is its index.html), and a #fragment on a
// page must name an id on that page. CSS files' url() references are
// checked the same way. A link into this repository on GitHub
// (https://github.com/c65llc/starboard/{blob,edit,tree}/main/<path>: the
// "Edit page" links, source files, flows) must name a file or directory
// that exists in the checkout; a broken "Edit page" link (an edit/ URL) is
// reported as the page's editUrl front matter, where it comes from. Other
// external links are counted, never fetched.
//
// Usage: node website/scripts/check-links.mjs [--dist <dir>]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ORIGIN = 'https://starboard.c65llc.com';
const REPO_LINK = /^https:\/\/github\.com\/c65llc\/starboard\/(blob|edit|tree)\/main\/([^?#]+)/;
const websiteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(websiteDir, '..');

function parseArgs(argv) {
  let dist = join(websiteDir, 'dist');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dist' && argv[i + 1]) dist = resolve(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return { dist };
}

function walk(dir, ext, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (w, b) =>
    b[0] === '#' ? String.fromCodePoint(b[1].toLowerCase() === 'x' ? parseInt(b.slice(2), 16) : parseInt(b.slice(1), 10)) : (NAMED[b.toLowerCase()] ?? w),
  );

/** The URL path a file in dist is served at: dist/a/index.html -> /a/. */
function urlPathOf(dist, file) {
  const rel = relative(dist, file).split(sep).join('/');
  return '/' + rel.replace(/(^|\/)index\.html$/, '$1');
}

/** The file a URL path names, or undefined. */
function fileFor(dist, pathname) {
  let p;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const full = join(dist, p);
  if (!full.startsWith(dist)) return undefined;
  if (p.endsWith('/')) return existsSync(join(full, 'index.html')) ? join(full, 'index.html') : undefined;
  if (existsSync(full) && statSync(full).isFile()) return full;
  return undefined;
}

/** The internal URL a reference names, or null for an external one. */
function internalUrl(ref, base) {
  const r = ref.trim();
  if (r === '' || r.startsWith('data:') || r.startsWith('mailto:') || r.startsWith('tel:') || r.startsWith('javascript:')) return null;
  let url;
  try {
    url = new URL(r, `${SITE_ORIGIN}${base}`);
  } catch {
    return undefined; // malformed: reported
  }
  if (url.origin !== SITE_ORIGIN) return null;
  return url;
}

const idCache = new Map();
function idsOf(file) {
  if (!idCache.has(file)) {
    const html = readFileSync(file, 'utf8');
    const ids = new Set();
    for (const m of html.matchAll(/\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) ids.add(decode(m[1] ?? m[2]));
    idCache.set(file, ids);
  }
  return idCache.get(file);
}

function main() {
  const { dist } = parseArgs(process.argv.slice(2));
  if (!existsSync(dist)) throw new Error(`${dist} does not exist: build the site first`);
  const problems = [];
  let checked = 0;
  let external = 0;
  let repo = 0;

  const check = (from, ref, base, wantHtmlFragment) => {
    const gh = REPO_LINK.exec(ref.trim());
    if (gh) {
      repo += 1;
      let rel;
      try {
        rel = decodeURIComponent(gh[2]).replace(/\/$/, '');
      } catch {
        rel = gh[2];
      }
      const target = join(repoRoot, rel);
      const ok = target.startsWith(repoRoot) && existsSync(target) && (gh[1] === 'tree' || statSync(target).isFile());
      if (!ok && gh[1] === 'edit') {
        // Starlight's "Edit page" link: a synced page's editUrl front matter
        // (sync-content.sh writes it), else editLink.baseUrl plus its path.
        problems.push(
          `${from}: the "Edit page" link names ${rel}, which is not a file in the repository: ` +
            "fix the page's editUrl front matter (sync-content.sh sets it for pages synced from docs/; " +
            "other pages get editLink.baseUrl in astro.config.mjs plus their path)",
        );
      } else if (!ok) {
        problems.push(`${from}: ${ref} names ${rel}, which is not a ${gh[1] === 'tree' ? 'path' : 'file'} in the repository`);
      }
      return;
    }
    const url = internalUrl(ref, base);
    if (url === null) {
      external += 1;
      return;
    }
    checked += 1;
    if (url === undefined) {
      problems.push(`${from}: malformed URL ${ref}`);
      return;
    }
    const target = fileFor(dist, url.pathname);
    if (!target) {
      problems.push(`${from}: ${ref} -> ${url.pathname} does not exist`);
      return;
    }
    const fragment = url.hash.slice(1);
    if (wantHtmlFragment && fragment && target.endsWith('.html')) {
      let id;
      try {
        id = decodeURIComponent(fragment);
      } catch {
        id = fragment;
      }
      if (!idsOf(target).has(id)) problems.push(`${from}: ${ref} -> no id "${id}" on ${url.pathname}`);
    }
  };

  for (const file of walk(dist, '.html')) {
    const html = readFileSync(file, 'utf8');
    const base = urlPathOf(dist, file);
    const from = relative(dist, file);
    for (const m of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
      const [, tag, attrs] = m;
      // <link rel="preconnect|dns-prefetch"> name origins, not resources.
      if (tag.toLowerCase() === 'link' && /\srel\s*=\s*["']?(preconnect|dns-prefetch)/i.test(attrs)) continue;
      // 404.html is served at whatever path was not found, so its canonical URL names no file.
      if (from === '404.html' && tag.toLowerCase() === 'link' && /\srel\s*=\s*["']?canonical/i.test(attrs)) continue;
      for (const a of attrs.matchAll(/\s(href|src|srcset|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
        const name = a[1].toLowerCase();
        if (name === 'data' && tag.toLowerCase() !== 'object') continue;
        const value = decode(a[2] ?? a[3]);
        if (name === 'srcset') {
          for (const part of value.split(',')) {
            const u = part.trim().split(/\s+/)[0];
            if (u) check(from, u, base, false);
          }
        } else {
          check(from, value, base, name === 'href');
        }
      }
    }
  }

  for (const file of walk(dist, '.css')) {
    const css = readFileSync(file, 'utf8');
    const base = urlPathOf(dist, file);
    const from = relative(dist, file);
    for (const m of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g)) {
      const ref = m[1] ?? m[2] ?? m[3];
      if (ref.startsWith('#')) continue;
      check(from, ref, base, false);
    }
  }

  if (problems.length > 0) {
    console.error(`check-links: ${problems.length} broken internal link(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(
    `check-links: ${checked} internal link(s) resolve; ${repo} link(s) into the repository name files that exist; ` +
      `${external} other external link(s) not fetched.`,
  );
}

try {
  main();
} catch (error) {
  console.error(`check-links: ${error.message}`);
  process.exit(1);
}
