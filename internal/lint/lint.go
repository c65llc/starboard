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
	// Generated is every file generate would write, as Options gives it.
	Generated map[string][]byte
}

// Rule is one registered check. Default is its severity when the config says
// nothing: always error for a correctness rule. Summary is one sentence
// saying what it catches, as `starboard rules` and the rule's page give it.
// Run returns the rule's findings; Run sets their severities, so a rule need
// not. A rule with no Run is found while loading the project, by the config,
// registry or flow parser, and reaches lint as a load diagnostic.
type Rule struct {
	ID      string
	Default diag.Severity
	Summary string
	Run     func(p *project.Project, c *Context) []diag.Diagnostic
}

// Kind is "correctness" for a correctness rule and "quality" for a quality
// rule.
func (r Rule) Kind() string {
	if diag.CorrectnessRules[r.ID] {
		return "correctness"
	}
	return "quality"
}

// Docs is the rule's documentation page.
func (r Rule) Docs() string { return diag.DocsURL(r.ID) }

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
	loaded("config-invalid", "starboard.yaml breaks the config schema, such as a missing version, an unknown key or a value of the wrong type."),
	loaded("yaml-syntax", "starboard.yaml or screens.yaml cannot be read as one YAML document."),
	loaded("yaml-alias-not-allowed", "A YAML file or a flow's front matter uses an anchor, an alias or a merge key."),
	loaded("schema-invalid", "screens.yaml breaks the registry schema, such as a missing required field, an unknown key or a value of the wrong type."),
	loaded("id-invalid", "A screen ID or a region name does not have the required form."),
	loaded("duplicate-screen", "screens.yaml defines the same screen ID twice."),
	loaded("duplicate-region", "A region name is used twice in one layout tree."),
	loaded("unknown-kind", "A region's kind is not one of the kinds the renderer knows."),
	loaded("unknown-presentation", "A screen's presentation is not root, push, tab, sheet, dialog, window or route."),
	loaded("flow-frontmatter-invalid", "A flow's front matter is missing, never closed, or breaks the flow schema."),
	correctness("unknown-platform", "A screen names a platform that starboard.yaml does not configure.", ruleUnknownPlatform),
	correctness("unknown-form-factor", "A platform or a layout override names a form factor that is not defined.", ruleUnknownFormFactor),
	correctness("unknown-area", "A screen's area is not listed under areas in starboard.yaml.", ruleUnknownArea),
	correctness("platform-note-missing", "A screen on only some of the configured platforms has no platformNote saying why.", rulePlatformNoteMissing),
	correctness("edge-unresolved", "A to link names a screen that is not registered.", ruleEdgeUnresolved),
	correctness("edge-platform-mismatch", "A to link joins two screens that share no platform, and the linking node has no platformNote.", ruleEdgePlatformMismatch),
	correctness("status-conflict", "A region or nav item says shipped under a screen that is proposed.", ruleStatusConflict),
	correctness("ref-unresolved", "A flow's entry or @ reference names a screen or region that does not exist.", ruleRefUnresolved),
	correctness("flow-id-mismatch", "A flow's id does not match its file name.", ruleFlowIDMismatch),
	correctness("shipped-flow-proposed-ref", "A shipped flow refers to a screen or region that is proposed on one of the flow's platforms.", ruleShippedFlowProposedRef),
	correctness("vocabulary-source-invalid", "A vocabulary in starboard.yaml cannot be used, because its field is unsupported, its file cannot be read or its selector does not apply.", ruleVocabularySourceInvalid),
	correctness("vocabulary-unknown", "A requires value is not in the project's requires vocabulary.", ruleVocabularyUnknown),
	correctness("path-invalid", "A path or pattern in starboard.yaml or screens.yaml is not a relative path inside the project.", rulePathInvalid),
	correctness("file-missing", "A platform root, or a file a screen claims on a platform where it is shipped, does not exist.", ruleFileMissing),
	correctness("screenshot-missing", "A screenshot named in screens.yaml does not exist.", ruleScreenshotMissing),
	correctness("unregistered-screen-file", "A file matching a platform's screenFiles is claimed by no screen and not listed under unmapped.", ruleUnregisteredScreenFile),
	correctness("unmapped-and-claimed", "A file is listed under unmapped and also claimed by a screen.", ruleUnmappedAndClaimed),
	correctness("not-formatted", "A source file is not in the canonical form starboard fmt writes.", ruleNotFormatted),
	correctness("generated-stale", "A file starboard generate owns is out of date, missing, or no longer generated.", ruleGeneratedStale),
	quality("unreachable-screen", "No other screen links to a screen, it is not presentation root, and no flow starts there.", ruleUnreachableScreen),
	quality("orphan-screen", "No flow references a screen.", ruleOrphanScreen),
	quality("missing-purpose", "A screen has no purpose.", ruleMissingPurpose),
	quality("label-too-long", "A region or nav item label is longer than the limit, 40 characters by default.", ruleLabelTooLong),
	quality("flow-ref-not-in-diagram", "A flow refers to a screen that its Mermaid diagram does not show.", ruleFlowRefNotInDiagram),
	quality("duplicate-edge", "Two links to the same screen sit under the same parent in one layout.", ruleDuplicateEdge),
	quality("deep-nesting", "A layout nests regions deeper than the limit, 5 levels by default.", ruleDeepNesting),
	quality("edge-parity", "A form factor's layout override drops a link that the default layout has.", ruleEdgeParity),
	quality("step-without-ref", "A flow step has no @screen reference saying where it happens.", ruleStepWithoutRef),
}

func correctness(id, summary string, run func(*project.Project, *Context) []diag.Diagnostic) Rule {
	return Rule{ID: id, Default: diag.Error, Summary: summary, Run: run}
}

// loaded registers a correctness rule the project loader reports.
func loaded(id, summary string) Rule {
	return Rule{ID: id, Default: diag.Error, Summary: summary}
}

// Rules returns every rule, sorted by ID, the ones the loader reports
// included.
func Rules() []Rule {
	out := slices.Clone(allRules)
	slices.SortFunc(out, func(a, b Rule) int { return cmp.Compare(a.ID, b.ID) })
	return out
}

// Run lints p. It merges loadDiags (the diagnostics project.Load returned)
// with every rule's findings, gives each finding its effective severity —
// error for a correctness rule, Config.Rules for a quality rule — drops those
// that are off, links each to its rule's page (Diagnostic.Docs), sorts, and
// counts. When p is nil (starboard.yaml did not
// parse) only loadDiags are reported.
func Run(p *project.Project, loadDiags []diag.Diagnostic, opts Options) Result {
	_ = opts.Strict // the caller decides the exit code from it
	return run(p, loadDiags, Rules(), opts.Generated)
}

func run(p *project.Project, loadDiags []diag.Diagnostic, rules []Rule, generated map[string][]byte) Result {
	all := slices.Clone(loadDiags)
	if p != nil {
		ctx := &Context{Limits: p.Config.Limits, Generated: generated}
		for _, r := range rules {
			if r.Run == nil {
				continue // the loader reports it, in loadDiags
			}
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
		d.Docs = diag.DocsURL(d.Rule)
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
