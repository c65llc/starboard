// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package format gives each Starboard reference file — starboard.yaml,
// screens.yaml and the flow documents — its one canonical form, so editors,
// agents and people converge and diffs show only real changes. Formatting is
// idempotent: formatting a formatted file changes nothing.
package format

import (
	"bytes"
	"errors"
	"strings"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/project"
	"github.com/c65llc/starboard/internal/registry"
)

// SyntaxError is returned for a file whose YAML cannot be read at all. The
// loader reports such a file already (yaml-syntax and the like).
type SyntaxError struct{ msg string }

func (e *SyntaxError) Error() string { return e.msg }

// Project formats every file in p.Sources. It returns the files whose
// canonical form differs from their bytes, keyed by the same
// project-relative path, and the files that could not be formatted, with
// the reason. A file whose only difference from its canonical form is CRLF
// line endings where the canonical form has LF is formatted: a Windows
// checkout with core.autocrlf converts every line, and the canonical form
// that is returned for a rewrite always has LF. A file whose YAML does not
// parse is in neither map: the loader reports it already.
func Project(p *project.Project) (changed map[string][]byte, failed map[string]error) {
	flowFiles := map[string]bool{}
	for _, name := range p.FlowFiles {
		flowFiles[name] = true
	}
	changed, failed = map[string][]byte{}, map[string]error{}
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
		var syntax *SyntaxError
		switch {
		case errors.As(err, &syntax):
		case err != nil:
			failed[name] = errors.New(reason(err))
		case !bytes.Equal(got, src) && !bytes.Equal(got, []byte(toLF(string(src)))):
			changed[name] = got
		}
	}
	return changed, failed
}

// reason is err's message without the file name the formatters put first,
// since every caller names the file itself.
func reason(err error) string {
	msg := err.Error()
	for _, prefix := range []string{config.FileName + ": ", registry.FileName + ": ", "flow: "} {
		if rest, ok := strings.CutPrefix(msg, prefix); ok {
			return rest
		}
	}
	return msg
}
