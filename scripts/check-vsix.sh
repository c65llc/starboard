#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026 C65 LLC
#
# Checks a packaged VS Code extension: the bundle, the panel's page and the
# license are inside, package.json carries the release's version, and nothing
# that should stay out is (node_modules, source maps, the TypeScript sources
# and tests). Usage: scripts/check-vsix.sh <file.vsix> <version>
# Needs unzip.
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <file.vsix> <version>" >&2
  exit 2
fi
vsix=$1
version=$2

if [ ! -f "$vsix" ]; then
  echo "check-vsix: $vsix does not exist" >&2
  exit 1
fi

list=$(unzip -Z1 "$vsix")
status=0

require() {
  if ! printf '%s\n' "$list" | grep -q -E "$1"; then
    echo "check-vsix: $vsix lacks $2" >&2
    status=1
  fi
}

forbid() {
  found=$(printf '%s\n' "$list" | grep -E "$1" || true)
  if [ -n "$found" ]; then
    echo "check-vsix: $vsix holds $2:" >&2
    printf '%s\n' "$found" | head -5 >&2
    status=1
  fi
}

require '^extension/dist/extension\.js$' 'extension/dist/extension.js'
require '^extension/dist-embed/embed\.js$' 'extension/dist-embed/embed.js (the panel'"'"'s script)'
require '^extension/dist-embed/embed\.css$' 'extension/dist-embed/embed.css (the panel'"'"'s styles)'
require '^extension/package\.json$' 'extension/package.json'
require '^extension/LICENSE(\.txt)?$' 'extension/LICENSE'
forbid '(^|/)node_modules/' 'node_modules'
forbid '\.map$' 'source maps'
forbid '^extension/src/' 'the extension sources (src/)'
forbid '^extension/test/' 'the extension tests (test/)'

# package.json's own version, not a dependency's: the first top-level "version".
got=$(unzip -p "$vsix" extension/package.json 2>/dev/null | sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' | head -n 1)
if [ "$got" != "$version" ]; then
  echo "check-vsix: $vsix has package.json version '${got:-none}', want '$version'" >&2
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "check-vsix: $vsix ok"
fi
exit "$status"
