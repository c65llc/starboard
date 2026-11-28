#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026 C65 LLC
#
# Stamps a version into the desktop app's four version fields in this
# checkout (package.json, tauri.conf.json, Cargo.toml and the root
# starboard-desktop entry of Cargo.lock, so `--locked` still holds), and
# fails if any field did not take it. Used by release.yml (the tag's
# version) and ci.yml (0.0.0). Usage: scripts/stamp-desktop-version.sh VERSION
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 VERSION" >&2
  exit 2
fi
version=$1
dir=web/desktop
dev=0.0.0-dev

sed -i.bak "s/^  \"version\": \"$dev\",/  \"version\": \"$version\",/" "$dir/package.json" "$dir/src-tauri/tauri.conf.json"
sed -i.bak "s/^version = \"$dev\"/version = \"$version\"/" "$dir/src-tauri/Cargo.toml"
# Cargo.lock: the version line right after the root package's name.
awk -v v="$version" '
  stamp && /^version = / { print "version = \"" v "\""; stamp = 0; next }
  { stamp = ($0 == "name = \"starboard-desktop\""); print }
' "$dir/src-tauri/Cargo.lock" > "$dir/src-tauri/Cargo.lock.bak"
mv "$dir/src-tauri/Cargo.lock.bak" "$dir/src-tauri/Cargo.lock"
rm -f "$dir/package.json.bak" "$dir/src-tauri/tauri.conf.json.bak" "$dir/src-tauri/Cargo.toml.bak"

status=0
grep -q "^  \"version\": \"$version\"," "$dir/package.json" || { echo "stamp: package.json missed" >&2; status=1; }
grep -q "^  \"version\": \"$version\"," "$dir/src-tauri/tauri.conf.json" || { echo "stamp: tauri.conf.json missed" >&2; status=1; }
grep -q "^version = \"$version\"" "$dir/src-tauri/Cargo.toml" || { echo "stamp: Cargo.toml missed" >&2; status=1; }
grep -A1 '^name = "starboard-desktop"$' "$dir/src-tauri/Cargo.lock" | grep -q "^version = \"$version\"$" || { echo "stamp: Cargo.lock missed" >&2; status=1; }
exit "$status"
