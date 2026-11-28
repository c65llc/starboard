// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
//
// Unit tests for blog-sidebar.mjs, over a temporary blog directory:
// node --test scripts/blog-sidebar.test.mjs (pnpm test:unit).

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { blogPosts, blogSidebar } from './blog-sidebar.mjs';

function blog(files) {
  const dir = mkdtempSync(join(tmpdir(), 'blog-sidebar-'));
  for (const [name, text] of Object.entries(files)) {
    const file = join(dir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return dir;
}

const post = (front) => `---\n${front}\n---\n\nBody.\n`;

test('posts are newest first by date, then by title, drafts left out', (t) => {
  const dir = blog({
    'old.md': post('title: Old\ndate: 2026-01-05'),
    'new.md': post('title: New\ndate: 2026-11-27'),
    'b-same.md': post('title: B same day\ndate: 2026-06-01'),
    'a-same.mdx': post('title: A same day\ndate: 2026-06-01'),
    // Not a lexical date: it sorts as a date.
    'time.md': post('title: With a time\ndate: 2026-06-01T23:00:00Z'),
    'draft.md': post('title: Draft\ndate: 2026-12-01\ndraft: true'),
    'draft-comment.md': post('title: Draft too\ndate: 2026-12-02\ndraft: true # not yet'),
    'draft-caps.md': post('title: Draft caps\ndate: 2026-12-03\ndraft: True'),
    'not-draft.md': post('title: Published\ndate: 2025-12-31\ndraft: false'),
    'notes.txt': 'not a post',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(
    blogPosts(dir).map((p) => p.slug),
    ['new', 'time', 'a-same', 'b-same', 'old', 'not-draft'],
  );
});

test('titles are read as YAML, folded and quoted ones included', (t) => {
  const dir = blog({
    'folded.md': post('title: >\n  A folded\n  title\ndate: 2026-02-01'),
    'quoted.md': post('title: "Colons: fine"\ndate: 2026-01-01'),
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(blogSidebar(dir), [
    { label: 'All posts', link: '/blog/' },
    { label: 'A folded title', link: '/blog/folded/' },
    { label: 'Colons: fine', link: '/blog/quoted/' },
  ]);
});

test('a post without front matter, a title or a valid date is refused', (t) => {
  for (const [name, text] of [
    ['bare.md', 'No front matter.\n'],
    ['untitled.md', post('date: 2026-01-01')],
    ['undated.md', post('title: Undated')],
    ['bad-date.md', post('title: Bad\ndate: someday')],
  ]) {
    const dir = blog({ [name]: text });
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    assert.throws(() => blogPosts(dir), new RegExp(name.replace('.', '\\.')));
  }
});

test('Sagegrouse posts use the folder name for the public slug', (t) => {
  const dir = blog({
    'published/index.md': post('title: Published\ndate: 2026-11-27'),
    'draft/index.md': post('title: Draft\ndate: 2026-11-28\ndraft: true'),
    'published/notes.md': 'An asset, not a post.',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(blogSidebar(dir), [
    { label: 'All posts', link: '/blog/' },
    { label: 'Published', link: '/blog/published/' },
  ]);
});
