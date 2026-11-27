// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
//
// blog-sidebar.mjs — the Blog group's sidebar links, from the posts in
// src/content/docs/blog/ rather than a hand-kept list: "All posts", then
// each post newest first (its front matter date, then its title), leaving
// out drafts, which starlight-blog does not publish in a build.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The front matter fields a post's sidebar link needs. */
function frontMatter(file) {
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  if (!m) throw new Error(`${file}: a blog post must open with front matter`);
  const field = (name) => {
    const f = new RegExp(`^${name}:[ \\t]*(.*)$`, 'm').exec(m[1]);
    return f ? f[1].trim().replace(/^(["'])(.*)\1$/, '$2') : undefined;
  };
  const title = field('title');
  const date = field('date');
  if (!title || !date) throw new Error(`${file}: a blog post needs a title and a date`);
  return { title, date, draft: field('draft') === 'true' };
}

/** The Blog group's items for the posts in dir (src/content/docs/blog). */
export function blogSidebar(dir) {
  const posts = readdirSync(dir)
    .filter((name) => /\.mdx?$/.test(name))
    .map((name) => ({ slug: name.replace(/\.mdx?$/, ''), ...frontMatter(join(dir, name)) }))
    .filter((post) => !post.draft)
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  return [{ label: 'All posts', link: '/blog/' }, ...posts.map((p) => ({ label: p.title, link: `/blog/${p.slug}/` }))];
}
