// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/diag"
)

const minimal = `version: 1
platforms:
  ios:
    formFactors: [phone]
`

func TestParseMinimal(t *testing.T) {
	cfg, ds := Parse([]byte(minimal))
	require.Empty(t, ds)
	require.NotNil(t, cfg)
	assert.Equal(t, 1, cfg.Version)
	assert.Equal(t, "docs/flows", cfg.Content)
	assert.Equal(t, FormFactor{390, 844}, cfg.FormFactors["phone"])
	assert.Equal(t, DefaultFormFactors, cfg.FormFactors)
	assert.Equal(t, []string{"ios"}, cfg.PlatformOrder)
	assert.Equal(t, Platform{FormFactors: []string{"phone"}}, cfg.Platforms["ios"])
	assert.Equal(t, map[string]int{"label-too-long": 40, "deep-nesting": 5}, cfg.Limits)
	assert.Equal(t, diag.QualityRules, cfg.Rules)
}

func TestParseFull(t *testing.T) {
	src := `version: 1
content: docs/screens
platforms:
  web:
    formFactors: [web-narrow, web-wide]
    roots: [apps/web/src/routes]
    screenFiles: ["**/+page.svelte"]
  ios:
    formFactors: [phone, watch]
    roots: [shells/apple]
    screenFiles: ["**/*View.swift"]
  android:
formFactors:
  watch: { width: 200, height: 240 }
vocabularies:
  requires:
    file: core/capabilities.json
    select: ".capabilities[].name"
areas: [auth, home]
lint:
  rules:
    orphan-screen: off
    edge-parity: error
  limits:
    label-too-long: 30
`
	cfg, ds := Parse([]byte(src))
	require.Empty(t, ds)
	assert.Equal(t, "docs/screens", cfg.Content)
	assert.Equal(t, []string{"web", "ios", "android"}, cfg.PlatformOrder)
	assert.Equal(t, Platform{
		FormFactors: []string{"phone", "watch"},
		Roots:       []string{"shells/apple"},
		ScreenFiles: []string{"**/*View.swift"},
	}, cfg.Platforms["ios"])
	assert.Equal(t, Platform{}, cfg.Platforms["android"])
	assert.Equal(t, FormFactor{200, 240}, cfg.FormFactors["watch"])
	assert.Equal(t, FormFactor{1440, 900}, cfg.FormFactors["web-wide"])
	assert.Equal(t, map[string]Vocabulary{"requires": {File: "core/capabilities.json", Select: ".capabilities[].name"}}, cfg.Vocabularies)
	assert.Equal(t, []string{"auth", "home"}, cfg.Areas)
	assert.Equal(t, diag.Off, cfg.Rules["orphan-screen"])
	assert.Equal(t, diag.Error, cfg.Rules["edge-parity"])
	assert.Equal(t, diag.Warn, cfg.Rules["missing-purpose"])
	assert.Equal(t, map[string]int{"label-too-long": 30, "deep-nesting": 5}, cfg.Limits)
}

func TestParseOverridesFormFactor(t *testing.T) {
	src := minimal + "formFactors:\n  phone: { width: 375, height: 667 }\n"
	cfg, ds := Parse([]byte(src))
	require.Empty(t, ds)
	assert.Equal(t, FormFactor{375, 667}, cfg.FormFactors["phone"])
	assert.Equal(t, FormFactor{820, 1180}, cfg.FormFactors["tablet"])
	// The package default is not mutated.
	assert.Equal(t, FormFactor{390, 844}, DefaultFormFactors["phone"])
}

func TestParseUnknownVersion(t *testing.T) {
	_, ds := Parse([]byte("version: 2\n"))
	require.Len(t, ds, 1)
	assert.Equal(t, "config-invalid", ds[0].Rule)
	assert.Equal(t, diag.Error, ds[0].Severity)
	assert.Equal(t, "starboard.yaml", ds[0].File)
	assert.Equal(t, "version", ds[0].Path)
	assert.Equal(t, 1, ds[0].Line)
}

func TestParseUnknownFormFactorOnPlatform(t *testing.T) {
	_, ds := Parse([]byte("version: 1\nplatforms:\n  ios:\n    formFactors: [wristwatch]\n"))
	require.Len(t, ds, 1)
	assert.Equal(t, "unknown-form-factor", ds[0].Rule)
	assert.Equal(t, "platforms.ios.formFactors[0]", ds[0].Path)
	assert.Equal(t, 4, ds[0].Line)
	assert.Contains(t, ds[0].Message, "wristwatch")
}

func TestRulesSeverity(t *testing.T) {
	cfg, ds := Parse([]byte(minimal + "lint:\n  rules:\n    orphan-screen: off\n"))
	require.Empty(t, ds)
	assert.Equal(t, diag.Off, cfg.Rules["orphan-screen"])
	// Setting a rule never mutates the package defaults.
	assert.Equal(t, diag.Warn, diag.QualityRules["orphan-screen"])
}

