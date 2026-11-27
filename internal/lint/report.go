// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package lint

import (
	"encoding/json"
	"io"

	"github.com/c65llc/starboard/internal/diag"
)

// RuleEntry is one rule in the rules --json report.
type RuleEntry struct {
	ID      string        `json:"id"`
	Kind    string        `json:"kind"`
	Default diag.Severity `json:"default"`
	Summary string        `json:"summary"`
	Docs    string        `json:"docs"`
}

// RulesReport is the rules --json report: {"version":1,"rules":[…]}, every
// rule sorted by ID.
type RulesReport struct {
	Version int         `json:"version"`
	Rules   []RuleEntry `json:"rules"`
}

// Report builds the rules --json report.
func Report() RulesReport {
	rules := Rules()
	report := RulesReport{Version: 1, Rules: make([]RuleEntry, len(rules))}
	for i, r := range rules {
		report.Rules[i] = RuleEntry{ID: r.ID, Kind: r.Kind(), Default: r.Default, Summary: r.Summary, Docs: r.Docs()}
	}
	return report
}

// WriteRulesJSON writes Report as `starboard rules --json` prints it: a
// two-space indent, no HTML escaping and a trailing newline.
func WriteRulesJSON(w io.Writer) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	return enc.Encode(Report())
}
