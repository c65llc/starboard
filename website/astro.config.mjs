// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
//
// starboard.c65llc.com: the landing page (src/pages/index.astro), the docs
// (Starlight, from the repository's docs/ by scripts/sync-content.sh), the
// rule pages, the example galleries, the blog, the community pages and,
// under /app/, the PWA.

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightBlog from 'starlight-blog';

import { blogSidebar } from './scripts/blog-sidebar.mjs';

const site = 'https://starboard.c65llc.com';
const github = 'https://github.com/c65llc/starboard';

export default defineConfig({
  site,
  trailingSlash: 'always',
  build: {
    // Never inline CSS into <style> tags: every stylesheet ships as a file
    // served from 'self', so the CSP style-src needs no per-build hashes.
    inlineStylesheets: 'never',
  },
  // No asset becomes a data: URL (Vite inlines small ones by default): the
  // CSP's font-src 'self' would refuse a font inlined that way.
  vite: { build: { assetsInlineLimit: 0 } },
  integrations: [
    starlight({
      plugins: [
        starlightBlog({
          title: 'Starboard blog',
          navigation: 'none',
          authors: {
            c65: { name: 'C65 LLC', url: 'https://github.com/c65llc' },
          },
        }),
      ],
      title: 'Starboard',
      description:
        "Keep your product's screens and user flows as plain text in your repository: one reference for every platform, checked in CI.",
      logo: { src: './src/assets/starboard-mark.svg', alt: 'Starboard' },
      favicon: '/favicon.svg',
      // The default footer and, under it, the C65 credit (src/components/C65Credit.astro).
      components: { Footer: './src/components/Footer.astro' },
      social: [
        { icon: 'github', label: 'GitHub', href: github },
        { icon: 'rss', label: 'RSS feed', href: `${site}/blog/rss.xml` },
      ],
      // Pages that live in website/ (the blog) edit in place; sync-content.sh
      // gives every page synced from docs/ an editUrl of its own.
      editLink: { baseUrl: `${github}/edit/main/website/` },
      lastUpdated: false,
      defaultLocale: 'root',
      locales: { root: { label: 'English', lang: 'en' } },
      customCss: [
        '@fontsource-variable/inter/wght.css',
        '@fontsource-variable/jetbrains-mono/wght.css',
        './src/styles/starlight.css',
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: ['getting-started/install', 'getting-started/first-project', 'getting-started/ci'],
        },
        { label: 'Concepts', items: [{ autogenerate: { directory: 'concepts' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
        { label: 'Rules', collapsed: true, items: [{ autogenerate: { directory: 'rules' } }] },
        // Every page of docs/guides/ is listed, the VS Code extension's included (guides/vscode).
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Examples', items: [{ autogenerate: { directory: 'examples' } }] },
        // Every post under src/content/docs/blog/, newest first.
        { label: 'Blog', items: blogSidebar(fileURLToPath(new URL('./src/content/docs/blog/', import.meta.url))) },
        // Synced from the repository's CONTRIBUTING.md, SECURITY.md and CODE_OF_CONDUCT.md.
        { label: 'Community', items: ['contributing', 'security', 'code-of-conduct'] },
        { label: 'More', items: [{ label: 'Web app', link: '/app/' }, 'agpl'] },
      ],
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: `${site}/og-image.png` } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
      ],
    }),
  ],
});