func TestRulesRejectCorrectness(t *testing.T) {
	_, ds := Parse([]byte(minimal + "lint:\n  rules:\n    file-missing: off\n"))
	require.Len(t, ds, 1)
	assert.Equal(t, "config-invalid", ds[0].Rule)
	assert.Equal(t, "file-missing is a correctness rule and cannot be configured", ds[0].Message)
	assert.Equal(t, "lint.rules.file-missing", ds[0].Path)
	assert.Equal(t, 7, ds[0].Line)
}

func TestParseSyntaxError(t *testing.T) {
	cfg, ds := Parse([]byte("version: 1\nplatforms: [\n"))
	assert.Nil(t, cfg)
	require.Len(t, ds, 1)
	assert.Equal(t, "yaml-syntax", ds[0].Rule)
	assert.Equal(t, "starboard.yaml", ds[0].File)
	assert.Positive(t, ds[0].Line)
}

func TestParseRejectsAliases(t *testing.T) {
	for name, src := range map[string]string{
		"anchor and alias": "version: 1\nareas: &a [x]\ncontent: *a\n",
		"merge key":        "version: 1\nformFactors:\n  base: &b { width: 1, height: 2 }\n  big:\n    <<: *b\n",
	} {
		t.Run(name, func(t *testing.T) {
			cfg, ds := Parse([]byte(src))
			assert.Nil(t, cfg)
			require.NotEmpty(t, ds)
			for _, d := range ds {
				assert.Equal(t, "yaml-alias-not-allowed", d.Rule)
				assert.Positive(t, d.Line)
			}
		})
	}
}

