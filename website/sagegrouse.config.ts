// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

import { defineConfig, z } from '@sagegrouse/core';
import { z as astroZod } from 'astro/zod';

export const landingLocation = 'content/site';
const landingText = astroZod.string().trim().min(1);
export const landingSchema = astroZod.object({
  title: landingText,
  description: landingText,
  hero: astroZod.object({
    heading: landingText,
    lede: landingText,
    body: landingText,
    desktopAlt: landingText,
    tabletAlt: landingText,
    phoneAlt: landingText,
  }),
  features: astroZod.object({ heading: landingText, lede: landingText }),
  workflow: astroZod.object({ heading: landingText }),
  platforms: astroZod.object({ heading: landingText }),
});

// Astro uses Zod 4 and Sagegrouse 0.1 uses Zod 3. Validate the same
// homepage fields in both tools and keep Sagegrouse's field-level diagnostics.
const landingCheck = z.unknown().superRefine((value, context) => {
  const result = landingSchema.safeParse(value);
  if (!result.success) {
    for (const issue of result.error.issues) {
      context.addIssue({ code: 'custom', path: issue.path.map(String), message: issue.message });
    }
  }
});

const text = z.string().trim().min(1);
const docsLocation = 'src/content/docs';
const docSections = ['getting-started', 'concepts', 'reference', 'guides', 'rules', 'examples'];
const docSchema = z.object({ title: text, description: text.optional() });
const docTypes = Object.fromEntries(docSections.map((section) => [
  section,
  { stages: [], location: `${docsLocation}/${section}`, schema: docSchema },
]));

export default defineConfig({
  contentRoot: 'content',
  contentTypes: {
    site: { stages: [], location: landingLocation, schema: landingCheck },
    ...docTypes,
    community: { stages: [], location: docsLocation, schema: docSchema },
    blog: {
      stages: [],
      location: `${docsLocation}/blog`,
      schema: docSchema.extend({ date: z.union([text, z.date()]).pipe(z.coerce.date()) }),
    },
  },
  adapters: [],
});
