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
#                          src/content/docs/examples/<name>/index.md, by build-gallery.mjs)
#   internal/schema/<name>.schema.json
#                       -> public/schema/v1/<name>.json, byte for byte (the
#                          schemas' $id URLs point there)
#   web/app/dist        -> public/app/, without dist/.vite (Vite's build
#                          metadata) or source maps, when the PWA has been built
#   CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md
#                       -> src/content/docs/{contributing,security,code-of-conduct}/index.md,
#                          their # title moved into front matter
#   LICENSE             -> src/content/docs/agpl/index.md (the license page), after the explainer in
#                          src/agpl.md
#   docs/brand/starboard-{favicon,mark}.svg -> public/, and the mark to
#                          src/assets/ for Starlight's logo
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEBSITE_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$WEBSITE_DIR")"
CONTENT_DIR="$WEBSITE_DIR/src/content/docs"
PUBLIC_DIR="$WEBSITE_DIR/public"

echo "[sync-content] syncing docs, examples, schemas, the PWA, the community pages and the license"

# The one version the site shows (scripts/version.mjs): STARBOARD_VERSION,
# else the newest release tag, else "dev". It writes src/generated/version.json
# for the landing page.
VERSION="$(node "$SCRIPT_DIR/version.mjs" --write)"
echo "[sync-content] version: $VERSION"

# Docs sections.
for section in getting-started concepts reference guides rules; do
	rm -rf "${CONTENT_DIR:?}/$section"
	cp -R "$REPO_ROOT/docs/$section" "$CONTENT_DIR/$section"
done
rm -f "$CONTENT_DIR"/reference/kinds/*.yaml

# Each synced page's "Edit page" link opens its source under docs/ (Starlight's
# editLink.baseUrl points into website/, where only the blog lives), and every
# pinned `version: vX.Y.Z` (the Action snippets) names the release the site
# was built for. docs/ itself keeps its own pins, which its tests run.
while IFS= read -r -d '' page; do
	rel="${page#"$CONTENT_DIR"/}"
	EDIT_URL="https://github.com/c65llc/starboard/edit/main/docs/$rel" perl -0pi -e 's/\A---\n/---\neditUrl: $ENV{EDIT_URL}\n/ unless /\A---\n(?:(?!---\n).*\n)*?editUrl:/' "$page"
	if [ "$VERSION" != dev ]; then
		SB_VERSION="$VERSION" perl -pi -e 's/(\bversion: )v\d+\.\d+\.\d+\b/$1$ENV{SB_VERSION}/g' "$page"
	fi
	# The pictures stay under reference/kinds when this page moves down one level.
	if [ "$rel" = reference/screens-yaml.md ]; then
		perl -pi -e 's|\]\(\./kinds/|](../kinds/|g' "$page"
	fi
	mkdir -p "${page%.md}"
	mv "$page" "${page%.md}/index.md"
done < <(find "$CONTENT_DIR/getting-started" "$CONTENT_DIR/concepts" "$CONTENT_DIR/reference" "$CONTENT_DIR/guides" "$CONTENT_DIR/rules" -maxdepth 1 -name '*.md' -print0)

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
	# Source maps are for debugging a local build, not for publishing.
	find "$PUBLIC_DIR/app" -name '*.map' -delete
else
	echo "[sync-content] web/app/dist is missing: /app/ will not be published (make wasm, then cd web && pnpm build)" >&2
fi

# Clear generated pages left by checkouts that used flat filenames.
rm -f "$CONTENT_DIR"/{agpl,contributing,security,code-of-conduct}.md

# The community pages: each file's text below its "# Title" line, which
# becomes the page title; "Edit page" opens the file itself.
community() {
	local file="$1" slug="$2" description="$3" title
	# The first line less "# " and any CR (a CRLF checkout), written as a
	# YAML double-quoted string with backslashes and quotes escaped.
	mkdir -p "$CONTENT_DIR/$slug"
	title="$(head -n 1 "$REPO_ROOT/$file" | tr -d '\r' | sed -n 's/^# //p')"
	if [ -z "$title" ]; then
		echo "[sync-content] $file must open with a # title line" >&2
		exit 1
	fi
	{
		echo '---'
		printf 'title: "%s"\n' "$(printf '%s' "$title" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
		echo "description: $description"
		echo "editUrl: https://github.com/c65llc/starboard/edit/main/$file"
		echo '---'
		tail -n +2 "$REPO_ROOT/$file" | tr -d '\r'
	} > "$CONTENT_DIR/$slug/index.md"
}
community CONTRIBUTING.md contributing "How to report a problem or ask for a feature, and the license your contributions are under."
community SECURITY.md security "How to report a vulnerability in Starboard privately, through GitHub, and what to expect after you do."
community CODE_OF_CONDUCT.md code-of-conduct "The code of conduct for everyone taking part in Starboard's community, and how it is enforced."

# The license page: the explainer, then the license text.
mkdir -p "$CONTENT_DIR/agpl"
{
	cat "$WEBSITE_DIR/src/agpl.md"
	echo
	echo '## The license text'
	echo
	echo 'This is the [LICENSE](https://github.com/c65llc/starboard/blob/main/LICENSE) file in the repository, unchanged.'
	echo
	# `wrap`: the licence lines are wider than a phone, and a code block
	# that scrolls sideways is a scrollable region axe requires to be
	# keyboard-focusable (issue #4). Wrapped, it never scrolls.
	# `preserveIndent=false`: the licence's indentation only centres its
	# headings, and kept as a hanging indent (up to 28 spaces, which never
	# wrap, plus a 20ch minimum for the text) it is wider than a phone and
	# widens every line of the block with it.
	echo '```text wrap preserveIndent=false'
	cat "$REPO_ROOT/LICENSE"
	echo '```'
} > "$CONTENT_DIR/agpl/index.md"

echo "[sync-content] done"
