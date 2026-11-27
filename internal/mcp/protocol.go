// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package mcp serves a Starboard project to coding agents over the Model
// Context Protocol: JSON-RPC 2.0, one message per line, on a reader and a
// writer (the stdio transport). It answers initialize, ping, tools/list and
// tools/call; the tools are in tools.go. It is a minimal implementation on
// encoding/json rather than the MCP SDK, which would bring HTTP, OAuth and
// JSON Schema dependencies this server has no use for (see
// docs/specs/2026-11-27-mcp-server-design.md).
//
// Requests are answered one at a time, in order. A tool reads the project
// afresh on every call, so edits made outside the server are always seen.
package mcp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"

	"github.com/c65llc/starboard/internal/project"
)

// Versions are the protocol versions the server speaks, newest first.
var Versions = []string{"2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"}

// structuredSince is the first version with a tool result's
// structuredContent.
const structuredSince = "2025-06-18"

// The JSON-RPC error codes the server returns.
const (
	codeParse          = -32700
	codeInvalidRequest = -32600
	codeMethodNotFound = -32601
	codeInvalidParams  = -32602
)

// Options configure a server. ReadOnly leaves the write tools out.
// Version is the server version initialize reports.
type Options struct {
	ReadOnly bool
	Version  string
}

// instructions is what initialize tells the client about the server.
const instructions = `Starboard keeps this app's screens and user flows as plain text: a screen registry (screens.yaml) and Markdown flows.
Read with starboard_query, starboard_screen_get, starboard_flow_get and starboard_refs; see a screen's wireframe with starboard_render.
Change the reference with starboard_screen_set and starboard_flow_set, never by editing generated pages: each write is formatted as starboard fmt formats it, and returns the project's lint report.
After changes, run starboard_generate to refresh the generated pages, then starboard_lint until it has no errors.`

// request is a JSON-RPC request or notification; a notification has no
// ID.
type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
	// Result and Error mark a response, which a client sends only to a
	// server's own request; this server sends none.
	Result json.RawMessage `json:"result"`
	Error  json.RawMessage `json:"error"`
}

// response is a JSON-RPC response: a result or an error.
type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// nullID is the ID of an error response to a message whose ID is unknown.
var nullID = json.RawMessage("null")

// server is one session: the project, the options, and the version agreed
// at initialize.
type server struct {
	fsys    project.WriteFS
	opts    Options
	log     io.Writer
	version string
}

// Serve reads requests from in and writes responses to out until in ends,
// logging each tool call as one line to log. fsys is the project root. It
// returns nil at the end of in, or the error that stopped reading or
// writing.
func Serve(in io.Reader, out, log io.Writer, fsys project.WriteFS, opts Options) error {
	s := &server{fsys: fsys, opts: opts, log: log, version: Versions[0]}
	r := bufio.NewReader(in)
	enc := json.NewEncoder(out)
	enc.SetEscapeHTML(false)
	for {
		line, err := r.ReadBytes('\n')
		if len(bytes.TrimSpace(line)) > 0 {
			if resp := s.handle(line); resp != nil {
				if werr := enc.Encode(resp); werr != nil {
					return fmt.Errorf("writing a response: %w", werr)
				}
			}
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("reading a request: %w", err)
		}
	}
}

// handle answers one message, or returns nil for a notification.
func (s *server) handle(line []byte) *response {
	line = bytes.TrimSpace(line)
	if line[0] == '[' {
		return errorResponse(nullID, codeInvalidRequest, "batches are not supported; send one request per line")
	}
	var req request
	if err := json.Unmarshal(line, &req); err != nil {
		return errorResponse(nullID, codeParse, "parse error: "+err.Error())
	}
	if req.Method == "" && (req.Result != nil || req.Error != nil) {
		return nil // a response to a request this server never sent
	}
	if req.JSONRPC != "2.0" || req.Method == "" || string(req.ID) == "null" {
		id := req.ID
		if id == nil {
			id = nullID
		}
		return errorResponse(id, codeInvalidRequest, `invalid request: it needs "jsonrpc": "2.0", a method and an id that is a string or a number`)
	}
	if req.ID == nil {
		return nil // a notification, such as notifications/initialized: nothing to answer
	}
	result, rerr := s.dispatch(req.Method, req.Params)
	if rerr != nil {
		return &response{JSONRPC: "2.0", ID: req.ID, Error: rerr}
	}
	return &response{JSONRPC: "2.0", ID: req.ID, Result: result}
}

func errorResponse(id json.RawMessage, code int, message string) *response {
	return &response{JSONRPC: "2.0", ID: id, Error: &rpcError{Code: code, Message: message}}
}

// dispatch runs one method.
func (s *server) dispatch(method string, params json.RawMessage) (any, *rpcError) {
	switch method {
	case "initialize":
		return s.initialize(params)
	case "ping":
		return struct{}{}, nil
	case "tools/list":
		return map[string]any{"tools": s.listTools()}, nil
	case "tools/call":
		return s.callTool(params)
	}
	return nil, &rpcError{Code: codeMethodNotFound, Message: "method not found: " + method + "; this server has initialize, ping, tools/list and tools/call"}
}

// initialize agrees a protocol version: the client's when the server
// speaks it, else the newest the server does.
func (s *server) initialize(params json.RawMessage) (any, *rpcError) {
	var p struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	if len(params) > 0 {
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, &rpcError{Code: codeInvalidParams, Message: "invalid initialize params: " + err.Error()}
		}
	}
	s.version = Versions[0]
	if slices.Contains(Versions, p.ProtocolVersion) {
		s.version = p.ProtocolVersion
	}
	return map[string]any{
		"protocolVersion": s.version,
		"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
		"serverInfo":      map[string]any{"name": "starboard", "title": "Starboard", "version": s.opts.Version},
		"instructions":    instructions,
	}, nil
}

// callTool runs a tool. An unknown tool is a protocol error; a tool that
// fails returns a result marked isError, which the model sees.
func (s *server) callTool(params json.RawMessage) (any, *rpcError) {
	var p struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(params, &p); err != nil || p.Name == "" {
		return nil, &rpcError{Code: codeInvalidParams, Message: `invalid tools/call params: they need a "name" and optional "arguments"`}
	}
	t, ok := s.tool(p.Name)
	if !ok {
		return nil, &rpcError{Code: codeInvalidParams, Message: "unknown tool: " + p.Name + "; tools/list names the tools"}
	}
	out, err := t.run(s, p.Arguments)
	if err != nil {
		_, _ = fmt.Fprintf(s.log, "starboard mcp: %s: error: %v\n", p.Name, err)
		return toolResult{Content: []content{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}
	_, _ = fmt.Fprintf(s.log, "starboard mcp: %s: ok\n", p.Name)
	if s.version < structuredSince {
		out.Structured = nil
	}
	return out, nil
}

// toolResult is a tools/call result.
type toolResult struct {
	Content    []content       `json:"content"`
	Structured json.RawMessage `json:"structuredContent,omitempty"`
	IsError    bool            `json:"isError,omitempty"`
}

// content is one item of a result: text, or an image as base64 data.
type content struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	Data     string `json:"data,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
}
