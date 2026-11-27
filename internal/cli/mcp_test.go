// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// travelApp copies examples/travel-app into a temporary directory.
func travelApp(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "travel-app")
	require.NoError(t, os.CopyFS(dir, os.DirFS(filepath.Join("..", "..", "examples", "travel-app"))))
	return dir
}

// mcpTexts runs starboard mcp in dir over the given tools/call requests
// (name and arguments) and returns each result's first text.
func mcpTexts(t *testing.T, dir string, calls ...string) []string {
	t.Helper()
	in := `{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}` + "\n"
	for i, c := range calls {
		in += `{"jsonrpc":"2.0","id":` + string(rune('1'+i)) + `,"method":"tools/call","params":` + c + "}\n"
	}
	var stdout, stderr bytes.Buffer
	require.Equal(t, ExitOK, Run([]string{"--dir", dir, "mcp"}, strings.NewReader(in), &stdout, &stderr), stderr.String())
	lines := strings.Split(strings.TrimSuffix(stdout.String(), "\n"), "\n")
	require.Len(t, lines, len(calls)+1)
	var texts []string
	for _, l := range lines[1:] {
		var r struct {
			Result struct {
				Content []struct{ Text string }
				IsError bool
			}
		}
		require.NoError(t, json.Unmarshal([]byte(l), &r))
		require.False(t, r.Result.IsError, l)
		texts = append(texts, r.Result.Content[0].Text)
	}
	return texts
}

// The MCP lint and rules tools return exactly what the commands print.
func TestMCPMatchesCLI(t *testing.T) {
	dir := travelApp(t)
	// Give lint something to report.
	flow := filepath.Join(dir, "docs", "flows", "flows", "add-activity.md")
	data, err := os.ReadFile(flow) //nolint:gosec // G304: a file the test made
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(flow, bytes.Replace(data, []byte("#title"), []byte("#titel"), 1), 0o600)) //nolint:gosec // G703: a file the test made

	texts := mcpTexts(t, dir,
		`{"name":"starboard_lint"}`,
		`{"name":"starboard_rules"}`,
		`{"name":"starboard_render","arguments":{"screen":"trip.timeline","formFactor":"web-wide"}}`,
	)
	code, lintOut, _ := run("--dir", dir, "lint", "--json")
	assert.Equal(t, ExitFindings, code)
	assert.Contains(t, lintOut, "ref-unresolved")
	assert.Equal(t, lintOut, texts[0])
	_, rulesOut, _ := run("rules", "--json")
	assert.Equal(t, rulesOut, texts[1])
	_, svg, _ := run("--dir", dir, "render", "trip.timeline", "--form-factor", "web-wide")
	assert.Equal(t, svg, texts[2])
}

// A write through MCP leaves exactly what starboard fmt would.
func TestMCPWriteMatchesFmt(t *testing.T) {
	dir := travelApp(t)
	mcpTexts(t, dir,
		`{"name":"starboard_screen_set","arguments":{"id":"trip.map","fields":{"purpose":"Every place of the trip, on one map."}}}`,
		`{"name":"starboard_screen_set","arguments":{"id":"trip.notes","fields":{"title":"Notes","area":"trip","purpose":"Shared notes.","presentation":"push","status":"proposed","layout":[{"region":"notes","kind":"text","label":"The notes"}]}}}`,
		`{"name":"starboard_flow_set","arguments":{"id":"read-the-notes","frontMatter":{"title":"Read the notes","status":"proposed","entry":"trip.notes","actors":["traveller"]},"body":"\n**Goal:** read the notes.\n\n## Steps\n\n1. Read @trip.notes#notes.\n"}}`,
		`{"name":"starboard_generate"}`,
	)
	code, out, errOut := run("--dir", dir, "fmt", "--check")
	assert.Equal(t, ExitOK, code, out+errOut)
	assert.Empty(t, out)
	code, out, _ = run("--dir", dir, "lint")
	assert.Equal(t, ExitOK, code, out)
}

func TestMCPCommand(t *testing.T) {
	dir := travelApp(t)
	var stdout, stderr bytes.Buffer
	code := Run([]string{"--dir", dir, "mcp", "--read-only"}, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`), &stdout, &stderr)
	assert.Equal(t, ExitOK, code)
	assert.NotContains(t, stdout.String(), "starboard_screen_set")
	assert.Contains(t, stdout.String(), "starboard_screen_get")
	assert.Regexp(t, `^starboard mcp: serving .*travel-app \(read-only\)\n$`, stderr.String())

	code, _, errOut := run("--dir", dir, "mcp", "extra")
	assert.Equal(t, ExitUsage, code)
	assert.Contains(t, errOut, "mcp takes no arguments")

	code, _, errOut = run("--dir", t.TempDir(), "mcp")
	assert.Equal(t, ExitUsage, code)
	assert.Contains(t, errOut, "starboard.yaml")

	// Losing stdout ends the server with status 2.
	stderr.Reset()
	code = Run([]string{"--dir", dir, "mcp"}, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"ping"}`), failWriter{}, &stderr)
	assert.Equal(t, ExitUsage, code)
	assert.Contains(t, stderr.String(), "broken pipe")
}

type failWriter struct{}

func (failWriter) Write([]byte) (int, error) { return 0, errors.New("broken pipe") }

func TestSkillsMCP(t *testing.T) {
	code, out, errOut := run("skills", "mcp", "claude-code")
	assert.Equal(t, ExitOK, code)
	assert.Contains(t, out, `"mcpServers"`)
	assert.Contains(t, errOut, ".mcp.json")

	code, out, _ = run("skills", "mcp", "--read-only", "codex")
	assert.Equal(t, ExitOK, code)
	assert.Equal(t, "[mcp_servers.starboard]\ncommand = \"starboard\"\nargs = [\"mcp\", \"--read-only\"]\n", out)

	code, _, errOut = run("skills", "mcp", "aider")
	assert.Equal(t, ExitUsage, code)
	assert.Contains(t, errOut, "aider has no MCP client")
	code, _, errOut = run("skills", "mcp")
	assert.Equal(t, ExitUsage, code)
	assert.Contains(t, errOut, "skills mcp takes one argument")
}
