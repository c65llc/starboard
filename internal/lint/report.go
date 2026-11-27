// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package lint

import (
	"encoding/json"
	"io"

	"github.com/c65llc/starboard/internal/diag"
)

// ruleEntry is one rule in the rules --json report.
type ruleEntry struct {
	ID      string        `json:"id"`
	Kind    string        `json:"kind"`
	Default diag.Severity `json:"default"`
	Summary string        `json:"summary"`
	Docs    string        `json:"docs"`
}

// rulesReport is the rules --json report: {"version":1,"rules":[…]}, every
// rule sorted by ID.
type rulesReport struct {
	Version int         `json:"version"`
	Rules   []ruleEntry `json:"rules"`
}

// report builds the rules --json report.
func report() rulesReport {
	rules := Rules()
	out := rulesReport{Version: 1, Rules: make([]ruleEntry, len(rules))}
	for i, r := range rules {
		out.Rules[i] = ruleEntry{ID: r.ID, Kind: r.Kind(), Default: r.Default, Summary: r.Summary, Docs: r.Docs()}
	}
	return out
}

// WriteRulesJSON writes report as `starboard rules --json` prints it: a
// two-space indent, no HTML escaping and a trailing newline.
func WriteRulesJSON(w io.Writer) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	return enc.Encode(report())
}
