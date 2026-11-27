#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
//
// build-gallery.mjs — one gallery page per example project, built only from
// what Starboard wrote or reads, never by hand:
//
//   - the screen catalog is examples/<name>/docs/flows/generated/screens.md
//     (`starboard generate`), its wireframe images pointed at
//     /examples/<name>/wireframes/ (sync-content.sh copies them there), its
//     source-file links at the files on GitHub, its flow links at the flows
//     on the same page;
//   - each flow is examples/<name>/docs/flows/flows/<id>.md: its goal, its
//     steps, and its Mermaid diagram drawn to an SVG file;
//   - the app map is generated/app-map.md's Mermaid diagram, drawn the same way.
//
// Mermaid needs a browser to lay out text, so the diagrams are drawn in
// Playwright's Chromium (`pnpm exec playwright install chromium`) and then
// flattened: every computed style becomes a presentation attribute and the
// <style> element goes, so the SVG needs no CSS and no CSP allowance.
//
// Writes src/content/docs/examples/<name>.md and
// public/examples/<name>/{app-map.svg,flows/<id>.svg}.
//
// Usage: node scripts/build-gallery.mjs

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const websiteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(websiteDir, '..');
const REPO_BLOB = 'https://github.com/c65llc/starboard/blob/main';
const REPO_TREE = 'https://github.com/c65llc/starboard/tree/main';
const require = createRequire(import.meta.url);

// The brand palette (docs/brand/README.md) for Mermaid's base theme.
const THEME = {
  background: '#FFFFFF',
  primaryColor: '#F5F7F8',
  primaryBorderColor: '#426479',
  primaryTextColor: '#101E30',
  secondaryColor: '#C1F5E8',
  tertiaryColor: '#FFFFFF',
  lineColor: '#426479',
  textColor: '#101E30',
  clusterBkg: '#EEF3F5',
  clusterBorder: '#9FB2BF',
  edgeLabelBackground: '#FFFFFF',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontSize: '14px',
};

/** Front matter (flat key: value lines) and body of a Markdown file. */
function splitFrontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

/** The first ```mermaid block of text, and the text before and after it. */
function splitMermaid(text) {
  const m = /```mermaid\n([\s\S]*?)\n```\n?/.exec(text);
  if (!m) return { before: text, source: undefined, after: '' };
  return { before: text.slice(0, m.index), source: m[1], after: text.slice(m.index + m[0].length) };
}

