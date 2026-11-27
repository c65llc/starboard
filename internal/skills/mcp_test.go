// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package skills

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMCPConfigJSON(t *testing.T) {
	for _, tc := range []struct {
		agent    Agent
		readOnly bool
		key      string
		want     mcpServer
	}{
		{ClaudeCode, false, "mcpServers", mcpServer{Type: "stdio", Command: "starboard", Args: []string{"mcp"}}},
		{ClaudeCode, true, "mcpServers", mcpServer{Type: "stdio", Command: "starboard", Args: []string{"mcp", "--read-only"}}},
		{Cursor, false, "mcpServers", mcpServer{Command: "starboard", Args: []string{"--dir", "${workspaceFolder}", "mcp"}}},
		{Copilot, true, "servers", mcpServer{Type: "stdio", Command: "starboard", Args: []string{"--dir", "${workspaceFolder}", "mcp", "--read-only"}}},
		{Gemini, false, "mcpServers", mcpServer{Command: "starboard", Args: []string{"mcp"}}},
	} {
		out, err := MCPConfig(string(tc.agent), tc.readOnly)
		require.NoError(t, err, tc.agent)
		var got map[string]map[string]mcpServer
		require.NoError(t, json.Unmarshal([]byte(out), &got), tc.agent)
		assert.Equal(t, map[string]map[string]mcpServer{tc.key: {"starboard": tc.want}}, got, tc.agent)
		assert.NotEmpty(t, MCPNote(string(tc.agent)))
	}
}

func TestMCPConfigCodexTOML(t *testing.T) {
	out, err := MCPConfig("codex", false)
	require.NoError(t, err)
	assert.Equal(t, "[mcp_servers.starboard]\ncommand = \"starboard\"\nargs = [\"mcp\"]\n", out)
	out, err = MCPConfig("codex", true)
	require.NoError(t, err)
	assert.Equal(t, "[mcp_servers.starboard]\ncommand = \"starboard\"\nargs = [\"mcp\", \"--read-only\"]\n", out)
	assert.Contains(t, MCPNote("codex"), "~/.codex/config.toml")
}

func TestMCPConfigRefusals(t *testing.T) {
	_, err := MCPConfig("aider", false)
	require.EqualError(t, err, "aider has no MCP client; use starboard skills hooks aider instead")
	_, err = MCPConfig("emacs", false)
	require.EqualError(t, err, "unknown agent emacs; use claude-code, cursor, copilot, codex or gemini")
	assert.Empty(t, MCPNote("aider"))
}
