// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package format gives each Starboard reference file — starboard.yaml,
// screens.yaml and the flow documents — its one canonical form, so editors,
// agents and people converge and diffs show only real changes. Formatting is
// idempotent: formatting a formatted file changes nothing.
package format

import (
	"bytes"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/project"
)

// Project formats every file in p.Sources and returns those whose canonical
// form differs from their bytes, keyed by the same project-relative path. A
// file that cannot be parsed is left out: lint reports it already.
func Project(p *project.Project) map[string][]byte {
	flowFiles := map[string]bool{}
	for _, name := range p.FlowFiles {
		flowFiles[name] = true
	}
	out := map[string][]byte{}
	for name, src := range p.Sources {
		var got []byte
		var err error
		switch {
		case name == config.FileName:
			got, err = Config(src)
		case flowFiles[name]:
			got, err = Flow(src)
		default: // the only other source is the registry
			got, err = Screens(src, p.Config.Areas)
		}
		if err == nil && !bytes.Equal(got, src) {
			out[name] = got
		}
	}
	return out
}
