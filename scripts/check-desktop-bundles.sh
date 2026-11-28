#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026 C65 LLC
#
# Checks the desktop app's bundle of one kind for one version: the expected
# file exists, is not empty, and is the only bundle of that kind in the
# directory (release.extra_files globs Starboard_*, so a stray file would be
# attached to the release too).
# Usage: scripts/check-desktop-bundles.sh VERSION DIR KIND
# VERSION is the bare version (0.7.0, no v). KIND is dmg, exe or appimage.
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: $0 VERSION DIR dmg|exe|appimage" >&2
  exit 2
fi
version=$1
dir=$2
kind=$3

case $kind in
  dmg) name="Starboard_${version}_universal.dmg"; ext=dmg ;;
  exe) name="Starboard_${version}_x64-setup.exe"; ext=exe ;;
  appimage) name="Starboard_${version}_amd64.AppImage"; ext=AppImage ;;
  *)
    echo "check-desktop-bundles: unknown kind '$kind'" >&2
    exit 2
    ;;
esac

if [ ! -d "$dir" ]; then
  echo "check-desktop-bundles: $dir is not a directory" >&2
  exit 1
fi

status=0
if [ ! -f "$dir/$name" ]; then
  echo "check-desktop-bundles: $dir/$name is missing" >&2
  status=1
elif [ ! -s "$dir/$name" ]; then
  echo "check-desktop-bundles: $dir/$name is empty" >&2
  status=1
fi

# Any other .$ext file is a second bundle of this kind.
for f in "$dir"/*."$ext"; do
  [ -e "$f" ] || continue
  base=${f##*/}
  if [ "$base" != "$name" ]; then
    echo "check-desktop-bundles: unexpected $base in $dir (only $name)" >&2
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "check-desktop-bundles: $version $kind ok: $name"
fi
exit "$status"
