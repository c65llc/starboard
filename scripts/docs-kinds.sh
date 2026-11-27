#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026 C65 LLC
#
# docs-kinds.sh STARBOARD FIXTURES OUT — render the region-kind reference.
#
# Each FIXTURES/<kind>.yaml is a layout: the regions of one screen, as
# docs/reference/screens-yaml.md shows them. This wraps each in a one-screen
# project, checks that the fixture is in canonical form (starboard fmt
# --check), and writes the screen's wireframe to OUT/<kind>.svg with
# starboard render. The frame is a 360x320 "example" form factor, so the
# pictures stay small.
set -euo pipefail

if [ "$#" -ne 3 ]; then
	echo "usage: $0 STARBOARD FIXTURES OUT" >&2
	exit 2
fi
bin=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
fixtures=$2
out=$3

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

for fixture in "$fixtures"/*.yaml; do
	kind=$(basename "$fixture" .yaml)
	project="$tmp/$kind"
	mkdir -p "$project/docs/flows"
	cat > "$project/starboard.yaml" <<YAML
version: 1
platforms:
  app:
    formFactors: [example]
formFactors:
  example:
    width: 360
    height: 320
areas: [kinds]
YAML
	{
		printf 'screens:\n  kinds.%s:\n    title: %s\n    area: kinds\n    presentation: push\n    layout:\n' "$kind" "$kind"
		sed 's/^/      /' "$fixture"
	} > "$project/docs/flows/screens.yaml"
	if ! "$bin" --dir "$project" fmt --check > "$tmp/fmt.out"; then
		echo "docs-kinds: $fixture is not in canonical form; starboard fmt would rewrite it" >&2
		exit 1
	fi
	"$bin" --dir "$project" render "kinds.$kind" -o "$out/$kind.svg" > /dev/null
done
