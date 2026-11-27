// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package config parses starboard.yaml into a Config, filling in defaults
// and reporting every problem as a diag.Diagnostic with a line number.
package config

import (
	"maps"

	"go.yaml.in/yaml/v3"

	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/yamlx"
)

// FileName is the project file's name; diagnostics from Parse carry it.
const FileName = "starboard.yaml"

// DefaultContent is the content root when starboard.yaml names none.
const DefaultContent = "docs/flows"

// FormFactor is a viewport size in points.
type FormFactor struct{ Width, Height int }

// Platform is one platform's form factors and the source files that hold
// its screens.
type Platform struct{ FormFactors, Roots, ScreenFiles []string }

// Vocabulary names a project file and a selector that lists the values a
// registry field may take.
type Vocabulary struct{ File, Select string }

// Config is a parsed starboard.yaml with defaults applied.
type Config struct {
	Version       int
	Content       string
	Platforms     map[string]Platform
	PlatformOrder []string // platform keys in the order they are written
	FormFactors   map[string]FormFactor
	Vocabularies  map[string]Vocabulary
	Areas         []string
	Rules         map[string]diag.Severity // every quality rule's effective severity
	Limits        map[string]int
}

// DefaultFormFactors are the built-in form factors. A project's formFactors
// override and extend them.
var DefaultFormFactors = map[string]FormFactor{
	"phone":      {390, 844},
	"tablet":     {820, 1180},
	"desktop":    {1280, 800},
	"web-narrow": {390, 844},
	"web-wide":   {1440, 900},
}

// DefaultLimits are the quality rules' limits; lint.limits overrides them.
var DefaultLimits = map[string]int{
	"label-too-long": 40,
	"deep-nesting":   5,
}

// parser accumulates diagnostics while walking the document.
type parser struct {
	yamlx.Parser
}

// Parse reads starboard.yaml. The Config is nil only when the YAML itself
// cannot be read or holds more than one document (yaml-syntax), or uses
// anchors, aliases or merge keys (yaml-alias-not-allowed); a schema problem
// is reported as config-invalid or unknown-form-factor and the rest of the
// file is still parsed. The diagnostics are sorted.
func Parse(data []byte) (*Config, []diag.Diagnostic) {
	root, ds := yamlx.Decode(data, FileName)
	if root == nil {
		return nil, ds
	}
	p := parser{yamlx.Parser{File: FileName, Invalid: "config-invalid"}}
	cfg := &Config{
		Content:      DefaultContent,
		Platforms:    map[string]Platform{},
		FormFactors:  maps.Clone(DefaultFormFactors),
		Vocabularies: map[string]Vocabulary{},
		Rules:        maps.Clone(diag.QualityRules),
		Limits:       maps.Clone(DefaultLimits),
	}
	p.root(root, cfg)
	diag.Sort(p.Diags)
	return cfg, p.Diags
}

// positive returns n's value if it is an integer above zero.
func (p *parser) positive(n *yaml.Node, path string) (int, bool) {
	var v int
	if n.Kind != yaml.ScalarNode || n.Tag != "!!int" || n.Decode(&v) != nil || v <= 0 {
		p.Invalidf(n, path, "%s must be a positive integer", path)
		return 0, false
	}
	return v, true
}

var topKeys = map[string]bool{
	"version": true, "content": true, "platforms": true, "formFactors": true,
	"vocabularies": true, "areas": true, "lint": true,
}

func (p *parser) root(n *yaml.Node, cfg *Config) {
	entries, ok := p.Mapping(n, "", topKeys)
	if !ok {
		return
	}
	// formFactors first, so platforms can be checked against the merged set.
	var platforms *yamlx.Entry
	hasVersion := false
	for i := range entries {
		e := &entries[i]
		switch e.Key {
		case "version":
			hasVersion = true
			p.version(e, cfg)
		case "content":
			if s, ok := p.Str(e.V, e.Field); ok {
				cfg.Content = s
			}
		case "platforms":
			platforms = e
		case "formFactors":
			p.formFactors(e, cfg)
		case "vocabularies":
			p.vocabularies(e, cfg)
		case "areas":
			p.areas(e, cfg)
		case "lint":
			p.lint(e, cfg)
		}
	}
	if !hasVersion {
		p.Invalidf(n, "", "version is required")
	}
	if platforms != nil {
		p.platforms(platforms, cfg)
	}
}

func (p *parser) version(e *yamlx.Entry, cfg *Config) {
	var v int
	if e.V.Kind != yaml.ScalarNode || e.V.Tag != "!!int" || e.V.Decode(&v) != nil {
		p.Invalidf(e.V, e.Field, "version must be an integer")
		return
	}
	if v != 1 {
		p.Invalidf(e.V, e.Field, "unsupported version %d; this Starboard reads version 1", v)
		return
	}
	cfg.Version = v
}

var platformKeys = map[string]bool{"formFactors": true, "roots": true, "screenFiles": true}

