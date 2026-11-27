#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026 C65 LLC
#
# Functional tests for scripts/check-links.mjs, against a synthetic dist/
# fixture (node only, no Astro build): a broken "Edit page" link is reported
# as the page's editUrl front matter, and other broken links as before.
# Usage: bash website/scripts/test-check-links.sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECK="$SCRIPT_DIR/check-links.mjs"
REPO="https://github.com/c65llc/starboard"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

page() {
	# $1 = path under dist, $2 = body
	mkdir -p "$TMP/dist/$(dirname "$1")"
	printf '<!doctype html><html><body>%s</body></html>\n' "$2" > "$TMP/dist/$1"
}

echo "check-links: a clean site passes"
page index.html "<a href=\"/rules/a/\">a</a> <a href=\"$REPO/edit/main/docs/rules/file-missing.md\">Edit page</a>"
page rules/a/index.html '<p id="x">a</p>'
if node "$CHECK" --dist "$TMP/dist" > "$TMP/out" 2>&1; then pass "exit 0"; else fail "exit $? on a clean site: $(cat "$TMP/out")"; fi

echo "check-links: a broken Edit page link names the editUrl front matter"
page rules/b/index.html "<a href=\"$REPO/edit/main/docs/rules/no-such-rule.md\">Edit page</a>"
if node "$CHECK" --dist "$TMP/dist" > "$TMP/out" 2>&1; then fail "exit 0 with a broken edit link"; else pass "exit 1"; fi
if grep -qF 'rules/b/index.html: the "Edit page" link names docs/rules/no-such-rule.md, which is not a file in the repository: fix the page'"'"'s editUrl front matter' "$TMP/out"; then
	pass "the message names editUrl"
else
	fail "the message does not name editUrl: $(cat "$TMP/out")"
fi

echo "check-links: another broken repository link is reported as a link"
rm -rf "$TMP/dist/rules/b"
page rules/c/index.html "<a href=\"$REPO/blob/main/docs/no-such-page.md\">source</a>"
if node "$CHECK" --dist "$TMP/dist" > "$TMP/out" 2>&1; then fail "exit 0 with a broken blob link"; else pass "exit 1"; fi
if grep -qF "rules/c/index.html: $REPO/blob/main/docs/no-such-page.md names docs/no-such-page.md, which is not a file in the repository" "$TMP/out" && ! grep -qF editUrl "$TMP/out"; then
	pass "the message names the link, not editUrl"
else
	fail "unexpected message: $(cat "$TMP/out")"
fi

echo
echo "test-check-links: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
