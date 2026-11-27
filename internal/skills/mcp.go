// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package skills

import (
	"encoding/json"
	"fmt"
	"strings"
)

// MCPServerName is the name the server is configured under in each
// agent's MCP settings.
const MCPServerName = "starboard"

// mcpServer is one server entry of an agent's MCP settings. Type is only
// written for the clients that want it.
type mcpServer struct {
	Type    string   `json:"type,omitempty"`
	Command string   `json:"command"`
	Args    []string `json:"args"`
}

// workspaceDir is how VS Code and Cursor name the open folder in a server's
// arguments; they do not promise to start the server there.
const workspaceDir = "${workspaceFolder}"

// mcpNotes say, in one line, where each agent's MCP configuration goes.
var mcpNotes = map[Agent]string{
	ClaudeCode: "Merge this into .mcp.json at the project root (shared) or add it with claude mcp add; starboard never edits it.",
	Cursor:     "Merge this into .cursor/mcp.json; starboard never edits it.",
	Copilot:    "Merge this into .vscode/mcp.json, which VS Code's Copilot agent mode reads; starboard never edits it.",
	Gemini:     "Merge this into .gemini/settings.json; starboard never edits it.",
	Codex:      "Add this to ~/.codex/config.toml, and start Codex from the project; starboard never edits it.",
}

// MCPConfig returns the MCP client configuration that makes agent start
// `starboard mcp` (with --read-only when readOnly): JSON for Claude Code,
// Cursor, VS Code (copilot) and Gemini, TOML for Codex. Aider has no MCP
// client, so it is an error, as is an unknown agent. MCPNote says where
// the output goes.
func MCPConfig(agent string, readOnly bool) (string, error) {
	args := []string{"mcp"}
	if readOnly {
		args = append(args, "--read-only")
	}
	inWorkspace := append([]string{"--dir", workspaceDir}, args...)
	switch Agent(agent) {
	case ClaudeCode:
		return mcpJSON("mcpServers", mcpServer{Type: "stdio", Command: "starboard", Args: args}), nil
	case Cursor:
		return mcpJSON("mcpServers", mcpServer{Command: "starboard", Args: inWorkspace}), nil
	case Copilot:
		return mcpJSON("servers", mcpServer{Type: "stdio", Command: "starboard", Args: inWorkspace}), nil
	case Gemini:
		return mcpJSON("mcpServers", mcpServer{Command: "starboard", Args: args}), nil
	case Codex:
		quoted := make([]string, len(args))
		for i, a := range args {
			quoted[i] = fmt.Sprintf("%q", a)
		}
		return fmt.Sprintf("[mcp_servers.%s]\ncommand = \"starboard\"\nargs = [%s]\n", MCPServerName, strings.Join(quoted, ", ")), nil
	case Aider:
		return "", fmt.Errorf("aider has no MCP client; use starboard skills hooks aider instead")
	}
	names := make([]string, 0, len(mcpNotes))
	for _, a := range Agents {
		if _, ok := mcpNotes[a]; ok {
			names = append(names, string(a))
		}
	}
	return "", fmt.Errorf("unknown agent %s; use %s or %s", agent, strings.Join(names[:len(names)-1], ", "), names[len(names)-1])
}

// mcpJSON is {"<key>": {"starboard": server}}, pretty-printed.
func mcpJSON(key string, server mcpServer) string {
	data, _ := json.MarshalIndent(map[string]map[string]mcpServer{key: {MCPServerName: server}}, "", "  ") // plain strings always marshal
	return string(data) + "\n"
}

// unattended is the rule every note ends with: an agent nobody watches
// must not be able to write (sec-01 §8).
const unattended = " CI and unattended agents must use --read-only."

// MCPNote is one line saying where MCPConfig's output for agent goes, and
// that unattended agents must use --read-only; "" for an agent without
// one.
func MCPNote(agent string) string {
	if note, ok := mcpNotes[Agent(agent)]; ok {
		return note + unattended
	}
	return ""
}