func (p *parser) platforms(e *yamlx.Entry, cfg *Config) {
	entries, _ := p.Mapping(e.V, e.Field, nil)
	for _, pe := range entries {
		cfg.PlatformOrder = append(cfg.PlatformOrder, pe.Key)
		fields, ok := p.Mapping(pe.V, pe.Field, platformKeys)
		if !ok {
			continue
		}
		var plat Platform
		for _, f := range fields {
			switch f.Key {
			case "formFactors":
				items := p.StrList(f.V, f.Field)
				plat.FormFactors = yamlx.Values(items)
				for _, it := range items {
					if _, known := cfg.FormFactors[it.Value]; !known {
						p.Report("unknown-form-factor", it.Node, it.Path,
							"unknown form factor %s; define it under formFactors", it.Value)
					}
				}
			case "roots":
				plat.Roots = yamlx.Values(p.StrList(f.V, f.Field))
			case "screenFiles":
				plat.ScreenFiles = yamlx.Values(p.StrList(f.V, f.Field))
			}
		}
		cfg.Platforms[pe.Key] = plat
	}
}

var formFactorKeys = map[string]bool{"width": true, "height": true}

func (p *parser) formFactors(e *yamlx.Entry, cfg *Config) {
	entries, _ := p.Mapping(e.V, e.Field, nil)
	for _, fe := range entries {
		fields, ok := p.Mapping(fe.V, fe.Field, formFactorKeys)
		if !ok {
			continue
		}
		got := map[string]int{}
		valid := true
		for _, f := range fields {
			v, ok := p.positive(f.V, f.Field)
			valid = valid && ok
			got[f.Key] = v
		}
		for _, k := range []string{"width", "height"} {
			if _, present := got[k]; !present && valid {
				p.Invalidf(fe.V, fe.Field, "%s.%s is required", fe.Field, k)
				valid = false
			}
		}
		if valid {
			cfg.FormFactors[fe.Key] = FormFactor{Width: got["width"], Height: got["height"]}
		}
	}
}

var vocabularyKeys = map[string]bool{"file": true, "select": true}

func (p *parser) vocabularies(e *yamlx.Entry, cfg *Config) {
	entries, _ := p.Mapping(e.V, e.Field, nil)
	for _, ve := range entries {
		fields, ok := p.Mapping(ve.V, ve.Field, vocabularyKeys)
		if !ok {
			continue
		}
		got := map[string]string{}
		valid := true
		for _, f := range fields {
			s, ok := p.Str(f.V, f.Field)
			valid = valid && ok
			got[f.Key] = s
		}
		for _, k := range []string{"file", "select"} {
			if _, present := got[k]; !present && valid {
				p.Invalidf(ve.V, ve.Field, "%s.%s is required", ve.Field, k)
				valid = false
			}
		}
		if valid {
			cfg.Vocabularies[ve.Key] = Vocabulary{File: got["file"], Select: got["select"]}
		}
	}
}

func (p *parser) areas(e *yamlx.Entry, cfg *Config) {
	seen := map[string]bool{}
	for _, it := range p.StrList(e.V, e.Field) {
		if seen[it.Value] {
			p.Invalidf(it.Node, it.Path, "duplicate area %s", it.Value)
			continue
		}
		seen[it.Value] = true
		cfg.Areas = append(cfg.Areas, it.Value)
	}
}

var lintKeys = map[string]bool{"rules": true, "limits": true}

func (p *parser) lint(e *yamlx.Entry, cfg *Config) {
	fields, _ := p.Mapping(e.V, e.Field, lintKeys)
	for _, f := range fields {
		switch f.Key {
		case "rules":
			p.rules(&f, cfg)
		case "limits":
			p.limits(&f, cfg)
		}
	}
}

func (p *parser) rules(e *yamlx.Entry, cfg *Config) {
	entries, _ := p.Mapping(e.V, e.Field, nil)
	for _, re := range entries {
		switch {
		case diag.CorrectnessRules[re.Key]:
			p.Invalidf(re.K, re.Field, "%s is a correctness rule and cannot be configured", re.Key)
			continue
		case diag.QualityRules[re.Key] == "":
			p.Invalidf(re.K, re.Field, "unknown rule %s", re.Key)
			continue
		}
		sev := diag.Severity(re.V.Value)
		if re.V.Kind != yaml.ScalarNode || (sev != diag.Error && sev != diag.Warn && sev != diag.Off) {
			p.Invalidf(re.V, re.Field, "%s severity must be error, warn or off", re.Key)
			continue
		}
		cfg.Rules[re.Key] = sev
	}
}

func (p *parser) limits(e *yamlx.Entry, cfg *Config) {
	entries, _ := p.Mapping(e.V, e.Field, nil)
	for _, le := range entries {
		if _, known := DefaultLimits[le.Key]; !known {
			p.Invalidf(le.K, le.Field, "unknown limit %s", le.Key)
			continue
		}
		if v, ok := p.positive(le.V, le.Field); ok {
			cfg.Limits[le.Key] = v
		}
	}
}
