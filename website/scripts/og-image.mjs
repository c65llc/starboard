#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
//
// og-image.mjs — draw public/og-image.png (1200x630), the social preview:
// the brand mark (docs/brand/starboard-mark.svg) and the positioning line on
// Midnight. Run by hand after a brand change; the PNG is committed.
//
// Usage: node scripts/og-image.mjs

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const websiteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mark = readFileSync(join(websiteDir, '..', 'docs', 'brand', 'starboard-mark.svg'), 'utf8')
  .replace('<svg ', '<svg x="96" y="200" width="230" height="230" ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#101E30"/>
${mark}
<text x="380" y="300" font-family="Inter, Helvetica, Arial, sans-serif" font-size="92" font-weight="600" letter-spacing="-4" fill="#F5F7F8">starboard</text>
<text x="384" y="380" font-family="Inter, Helvetica, Arial, sans-serif" font-size="44" font-weight="500" fill="#68DBC6">One reference. Every platform.</text>
<path d="M0 560c160-20 300 14 470 4s300-34 470-16 170 22 260 10v72H0Z" fill="#14324A"/>
<path d="M0 596c200-12 400 8 600 4s380-18 600-6v36H0Z" fill="#0D5C5A"/>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(join(websiteDir, 'public', 'og-image.png'));
console.log('[og-image] wrote public/og-image.png');
