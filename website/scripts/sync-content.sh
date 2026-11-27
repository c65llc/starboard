#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026 C65 LLC
#
# sync-content.sh — copy what the site publishes from the repository into
# website/ before every build (prebuild) and dev server (predev). Nothing it
# writes is committed (.gitignore); the repository's own files are the only
# source:
#
#   docs/{getting-started,concepts,reference,guides,rules}
#                       -> src/content/docs/<section>/  (reference/kinds/*.yaml
#                          stay behind: only the pictures they render are shown)
#   examples/<name>/docs/flows/generated/
#                       -> public/examples/<name>/wireframes/ (the generated
#                          Markdown becomes the gallery page instead:
#                          src/content/docs/examples/<name>.md, by build-gallery.mjs)
#   internal/schema/<name>.schema.json
#                       -> public/schema/v1/<name>.json, byte for byte (the
#                          schemas' $id URLs point there)
#   web/app/dist        -> public/app/, without dist/.vite (Vite's build
#                          metadata), when the PWA has been built
#   LICENSE             -> src/content/docs/agpl.md (the license page), after the explainer in
#                          src/agpl.md
#   docs/brand/starboard-{favicon,mark}.svg -> public/, and the mark to
#                          src/assets/ for Starlight's logo
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEBSITE_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$WEBSITE_DIR")"
CONTENT_DIR="$WEBSITE_DIR/src/content/docs"
PUBLIC_DIR="$WEBSITE_DIR/public"

echo "[sync-content] syncing docs, examples, schemas, the PWA and the license"

# Docs sections.
for section in getting-started concepts reference guides rules; do
	rm -rf "${CONTENT_DIR:?}/$section"
	cp -R "$REPO_ROOT/docs/$section" "$CONTENT_DIR/$section"
done
rm -f "$CONTENT_DIR"/reference/kinds/*.yaml

# Brand assets.
cp "$REPO_ROOT/docs/brand/starboard-favicon.svg" "$PUBLIC_DIR/favicon.svg"
cp "$REPO_ROOT/docs/brand/starboard-mark.svg" "$PUBLIC_DIR/starboard-mark.svg"
mkdir -p "$WEBSITE_DIR/src/assets"
cp "$REPO_ROOT/docs/brand/starboard-mark.svg" "$WEBSITE_DIR/src/assets/starboard-mark.svg"

# JSON Schemas, byte for byte.
rm -rf "$PUBLIC_DIR/schema"
mkdir -p "$PUBLIC_DIR/schema/v1"
for name in config screens; do
	cp "$REPO_ROOT/internal/schema/$name.schema.json" "$PUBLIC_DIR/schema/v1/$name.json"
done

# Example projects: the generated pages' assets, then the gallery pages.
rm -rf "$PUBLIC_DIR/examples" "$CONTENT_DIR/examples"
for dir in "$REPO_ROOT"/examples/*/; do
	name="$(basename "$dir")"
	[ -f "$dir/starboard.yaml" ] || continue
	mkdir -p "$PUBLIC_DIR/examples/$name"
	cp -R "$dir/docs/flows/generated/wireframes" "$PUBLIC_DIR/examples/$name/wireframes"
done
node "$SCRIPT_DIR/build-gallery.mjs"

# The PWA, served from /app/.
rm -rf "$PUBLIC_DIR/app"
if [ -d "$REPO_ROOT/web/app/dist" ]; then
	cp -R "$REPO_ROOT/web/app/dist" "$PUBLIC_DIR/app"
	rm -rf "$PUBLIC_DIR/app/.vite"
else
	echo "[sync-content] web/app/dist is missing: /app/ will not be published (make wasm, then cd web && pnpm build)" >&2
fi

# The license page: the explainer, then the license text.
{
	cat "$WEBSITE_DIR/src/agpl.md"
	echo
	echo '## The license text'
	echo
	echo 'This is the [LICENSE](https://github.com/c65llc/starboard/blob/main/LICENSE) file in the repository, unchanged.'
	echo
	echo '```text'
	cat "$REPO_ROOT/LICENSE"
	echo '```'
} > "$CONTENT_DIR/agpl.md"

echo "[sync-content] done"
