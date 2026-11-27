// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package lint runs Starboard's rules over a loaded project. Each rule is a
// small function registered by ID; Run merges their findings with the load
// diagnostics, applies the configured severities and sorts the result.
package lint

import (
	"cmp"
	"slices"

	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/project"
)

// Context is what every rule receives besides the project.
type Context struct {
	// Limits are the configured numeric limits, keyed by rule ID.
	Limits map[string]int
}

// Rule is one registered check. Default is its severity when the config says
// nothing: always error for a correctness rule. Run returns the rule's
// findings; Run sets their severities, so a rule need not.
type Rule struct {
	ID      string
	Default diag.Severity
	Run     func(p *project.Project, c *Context) []diag.Diagnostic
}

// Options adjust a lint run. Strict is for the caller, which treats
// warnings as failures; it does not change severities. Generated is the
// freshly generated output that generated-stale compares against; when it is
// nil that rule is skipped.
type Options struct {
	Strict    bool
	Generated map[string][]byte
}

// Result is a lint run's sorted diagnostics and how many are errors and
// warnings.
type Result struct {
	Diagnostics []diag.Diagnostic
	Errors      int
	Warnings    int
}

// allRules is every rule, in no particular order; Rules sorts it.
var allRules = []Rule{
	correctness("unknown-platform", ruleUnknownPlatform),
	correctness("unknown-form-factor", ruleUnknownFormFactor),
	correctness("unknown-area", ruleUnknownArea),
	correctness("platform-note-missing", rulePlatformNoteMissing),
	correctness("edge-unresolved", ruleEdgeUnresolved),
	correctness("edge-platform-mismatch", ruleEdgePlatformMismatch),
	correctness("status-conflict", ruleStatusConflict),
	correctness("ref-unresolved", ruleRefUnresolved),
	correctness("flow-id-mismatch", ruleFlowIDMismatch),
	correctness("shipped-flow-proposed-ref", ruleShippedFlowProposedRef),
	correctness("vocabulary-source-invalid", ruleVocabularySourceInvalid),
	correctness("vocabulary-unknown", ruleVocabularyUnknown),
	correctness("path-invalid", rulePathInvalid),
	correctness("file-missing", ruleFileMissing),
	correctness("screenshot-missing", ruleScreenshotMissing),
	correctness("unregistered-screen-file", ruleUnregisteredScreenFile),
	correctness("unmapped-and-claimed", ruleUnmappedAndClaimed),
	correctness("not-formatted", ruleNotFormatted),
}

func correctness(id string, run func(*project.Project, *Context) []diag.Diagnostic) Rule {
	return Rule{ID: id, Default: diag.Error, Run: run}
}

// Rules returns every registered rule, sorted by ID.
func Rules() []Rule {
	out := slices.Clone(allRules)
	slices.SortFunc(out, func(a, b Rule) int { return cmp.Compare(a.ID, b.ID) })
	return out
}

// Run lints p. It merges loadDiags (the diagnostics project.Load returned)
// with every rule's findings, gives each finding its effective severity —
// error for a correctness rule, Config.Rules for a quality rule — drops those
// that are off, sorts, and counts. When p is nil (starboard.yaml did not
// parse) only loadDiags are reported.
func Run(p *project.Project, loadDiags []diag.Diagnostic, opts Options) Result {
	_ = opts.Strict // the caller decides the exit code from it
	return run(p, loadDiags, Rules())
}

func run(p *project.Project, loadDiags []diag.Diagnostic, rules []Rule) Result {
	all := slices.Clone(loadDiags)
	if p != nil {
		ctx := &Context{Limits: p.Config.Limits}
		for _, r := range rules {
			sev := severity(p, r)
			for _, d := range r.Run(p, ctx) {
				d.Severity = sev
				all = append(all, d)
			}
		}
	}
	res := Result{Diagnostics: []diag.Diagnostic{}}
	for _, d := range all {
		switch d.Severity {
		case diag.Off:
			continue
		case diag.Error:
			res.Errors++
		case diag.Warn:
			res.Warnings++
		}
		res.Diagnostics = append(res.Diagnostics, d)
	}
	diag.Sort(res.Diagnostics)
	return res
}

// severity is r's effective severity in p.
func severity(p *project.Project, r Rule) diag.Severity {
	if diag.CorrectnessRules[r.ID] {
		return diag.Error
	}
	if s, ok := p.Config.Rules[r.ID]; ok {
		return s
	}
	return r.Default
}
