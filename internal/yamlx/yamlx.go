// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package yamlx holds the hand-walking helpers Starboard's YAML parsers
// share: decoding one document safely, and reading mappings, strings and
// string lists while reporting problems as diag.Diagnostics with lines and
// dotted, indexed paths.
package yamlx

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"

	"go.yaml.in/yaml/v3"

	"github.com/c65llc/starboard/internal/diag"
)

// Decode reads data as exactly one YAML document and returns its root node,
// which is a zero Node for an empty document. It returns nil and the
// diagnostics when the YAML cannot be read or holds a second document
// (yaml-syntax), or uses anchors, aliases or merge keys
// (yaml-alias-not-allowed). Every diagnostic names file.
func Decode(data []byte, file string) (*yaml.Node, []diag.Diagnostic) {
	doc, ds := DecodeDocument(data, file)
	if doc == nil {
		return nil, ds
	}
	if doc.Kind == yaml.DocumentNode && len(doc.Content) > 0 {
		return doc.Content[0], nil
	}
	return &yaml.Node{}, nil
}

// DecodeDocument is Decode, but returns the document node itself, which
// holds the comments before and after the root. It has no Content when the
// document is empty.
func DecodeDocument(data []byte, file string) (*yaml.Node, []diag.Diagnostic) {
	p := Parser{File: file}
	dec := yaml.NewDecoder(bytes.NewReader(data))
	var doc yaml.Node
	if err := dec.Decode(&doc); err != nil && !errors.Is(err, io.EOF) {
		p.syntax(syntaxLine(err.Error()), err.Error())
		return nil, p.Diags
	}
	var next yaml.Node
	switch err := dec.Decode(&next); {
	case err == nil:
		p.syntax(next.Line, fmt.Sprintf("%s must hold one YAML document; a second starts on line %d", file, next.Line))
		return nil, p.Diags
	case !errors.Is(err, io.EOF):
		p.syntax(syntaxLine(err.Error()), err.Error())
		return nil, p.Diags
	}
	if p.rejectAliases(&doc); len(p.Diags) > 0 {
		diag.Sort(p.Diags)
		return nil, p.Diags
	}
	return &doc, nil
}

func (p *Parser) syntax(line int, msg string) {
	p.Diags = append(p.Diags, diag.Diagnostic{
		Rule:     "yaml-syntax",
		Severity: diag.Error,
		File:     p.File,
		Line:     line,
		Message:  msg,
	})
}

var lineRE = regexp.MustCompile(`line (\d+)`)

// syntaxLine pulls the line number out of a yaml error message, or 0.
func syntaxLine(msg string) int {
	m := lineRE.FindStringSubmatch(msg)
	if m == nil {
		return 0
	}
	n, _ := strconv.Atoi(m[1])
	return n
}

// rejectAliases reports every anchor, alias and merge key under n. They are
// never expanded, so an alias bomb costs nothing.
func (p *Parser) rejectAliases(n *yaml.Node) {
	switch {
	case n.Kind == yaml.AliasNode:
		p.Report("yaml-alias-not-allowed", n, "", "aliases are not allowed (*%s)", n.Value)
	case n.Anchor != "":
		p.Report("yaml-alias-not-allowed", n, "", "anchors are not allowed (&%s)", n.Anchor)
	case n.Tag == "!!merge":
		p.Report("yaml-alias-not-allowed", n, "", "merge keys are not allowed")
	}
	if n.Kind == yaml.AliasNode {
		return
	}
	for _, c := range n.Content {
		p.rejectAliases(c)
	}
}

// IsNull reports whether n is absent or an explicit null.
func IsNull(n *yaml.Node) bool {
	return n == nil || n.Kind == 0 || (n.Kind == yaml.ScalarNode && n.Tag == "!!null")
}

// Join appends key to the dotted path.
func Join(path, key string) string {
	if path == "" {
		return key
	}
	return path + "." + key
}

// Parser accumulates diagnostics for one file. Invalid is the rule a schema
// problem is reported under, such as config-invalid or schema-invalid.
type Parser struct {
	File    string
	Invalid string
	Diags   []diag.Diagnostic
}

// Report records an error under rule at n's line.
func (p *Parser) Report(rule string, n *yaml.Node, path, format string, args ...any) {
	p.Diags = append(p.Diags, diag.Diagnostic{
		Rule:     rule,
		Severity: diag.Error,
		File:     p.File,
		Path:     path,
		Line:     n.Line,
		Message:  fmt.Sprintf(format, args...),
	})
}

// Invalidf records a schema problem under p.Invalid.
func (p *Parser) Invalidf(n *yaml.Node, path, format string, args ...any) {
	p.Report(p.Invalid, n, path, format, args...)
}

// Entry is one key/value pair of a mapping. Field is the value's dotted path.
type Entry struct {
	Key   string
	K, V  *yaml.Node
	Field string
}

// Mapping returns n's entries in order, reporting duplicate keys and, when
// allowed is not nil, keys it does not hold; neither is returned. ok is
// false if n is neither a mapping nor null. A null is an empty mapping.
func (p *Parser) Mapping(n *yaml.Node, path string, allowed map[string]bool) ([]Entry, bool) {
	if IsNull(n) {
		return nil, true
	}
	if n.Kind != yaml.MappingNode {
		name := path
		if name == "" {
			name = p.File
		}
		p.Invalidf(n, path, "%s must be a mapping", name)
		return nil, false
	}
	seen := map[string]bool{}
	var out []Entry
	for i := 0; i+1 < len(n.Content); i += 2 {
		k, v := n.Content[i], n.Content[i+1]
		field := Join(path, k.Value)
		if seen[k.Value] {
			p.Invalidf(k, field, "duplicate key %s", k.Value)
			continue
		}
		seen[k.Value] = true
		if allowed != nil && !allowed[k.Value] {
			p.Invalidf(k, field, "unknown key %s", k.Value)
			continue
		}
		out = append(out, Entry{Key: k.Value, K: k, V: v, Field: field})
	}
	return out, true
}

// Str returns n's value if it is a non-empty string.
func (p *Parser) Str(n *yaml.Node, path string) (string, bool) {
	if n.Kind != yaml.ScalarNode || n.Tag != "!!str" {
		p.Invalidf(n, path, "%s must be a string", path)
		return "", false
	}
	if n.Value == "" {
		p.Invalidf(n, path, "%s must not be empty", path)
		return "", false
	}
	return n.Value, true
}

// Item is one valid string of a list, with its node and indexed path.
type Item struct {
	Value string
	Node  *yaml.Node
	Path  string
}

// StrList returns the valid items of n, a list of strings; a null is empty.
func (p *Parser) StrList(n *yaml.Node, path string) []Item {
	if IsNull(n) {
		return nil
	}
	if n.Kind != yaml.SequenceNode {
		p.Invalidf(n, path, "%s must be a list of strings", path)
		return nil
	}
	var out []Item
	for i, c := range n.Content {
		ip := fmt.Sprintf("%s[%d]", path, i)
		if s, ok := p.Str(c, ip); ok {
			out = append(out, Item{Value: s, Node: c, Path: ip})
		}
	}
	return out
}

// Values returns the strings of items.
func Values(items []Item) []string {
	var out []string
	for _, it := range items {
		out = append(out, it.Value)
	}
	return out
}
