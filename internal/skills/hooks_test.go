// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package skills

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	skillsfs "github.com/c65llc/starboard/skills"
)

func TestHooksClaudeCodeIsValidJSON(t *testing.T) {
	out, err := Hooks("claude-code")
	require.NoError(t, err)
	var got struct {
		Hooks struct {
			PostToolUse []struct {
				Matcher string `json:"matcher"`
				Hooks   []struct {
					Type    string `json:"type"`
					Command string `json:"command"`
				} `json:"hooks"`
			} `json:"PostToolUse"`
		} `json:"hooks"`
	}
	dec := json.NewDecoder(strings.NewReader(out))
	dec.DisallowUnknownFields()
	require.NoError(t, dec.Decode(&got))
	assert.False(t, dec.More(), "the output is one JSON document")
	require.Len(t, got.Hooks.PostToolUse, 1)
	post := got.Hooks.PostToolUse[0]
	assert.Equal(t, "Edit|Write|MultiEdit", post.Matcher)
	require.Len(t, post.Hooks, 1)
	assert.Equal(t, "command", post.Hooks[0].Type)
	assert.Equal(t, "starboard hook claude-code", post.Hooks[0].Command)
	assert.True(t, strings.HasPrefix(out, "{\n  \"hooks\""), "pretty-printed")
	assert.True(t, strings.HasSuffix(out, "}\n"))
}

func TestHooksPreCommit(t *testing.T) {
	out, err := Hooks("pre-commit")
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(out, "#!/bin/sh\n"))
	assert.Contains(t, out, "\nstarboard fmt --check && starboard lint\n")
}

func TestHooksParagraphForTheOtherAgents(t *testing.T) {
	for _, a := range []Agent{Cursor, Copilot, Codex, Gemini, Aider} {
		out, err := Hooks(string(a))
		require.NoError(t, err, a)
		assert.Contains(t, out, "run `starboard fmt` then `starboard lint --json`", a)
		assert.Contains(t, out, "Never hand-edit `generated/`", a)
		assert.NotContains(t, out, StartMarker, "the paragraph goes outside the managed section")
	}
}

func TestHooksUnknown(t *testing.T) {
	_, err := Hooks("emacs")
	assert.EqualError(t, err, "unknown hook target emacs; use claude-code, cursor, copilot, codex, gemini, aider or pre-commit")
	assert.Empty(t, HookNote("emacs"))
}

func TestHookNoteNamesWhereItGoes(t *testing.T) {
	want := map[string]string{
		"claude-code": ".claude/settings.json",
		"pre-commit":  ".git/hooks/pre-commit",
		"cursor":      ".cursor/rules/",
		"copilot":     ".github/copilot-instructions.md",
		"codex":       "AGENTS.md",
		"gemini":      "GEMINI.md",
		"aider":       "CONVENTIONS.md",
	}
	for name, where := range want {
		note := HookNote(name)
		assert.Contains(t, note, where, name)
		assert.NotContains(t, note, "\n", "one line")
	}
	assert.Len(t, HookNames, len(want))
}

// TestGuideShowsTheRealHooks: the guide quotes the hooks' output, so it
// cannot drift from what the command prints.
func TestGuideShowsTheRealHooks(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "docs", "guides", "agents.md"))
	require.NoError(t, err)
	guide := string(data)
	for _, name := range []string{"claude-code", "codex"} {
		out, err := Hooks(name)
		require.NoError(t, err)
		assert.Contains(t, guide, out, name)
	}
	assert.Contains(t, guide, "\nstarboard fmt --check && starboard lint\n")
	for _, a := range Agents {
		assert.Contains(t, guide, "`"+string(a)+"`", a)
	}
	for _, s := range skillsfs.All() {
		assert.Contains(t, guide, "| `"+s.Name+"` |", s.Name)
	}
}