/** Shifts every ATX heading down by n levels (to at most h6). */
const demote = (md, n) => md.replace(/^(#{1,6}) /gm, (_, h) => `${'#'.repeat(Math.min(6, h.length + n))} `);

/** Wraps each @screen or @screen#region reference in code, as the PWA shows it. */
const codeRefs = (md) =>
  md.replace(/(^|[^`\w])@([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?:#[a-z0-9][a-z0-9-]*)?)/g, '$1`@$2`');

/** The first paragraph of the example's README, joined into one line. */
function readmeIntro(dir) {
  const path = join(dir, 'README.md');
  if (!existsSync(path)) return '';
  const paras = readFileSync(path, 'utf8').split(/\n\s*\n/).map((p) => p.trim());
  const first = paras.find((p) => p && !p.startsWith('#'));
  if (!first) return '';
  // A paragraph that introduces a list ("… It shows:") keeps only its sentences before that.
  const text = first.replace(/\s*\n\s*/g, ' ');
  return text.endsWith(':') ? text.replace(/\s*[^.]*:$/, '') : text;
}

const yamlString = (s) => JSON.stringify(s);

/** Renders Mermaid sources to flattened, CSS-free SVG strings. */
async function makeRenderer() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  await page.addScriptTag({ path: require.resolve('mermaid/dist/mermaid.min.js') });
  await page.evaluate((themeVariables) => {
    // @ts-ignore: the UMD build's global
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables,
      htmlLabels: false,
      flowchart: { htmlLabels: false, wrappingWidth: 400, useMaxWidth: false },
      layout: 'dagre',
      fontFamily: themeVariables.fontFamily,
    });
  }, THEME);
  let n = 0;
  return {
    async render(source) {
      n += 1;
      return page.evaluate(
        async ({ source, id, background }) => {
          // @ts-ignore: the UMD build's global
          const { svg } = await window.mermaid.render(id, source);
          const host = document.createElement('div');
          host.innerHTML = svg;
          document.body.append(host);
          const root = host.querySelector('svg');
          const props = [
            'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
            'stroke-linejoin', 'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-weight',
            'font-style', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'visibility',
          ];
          const drawn = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'g', 'marker'];
          for (const el of root.querySelectorAll('*')) {
            if (!drawn.includes(el.localName)) continue;
            const cs = getComputedStyle(el);
            for (const p of props) {
              const v = cs.getPropertyValue(p);
              if (v && v !== 'normal' && v !== 'auto') el.setAttribute(p, v);
            }
            if (cs.display === 'none') el.setAttribute('display', 'none');
          }
          for (const s of root.querySelectorAll('style')) s.remove();
          for (const el of [root, ...root.querySelectorAll('[style]')]) el.removeAttribute('style');
          // A white card behind the drawing, so it reads on the dark theme too.
          const vb = root.viewBox.baseVal;
          const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          for (const [k, v] of Object.entries({ x: vb.x, y: vb.y, width: vb.width, height: vb.height, fill: background })) bg.setAttribute(k, String(v));
          root.insertBefore(bg, root.firstChild);
          root.setAttribute('width', String(Math.ceil(vb.width)));
          root.setAttribute('height', String(Math.ceil(vb.height)));
          for (const a of ['aria-roledescription', 'role', 'aria-labelledby', 'aria-describedby', 'class']) root.removeAttribute(a);
          const out = new XMLSerializer().serializeToString(root);
          host.remove();
          return out;
        },
        { source, id: `sb-diagram-${n}`, background: THEME.background },
      );
    },
    close: () => browser.close(),
  };
}

function rewriteCatalog(md, name, generatedDir) {
  let out = md.replace(/^<!--[\s\S]*?-->\n*/, '').replace(/^# Screens\n+/, '');
  out = out.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
    if (/^[a-z]+:/.test(target) || target.startsWith('#')) return whole;
    if (target.startsWith('wireframes/')) return `](/examples/${name}/${target})`;
    const flow = /^\.\.\/flows\/([^/]+)\.md$/.exec(target);
    if (flow) return `](#flow-${flow[1]})`;
    const repoPath = relative(repoRoot, resolve(generatedDir, target)).split('\\').join('/');
    return `](${REPO_BLOB}/${repoPath})`;
  });
  return demote(out, 1);
}

async function buildExample(name, renderer) {
  const dir = join(repoRoot, 'examples', name);
  const content = join(dir, 'docs', 'flows');
  const generated = join(content, 'generated');
  const publicDir = join(websiteDir, 'public', 'examples', name);
  mkdirSync(join(publicDir, 'flows'), { recursive: true });

  const intro = readmeIntro(dir);
  const parts = [];
  parts.push('---');
  parts.push(`title: ${yamlString(name)}`);
  parts.push(`description: ${yamlString(`The ${name} example project: its app map, flows and screen wireframes, as Starboard generates them.`)}`);
  parts.push('---');
  parts.push('');
  if (intro) parts.push(intro, '');
  parts.push(
    `Everything on this page is Starboard's own output for [examples/${name}](${REPO_TREE}/examples/${name}): ` +
      '`starboard generate` drew the wireframes and wrote the screen catalog, and the diagrams are the ' +
      "project's Mermaid sources, drawn. The wireframes are grey boxes by design: they show each screen's " +
      'regions and their order, not a visual design.',
    '',
  );

  // The app map.
  const appMap = splitMermaid(readFileSync(join(generated, 'app-map.md'), 'utf8'));
  if (appMap.source) {
    writeFileSync(join(publicDir, 'app-map.svg'), await renderer.render(appMap.source));
    parts.push('## App map', '');
    parts.push(
      `Every screen, grouped by area, with the links between them (from \`generated/app-map.md\`). The screen catalog below lists each screen's links in words.`,
      '',
    );
    parts.push(`[![The ${name} app map: every screen grouped by area, with the links between them](/examples/${name}/app-map.svg)](/examples/${name}/app-map.svg)`, '');
  }

  // The flows, in file order.
  const flowsDir = join(content, 'flows');
  const flowFiles = existsSync(flowsDir) ? readdirSync(flowsDir).filter((f) => f.endsWith('.md')).sort() : [];
  if (flowFiles.length > 0) parts.push('## Flows', '');
  for (const file of flowFiles) {
    const { meta, body } = splitFrontMatter(readFileSync(join(flowsDir, file), 'utf8'));
    const id = meta.id ?? file.replace(/\.md$/, '');
    const title = meta.title ?? id;
    const { before, source, after } = splitMermaid(body);
    parts.push(`<h3 id="flow-${id}">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h3>`, '');
    const facts = [`\`${id}\``, meta.status && `status: ${meta.status}`, meta.entry && `starts at \`${meta.entry}\``, meta.platforms && `platforms: ${meta.platforms.replace(/[[\]]/g, '')}`]
      .filter(Boolean)
      .join(' · ');
    parts.push(facts, '');
    if (before.trim()) parts.push(codeRefs(before.trim()), '');
    if (source) {
      const svgPath = `/examples/${name}/flows/${id}.svg`;
      writeFileSync(join(websiteDir, 'public', svgPath), await renderer.render(source));
      parts.push(`![Diagram of the flow “${title}”; its steps are listed below it](${svgPath})`, '');
    }
    if (after.trim()) parts.push(demote(codeRefs(after.trim()), 2), '');
    parts.push(`[The flow's source](${REPO_BLOB}/${posix.join('examples', name, 'docs/flows/flows', file)})`, '');
  }

  // The screen catalog.
  parts.push('## Screens', '');
  parts.push(
    `The catalog \`starboard generate\` writes to \`generated/screens.md\`, with a wireframe for each form factor a screen is on.`,
    '',
  );
  parts.push(rewriteCatalog(readFileSync(join(generated, 'screens.md'), 'utf8'), name, generated));

  const outDir = join(websiteDir, 'src', 'content', 'docs', 'examples');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}.md`), parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');
  return flowFiles.length;
}

async function main() {
  const examples = readdirSync(join(repoRoot, 'examples'))
    .filter((d) => existsSync(join(repoRoot, 'examples', d, 'starboard.yaml')))
    .sort();
  const renderer = await makeRenderer();
  try {
    for (const name of examples) {
      const flows = await buildExample(name, renderer);
      console.log(`[build-gallery] ${name}: ${flows} flow diagram(s), the app map and the screen catalog`);
    }
  } finally {
    await renderer.close();
  }
}

main().catch((error) => {
  console.error(`[build-gallery] ${error.stack ?? error}`);
  process.exit(1);
});
