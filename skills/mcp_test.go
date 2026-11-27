// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package skills_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/mcp"
	"github.com/c65llc/starboard/skills"
)

// The skills name the MCP server's tools, so they are held to the server
// (arch-10 §8, sec-01 §8): every tool a skill names exists; a skill that
// names a write tool tells the agent to preview first; and a skill that
// names any tool, all of which return fenced project content, teaches the
// untrusted-data rule in the server's own words.

// toolName finds a backticked wire name under the server's prefix.
var toolName = regexp.MustCompile("`(starboard_[a-z0-9_]+)`")

func TestSkillsNameRealTools(t *testing.T) {
	writes := map[string]bool{}
	for _, tl := range mcp.Tools() {
		writes[tl.Name] = tl.Writes
	}
	named := 0
	for _, s := range skills.All() {
		t.Run(s.Name, func(t *testing.T) {
			var names []string
			for _, m := range toolName.FindAllStringSubmatch(s.Body, -1) {
				names = append(names, m[1])
			}
			if len(names) == 0 {
				return
			}
			named++
			namesWrite := false
			for _, n := range names {
				w, ok := writes[n]
				assert.True(t, ok, "%s names %s, which the MCP server does not have", s.Name, n)
				namesWrite = namesWrite || w
			}
			if namesWrite {
				assert.Contains(t, s.Body, "`preview: true`", "%s names a write tool, so it must say to preview first", s.Name)
			}
			assert.Contains(t, s.Body, mcp.UntrustedDataRule, "%s names MCP tools, so it must teach the untrusted-data rule", s.Name)
		})
	}
	require.Positive(t, named, "the skills should name the MCP tools")
}

func TestToolNamePatternFindsNames(t *testing.T) {
	m := toolName.FindAllStringSubmatch("use `starboard_lint` and `starboard_screen_set`, not `starboard lint`", -1)
	require.Len(t, m, 2)
	assert.Equal(t, "starboard_lint", m[0][1])
	assert.True(t, strings.HasPrefix(m[1][1], "starboard_screen"))
}
