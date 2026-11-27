// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
//
// blog-sidebar.mjs — the Blog group's sidebar links, from the posts in
// src/content/docs/blog/ rather than a hand-kept list: "All posts", then
// each post newest first (its front matter date, compared as a date, then
// its title), leaving out drafts (draft: true), which starlight-blog does
// not publish in a build. Front matter is parsed as YAML (the yaml package,
// YAML 1.2 core schema, as starlight-blog's boolean reads it).
// scripts/blog-sidebar.test.mjs tests it; e2e/sidebar.spec.ts checks the
// built sidebar against blogPosts.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

/** A post's slug, title, date and whether it is a draft. */
function readPost(dir, name) {
  const file = join(dir, name);
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(src);
  if (!m) throw new Error(`${file}: a blog post must open with front matter`);
  const fm = parse(m[1]) ?? {};
  const title = typeof fm.title === 'string' ? fm.title.trim() : '';
  const date = fm.date instanceof Date ? fm.date : new Date(String(fm.date ?? ''));
  if (!title) throw new Error(`${file}: a blog post needs a title`);
  if (fm.date === undefined || Number.isNaN(date.getTime())) throw new Error(`${file}: a blog post needs a valid date`);
  return { slug: name.replace(/\.mdx?$/, ''), title, date, draft: fm.draft === true };
}

/** The published posts in dir, newest first, then by title. */
export function blogPosts(dir) {
  return readdirSync(dir)
    .filter((name) => /\.mdx?$/.test(name))
    .map((name) => readPost(dir, name))
    .filter((post) => !post.draft)
    .sort((a, b) => b.date.getTime() - a.date.getTime() || a.title.localeCompare(b.title));
}

/** The Blog group's items for the posts in dir (src/content/docs/blog). */
export function blogSidebar(dir) {
  return [{ label: 'All posts', link: '/blog/' }, ...blogPosts(dir).map((p) => ({ label: p.title, link: `/blog/${p.slug}/` }))];
}
