// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package mcp

import (
	"crypto/sha256"
	"encoding/hex"
	"path"
	"strings"

	"github.com/c65llc/starboard/internal/format"
	"github.com/c65llc/starboard/internal/project"
	"github.com/c65llc/starboard/internal/registry"
)

// A record version is a content hash of one record's formatted text: a
// screen's entry in screens.yaml, or a whole flow file. The get tools
// return it, and the set tools take it back as baseVersion, so an edit
// made on a stale read is refused instead of overwriting someone else's
// change (arch-10 §4). Formatting first means a change fmt would undo is
// not a change; a change to another screen is not one either.

// hash is the version of text.
func hash(text []byte) string {
	sum := sha256.Sum256(text)
	return "sha256:" + hex.EncodeToString(sum[:])
}

// screenVersion is the version of screen id, or "" when it is not
// registered.
func screenVersion(p *project.Project, id string) string {
	if _, ok := p.Registry.Screens[id]; !ok {
		return ""
	}
	src := p.Sources[path.Join(path.Clean(p.Config.Content), registry.FileName)]
	if formatted, err := format.Screens(src, p.Config.Areas); err == nil {
		src = formatted
	}
	reg, _ := registry.Parse(src)
	if reg == nil || reg.Screens[id] == nil { // the formatter keeps every screen; this is belt and braces
		return hash(src)
	}
	lines := strings.SplitAfter(string(src), "\n")
	start := reg.Screens[id].Line - 1
	end := start + 1
	// The entry runs until the next line at the screen's own indent or less.
	for end < len(lines) && (strings.HasPrefix(lines[end], "   ") || strings.TrimSpace(lines[end]) == "") {
		end++
	}
	return hash([]byte(strings.Join(lines[start:end], "")))
}

// flowVersion is the version of the flow whose stem is id, or "" when
// there is none.
func flowVersion(p *project.Project, id string) string {
	if _, ok := p.Flows[id]; !ok {
		return ""
	}
	src := p.Sources[path.Join(path.Clean(p.Config.Content), "flows", id+".md")]
	if formatted, err := format.Flow(src); err == nil {
		src = formatted
	}
	return hash(src)
}
