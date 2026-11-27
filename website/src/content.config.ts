// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The docs collection: Starlight's pages (synced from docs/ and the example
// galleries) and the blog's posts, whose front matter starlight-blog extends.

import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { blogSchema } from "starlight-blog/schema";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({ extend: (context) => blogSchema(context) }),
  }),
};
