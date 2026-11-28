#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026 C65 LLC
#
# check-spdx.sh — every Go, TypeScript and Rust file must open with the
# licence and copyright header. Lists each *.go, *.ts, *.tsx and *.rs file
# whose first two lines are not exactly:
#
#   // SPDX-License-Identifier: AGPL-3.0-only
#   // Copyright 2026 C65 LLC
#
# and exits 1 if there is any. Scans tracked and untracked (not ignored)
# files, so a new file is checked before it is staged.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

want1='// SPDX-License-Identifier: AGPL-3.0-only'
want2='// Copyright 2026 C65 LLC'

bad=0
while IFS= read -r -d '' f; do
	[ -f "$f" ] || continue
	line1=$(sed -n '1p' "$f" | tr -d '\r')
	line2=$(sed -n '2p' "$f" | tr -d '\r')
	if [ "$line1" != "$want1" ] || [ "$line2" != "$want2" ]; then
		echo "$f"
		bad=1
	fi
done < <(git ls-files -z --cached --others --exclude-standard -- '*.go' '*.ts' '*.tsx' '*.rs')

if [ "$bad" -ne 0 ]; then
	echo "check-spdx: the files above lack the SPDX and copyright header" >&2
	exit 1
fi
