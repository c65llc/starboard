// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package diag holds the findings every Starboard command reports, the fixed
// table of rule IDs, and the text and JSON reporters.
package diag

import (
	"cmp"
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"strings"
)

// Severity is how serious a finding is.
type Severity string

// The severities a rule can have. Off silences a quality rule.
const (
	Error Severity = "error"
	Warn  Severity = "warn"
	Off   Severity = "off"
)

// Fix describes a safe automatic fix for a finding.
type Fix struct {
	Description string `json:"description"`
}

// Diagnostic is one finding. File is relative to the project root and uses
// "/". Path locates the value inside the file in dotted, indexed form, such
// as "platforms.ios.formFactors[0]". Line is 1-based; 0 means unknown. Docs
// is the rule's documentation page, DocsURL(Rule); lint sets it on every
// finding it reports.
type Diagnostic struct {
	Rule     string   `json:"rule"`
	Severity Severity `json:"severity"`
	File     string   `json:"file"`
	Path     string   `json:"path"`
	Line     int      `json:"line,omitempty"`
	Message  string   `json:"message"`
	Fix      *Fix     `json:"fix,omitempty"`
	Docs     string   `json:"docs,omitempty"`
}

// docsBase is where the rule pages are published, one directory per rule.
const docsBase = "https://starboard.c65llc.com/rules/"

// DocsURL is the documentation page of the rule with the given ID.
func DocsURL(rule string) string { return docsBase + rule + "/" }

// CorrectnessRules is the set of correctness rule IDs. They are always errors
// and cannot be configured.
var CorrectnessRules = map[string]bool{
	"config-invalid":            true,
	"yaml-syntax":               true,
	"yaml-alias-not-allowed":    true,
	"schema-invalid":            true,
	"id-invalid":                true,
	"duplicate-screen":          true,
	"duplicate-region":          true,
	"unknown-kind":              true,
	"unknown-presentation":      true,
	"unknown-platform":          true,
	"unknown-form-factor":       true,
	"unknown-area":              true,
	"platform-note-missing":     true,
	"edge-unresolved":           true,
	"edge-platform-mismatch":    true,
	"path-invalid":              true,
	"file-missing":              true,
	"screenshot-missing":        true,
	"unregistered-screen-file":  true,
	"unmapped-and-claimed":      true,
	"ref-unresolved":            true,
	"flow-frontmatter-invalid":  true,
	"flow-id-mismatch":          true,
	"status-conflict":           true,
	"shipped-flow-proposed-ref": true,
	"vocabulary-source-invalid": true,
	"vocabulary-unknown":        true,
	"not-formatted":             true,
	"generated-stale":           true,
}

// QualityRules maps each quality rule ID to its default severity. A project
// may change a quality rule's severity under lint.rules in starboard.yaml.
var QualityRules = map[string]Severity{
	"unreachable-screen":      Warn,
	"orphan-screen":           Warn,
	"missing-purpose":         Warn,
	"label-too-long":          Warn,
	"flow-ref-not-in-diagram": Warn,
	"duplicate-edge":          Warn,
	"deep-nesting":            Warn,
	"edge-parity":             Warn,
	"step-without-ref":        Warn,
}

// Sort orders ds by File, Line, Rule, Path, then Message.
func Sort(ds []Diagnostic) {
	slices.SortStableFunc(ds, func(a, b Diagnostic) int {
		return cmp.Or(
			strings.Compare(a.File, b.File),
			cmp.Compare(a.Line, b.Line),
			strings.Compare(a.Rule, b.Rule),
			strings.Compare(a.Path, b.Path),
			strings.Compare(a.Message, b.Message),
		)
	})
}

// sorted returns a sorted copy of ds, leaving the caller's slice untouched.
func sorted(ds []Diagnostic) []Diagnostic {
	out := slices.Clone(ds)
	Sort(out)
	return out
}

// WriteText writes ds in sorted order, one per line, as
// "file:line: severity rule: message (path)". The ":line" part is left out
// when the line is unknown, and " (path)" when the path is empty.
func WriteText(w io.Writer, ds []Diagnostic) {
	var b strings.Builder
	for _, d := range sorted(ds) {
		b.WriteString(d.File)
		if d.Line > 0 {
			fmt.Fprintf(&b, ":%d", d.Line)
		}
		fmt.Fprintf(&b, ": %s %s: %s", d.Severity, d.Rule, d.Message)
		if d.Path != "" {
			fmt.Fprintf(&b, " (%s)", d.Path)
		}
		b.WriteByte('\n')
	}
	_, _ = io.WriteString(w, b.String())
}

// report is the JSON document WriteJSON emits.
type report struct {
	Version  int          `json:"version"`
	Errors   []Diagnostic `json:"errors"`
	Warnings []Diagnostic `json:"warnings"`
}

// WriteJSON writes ds as {"version":1,"errors":[…],"warnings":[…]} with a
// two-space indent, each list in sorted order. Findings at Off are dropped.
func WriteJSON(w io.Writer, ds []Diagnostic) error {
	r := report{Version: 1, Errors: []Diagnostic{}, Warnings: []Diagnostic{}}
	for _, d := range sorted(ds) {
		switch d.Severity {
		case Error:
			r.Errors = append(r.Errors, d)
		case Warn:
			r.Warnings = append(r.Warnings, d)
		}
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	return enc.Encode(r)
}
