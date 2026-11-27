// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package lint

import (
	"maps"
	"slices"

	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/format"
	"github.com/c65llc/starboard/internal/project"
)

// ruleNotFormatted reports each source file whose canonical form differs
// from its bytes. A file that cannot be parsed is not reported here; its
// parse error already is.
func ruleNotFormatted(p *project.Project, _ *Context) []diag.Diagnostic {
	changed := format.Project(p)
	var out []diag.Diagnostic
	for _, name := range slices.Sorted(maps.Keys(changed)) {
		out = append(out, diag.Diagnostic{
			Rule:    "not-formatted",
			File:    name,
			Message: name + " is not in canonical form",
			Fix:     &diag.Fix{Description: "run starboard fmt"},
		})
	}
	return out
}
