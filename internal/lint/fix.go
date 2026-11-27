// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package lint

import (
	"maps"

	"github.com/c65llc/starboard/internal/format"
	"github.com/c65llc/starboard/internal/generate"
	"github.com/c65llc/starboard/internal/project"
)

// Changes is what Fix would do to a project: the files to write, keyed by
// project-relative slash path, and the sorted files to remove.
type Changes struct {
	Write  map[string][]byte
	Remove []string
}

// Fix returns the safe fixes for p: every source file format would rewrite,
// every generated file that is missing or out of date, and every file
// generate owns (generate.Owned) that it no longer writes; any other file
// under <content>/generated/ is left alone. Generation is
// computed from p as loaded, so when Fix rewrites a source file the caller
// applies it, reloads, and calls Fix again to regenerate from the formatted
// sources. Fix never names a file to remove outside <content>/generated/.
// When the generated directory cannot be read, only the formatting is
// returned; lint reports the read error under generated-stale.
func Fix(p *project.Project) Changes {
	formatted, _ := format.Project(p) // a file it cannot format stays a not-formatted finding
	ch := Changes{Write: maps.Clone(formatted)}
	gen := generate.All(p)
	diff, err := generate.Diff(p, gen)
	if err != nil {
		return ch
	}
	for _, d := range diff {
		if d.Kind == generate.Extra {
			ch.Remove = append(ch.Remove, d.Path) // Diff only walks the generated directory, in path order
			continue
		}
		ch.Write[d.Path] = gen[d.Path]
	}
	return ch
}
