// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package skills

import (
	"encoding/json"
	"fmt"
	"strings"
)

// PreCommit is the hook name for a git pre-commit hook.
const PreCommit = "pre-commit"

// HookNames is every name Hooks takes: the agents, then the git hook.
var HookNames = append(func() []string {
	out := make([]string, len(Agents))
	for i, a := range Agents {
		out[i] = string(a)
	}
	return out
}(), PreCommit)

// HookCommand is the command the Claude Code hook runs.
const HookCommand = "starboard hook claude-code"

// claudeSettings is the settings.json fragment for Claude Code.
type claudeSettings struct {
	Hooks struct {
		PostToolUse []claudeMatcher `json:"PostToolUse"`
	} `json:"hooks"`
}

type claudeMatcher struct {
	Matcher string       `json:"matcher"`
	Hooks   []claudeHook `json:"hooks"`
}

type claudeHook struct {
	Type    string `json:"type"`
	Command string `json:"command"`
}

// preCommitHook is the git pre-commit hook.
const preCommitHook = `#!/bin/sh
# Starboard: refuse a commit whose reference is not formatted or not
# lint-clean. "starboard lint --fix" formats the sources and regenerates
# generated/; commit what it changes.
starboard fmt --check && starboard lint
`

// agentParagraph is the instruction for agents that read an instructions
// file instead of running hooks.
const agentParagraph = `## Starboard checks

After editing ` + "`starboard.yaml`" + `, the screen registry (` + "`screens.yaml`" + `), a
flow file or a vocabulary file, run ` + "`starboard fmt`" + ` then ` + "`starboard lint --json`" + `,
and fix every finding before you finish. Never hand-edit ` + "`generated/`" + `;
` + "`starboard lint --fix`" + ` rewrites it.
`

// hookNotes say, in one line, where each hook's output goes.
var hookNotes = map[string]string{
	string(ClaudeCode): "Merge this into .claude/settings.json (or .claude/settings.local.json); starboard never edits it.",
	string(Cursor):     "Add this to a Cursor rule under .cursor/rules/, or to AGENTS.md outside the skills section.",
	string(Copilot):    "Add this to .github/copilot-instructions.md.",
	string(Codex):      "Add this to AGENTS.md, outside the starboard skills section.",
	string(Gemini):     "Add this to GEMINI.md, outside the starboard skills section.",
	string(Aider):      "Add this to CONVENTIONS.md, outside the starboard skills section.",
	PreCommit:          "Save this as .git/hooks/pre-commit and make it executable, or run its last line from your hook manager.",
}

// Hooks returns the configuration that makes name run starboard fmt and
// lint after edits. For claude-code it is a settings.json fragment: a
// PostToolUse hook on Edit, Write and MultiEdit that runs
// HookCommand, which checks the edited file when it is part of the
// reference and reports findings back to the agent. For pre-commit it is a
// git hook script. For the other agents it is a paragraph for their
// instructions file. HookNote says where each goes.
func Hooks(name string) (string, error) {
	switch name {
	case string(ClaudeCode):
		var s claudeSettings
		s.Hooks.PostToolUse = []claudeMatcher{{
			Matcher: "Edit|Write|MultiEdit",
			Hooks:   []claudeHook{{Type: "command", Command: HookCommand}},
		}}
		data, _ := json.MarshalIndent(s, "", "  ") // plain structs of strings always marshal
		return string(data) + "\n", nil
	case PreCommit:
		return preCommitHook, nil
	}
	if _, ok := hookNotes[name]; ok {
		return agentParagraph, nil
	}
	return "", fmt.Errorf("unknown hook target %s; use %s or %s",
		name, strings.Join(HookNames[:len(HookNames)-1], ", "), HookNames[len(HookNames)-1])
}

// HookNote is one line saying where Hooks' output for name goes, or "" for
// an unknown name.
func HookNote(name string) string { return hookNotes[name] }