func TestParseInvalid(t *testing.T) {
	cases := []struct {
		name, src, rule, path, msg string
	}{
		{"empty document", "", "config-invalid", "", "version is required"},
		{"not a mapping", "- 1\n", "config-invalid", "", "starboard.yaml must be a mapping"},
		{"missing version", "content: x\n", "config-invalid", "", "version is required"},
		{"version not int", "version: one\n", "config-invalid", "version", "version must be an integer"},
		{"unknown top-level key", "version: 1\nscreens: x\n", "config-invalid", "screens", "unknown key screens"},
		{"duplicate key", "version: 1\nversion: 1\n", "config-invalid", "version", "duplicate key version"},
		{"content not string", "version: 1\ncontent: [a]\n", "config-invalid", "content", "content must be a string"},
		{"content empty", "version: 1\ncontent: \"\"\n", "config-invalid", "content", "content must not be empty"},
		{"platforms not mapping", "version: 1\nplatforms: [ios]\n", "config-invalid", "platforms", "platforms must be a mapping"},
		{"platform not mapping", "version: 1\nplatforms:\n  ios: phone\n", "config-invalid", "platforms.ios", "platforms.ios must be a mapping"},
		{"platform unknown key", "version: 1\nplatforms:\n  ios:\n    files: []\n", "config-invalid", "platforms.ios.files", "unknown key files"},
		{"platform list not sequence", "version: 1\nplatforms:\n  ios:\n    roots: a\n", "config-invalid", "platforms.ios.roots", "platforms.ios.roots must be a list of strings"},
		{"platform list item not string", "version: 1\nplatforms:\n  ios:\n    roots: [[a]]\n", "config-invalid", "platforms.ios.roots[0]", "platforms.ios.roots[0] must be a string"},
		{"form factors not mapping", "version: 1\nformFactors: [a]\n", "config-invalid", "formFactors", "formFactors must be a mapping"},
		{"form factor not mapping", "version: 1\nformFactors:\n  phone: 3\n", "config-invalid", "formFactors.phone", "formFactors.phone must be a mapping"},
		{"form factor unknown key", "version: 1\nformFactors:\n  phone: { width: 1, height: 2, depth: 3 }\n", "config-invalid", "formFactors.phone.depth", "unknown key depth"},
		{"form factor missing height", "version: 1\nformFactors:\n  phone: { width: 1 }\n", "config-invalid", "formFactors.phone", "formFactors.phone.height is required"},
		{"form factor zero width", "version: 1\nformFactors:\n  phone: { width: 0, height: 2 }\n", "config-invalid", "formFactors.phone.width", "formFactors.phone.width must be a positive integer"},
		{"form factor width not int", "version: 1\nformFactors:\n  phone: { width: wide, height: 2 }\n", "config-invalid", "formFactors.phone.width", "formFactors.phone.width must be a positive integer"},
		{"vocabularies not mapping", "version: 1\nvocabularies: 1\n", "config-invalid", "vocabularies", "vocabularies must be a mapping"},
		{"vocabulary not mapping", "version: 1\nvocabularies:\n  requires: x\n", "config-invalid", "vocabularies.requires", "vocabularies.requires must be a mapping"},
		{"vocabulary missing select", "version: 1\nvocabularies:\n  requires: { file: a.json }\n", "config-invalid", "vocabularies.requires", "vocabularies.requires.select is required"},
		{"vocabulary unknown key", "version: 1\nvocabularies:\n  requires: { file: a.json, select: .a, jq: x }\n", "config-invalid", "vocabularies.requires.jq", "unknown key jq"},
		{"vocabulary file not string", "version: 1\nvocabularies:\n  requires: { file: [a], select: .a }\n", "config-invalid", "vocabularies.requires.file", "vocabularies.requires.file must be a string"},
		{"vocabulary file empty", "version: 1\nvocabularies:\n  requires: { file: \"\", select: .a }\n", "config-invalid", "vocabularies.requires.file", "vocabularies.requires.file must not be empty"},
		{"areas not sequence", "version: 1\nareas: auth\n", "config-invalid", "areas", "areas must be a list of strings"},
		{"area not string", "version: 1\nareas: [1]\n", "config-invalid", "areas[0]", "areas[0] must be a string"},
		{"duplicate area", "version: 1\nareas: [a, a]\n", "config-invalid", "areas[1]", "duplicate area a"},
		{"lint not mapping", "version: 1\nlint: x\n", "config-invalid", "lint", "lint must be a mapping"},
		{"lint unknown key", "version: 1\nlint:\n  strict: true\n", "config-invalid", "lint.strict", "unknown key strict"},
		{"rules not mapping", "version: 1\nlint:\n  rules: [a]\n", "config-invalid", "lint.rules", "lint.rules must be a mapping"},
		{"unknown rule", "version: 1\nlint:\n  rules:\n    shiny: off\n", "config-invalid", "lint.rules.shiny", "unknown rule shiny"},
		{"bad severity", "version: 1\nlint:\n  rules:\n    orphan-screen: info\n", "config-invalid", "lint.rules.orphan-screen", "orphan-screen severity must be error, warn or off"},
		{"limits not mapping", "version: 1\nlint:\n  limits: 3\n", "config-invalid", "lint.limits", "lint.limits must be a mapping"},
		{"unknown limit", "version: 1\nlint:\n  limits:\n    width: 3\n", "config-invalid", "lint.limits.width", "unknown limit width"},
		{"limit not positive", "version: 1\nlint:\n  limits:\n    deep-nesting: -1\n", "config-invalid", "lint.limits.deep-nesting", "lint.limits.deep-nesting must be a positive integer"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg, ds := Parse([]byte(tc.src))
			require.NotNil(t, cfg, "a schema problem still yields a config")
			require.Len(t, ds, 1, "%v", ds)
			d := ds[0]
			assert.Equal(t, tc.rule, d.Rule)
			assert.Equal(t, diag.Error, d.Severity)
			assert.Equal(t, "starboard.yaml", d.File)
			assert.Equal(t, tc.path, d.Path)
			assert.Equal(t, tc.msg, d.Message)
		})
	}
}

func TestParseReportsEveryProblemSorted(t *testing.T) {
	src := "version: 3\nareas: [1]\nextra: x\n"
	_, ds := Parse([]byte(src))
	require.Len(t, ds, 3)
	assert.Equal(t, []int{1, 2, 3}, []int{ds[0].Line, ds[1].Line, ds[2].Line})
}

func TestParseNullSectionsAreEmpty(t *testing.T) {
	cfg, ds := Parse([]byte("version: 1\nplatforms:\nformFactors:\nvocabularies:\nareas:\nlint:\n"))
	require.Empty(t, ds)
	assert.Empty(t, cfg.Platforms)
	assert.Empty(t, cfg.PlatformOrder)
	assert.Equal(t, DefaultFormFactors, cfg.FormFactors)
	assert.Empty(t, cfg.Areas)
}

func TestParseCRLF(t *testing.T) {
	lf, lfDiags := Parse([]byte("version: 1\nplatforms:\n  ios:\n    formFactors: [wristwatch]\n"))
	crlf, crlfDiags := Parse([]byte("version: 1\r\nplatforms:\r\n  ios:\r\n    formFactors: [wristwatch]\r\n"))
	assert.Equal(t, lf, crlf)
	assert.Equal(t, lfDiags, crlfDiags)
}

func TestParseRejectsSecondDocument(t *testing.T) {
	cfg, ds := Parse([]byte(minimal + "---\nversion: 1\n"))
	assert.Nil(t, cfg)
	require.Len(t, ds, 1)
	assert.Equal(t, "yaml-syntax", ds[0].Rule)
	assert.Equal(t, "starboard.yaml", ds[0].File)
	assert.Equal(t, 5, ds[0].Line)
}
