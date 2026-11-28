// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The docs collection: Starlight's pages (synced from docs/ and the example
// galleries) and the blog's posts, whose front matter starlight-blog extends.

import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { landingLocation, landingSchema } from "../sagegrouse.config";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { blogSchema } from "starlight-blog/schema";

export const collections = {
  site: defineCollection({
    loader: glob({ base: landingLocation, pattern: "*/index.md" }),
    schema: landingSchema,
  }),
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({ extend: (context) => blogSchema(context) }),
  }),
};
