// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package schema

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.yaml.in/yaml/v3"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/registry"
)

// compile compiles the named embedded schema.
func compile(t *testing.T, name string) *jsonschema.Schema {
	t.Helper()
	data, ok := Get(name)
	require.True(t, ok, name)
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(data))
	require.NoError(t, err)
	c := jsonschema.NewCompiler()
	url := "https://starboard.c65llc.com/schema/v1/" + name + ".json"
	require.NoError(t, c.AddResource(url, doc))
	sch, err := c.Compile(url)
	require.NoError(t, err)
	return sch
}

// validate reports whether the YAML src validates against sch.
func validate(t *testing.T, sch *jsonschema.Schema, src string) error {
	t.Helper()
	var v any
	require.NoError(t, yaml.Unmarshal([]byte(src), &v), src)
	return sch.Validate(v)
}

// parseErrors returns the parser's diagnostics for src.
func parseErrors(name, src string) []diag.Diagnostic {
	if name == "config" {
		_, ds := config.Parse([]byte(src))
		return ds
	}
	_, ds := registry.Parse([]byte(src))
	return ds
}

func TestGet(t *testing.T) {
	for _, name := range Names {
		data, ok := Get(name)
		require.True(t, ok, name)
		var doc map[string]any
		require.NoError(t, json.Unmarshal(data, &doc), name)
		assert.Equal(t, "https://json-schema.org/draft/2020-12/schema", doc["$schema"])
		assert.Equal(t, "https://starboard.c65llc.com/schema/v1/"+name+".json", doc["$id"])
		assert.True(t, bytes.HasSuffix(data, []byte("}\n")), "%s ends with a newline", name)
		assert.NotContains(t, string(data), "\r")

		// Get returns a copy: changing it does not change the next call.
		data[0] = 'X'
		again, _ := Get(name)
		assert.Equal(t, byte('{'), again[0])
	}
	assert.Equal(t, []string{"config", "screens"}, Names)
	_, ok := Get("flows")
	assert.False(t, ok)
}

// TestSchemasValidateFixtures validates every valid fixture and every spec
// example against its schema, and checks the parser accepts each too.
func TestSchemasValidateFixtures(t *testing.T) {
	projects := os.DirFS(filepath.Join("..", "testdata", "projects"))
	files := map[string]string{
		"config":  "valid/starboard.yaml",
		"screens": "valid/docs/flows/screens.yaml",
	}
	for name, path := range files {
		src, err := fs.ReadFile(projects, path)
		require.NoError(t, err)
		require.Empty(t, parseErrors(name, string(src)), path)
		assert.NoError(t, validate(t, compile(t, name), string(src)), path)
	}

	empty, err := fs.ReadFile(projects, "empty/docs/flows/screens.yaml")
	require.NoError(t, err)
	assert.NoError(t, validate(t, compile(t, "screens"), string(empty)))

	for name, src := range specExamples(t) {
		require.Empty(t, parseErrors(name, src), "spec example for %s:\n%s", name, src)
		assert.NoError(t, validate(t, compile(t, name), src), "spec example for %s", name)
	}
}

// specExamples returns the spec's starboard.yaml and screens.yaml examples:
// the first yaml block under each heading. The screens example elides two
// lists as [...] and [ ... ]; they become empty lists.
func specExamples(t *testing.T) map[string]string {
	t.Helper()
	spec, err := fs.ReadFile(os.DirFS(filepath.Join("..", "..", "docs", "specs")), "2026-11-26-starboard-design.md")
	require.NoError(t, err)
	text := strings.ReplaceAll(string(spec), "\r\n", "\n")
	block := func(heading string) string {
		_, after, ok := strings.Cut(text, "\n"+heading+"\n")
		require.True(t, ok, heading)
		_, after, ok = strings.Cut(after, "```yaml\n")
		require.True(t, ok, heading)
		body, _, ok := strings.Cut(after, "\n```")
		require.True(t, ok, heading)
		return body + "\n"
	}
	elided := regexp.MustCompile(`\[ ?\.\.\. ?\]`)
	return map[string]string{
		"config":  block("### `starboard.yaml`"),
		"screens": elided.ReplaceAllString(block("### The registry: `screens.yaml`"), "[]"),
	}
}

func TestSchemasRejectBadKind(t *testing.T) {
	src := "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - {region: x, kind: widget}\n"
	assert.Error(t, validate(t, compile(t, "screens"), src))
	ds := parseErrors("screens", src)
	require.Len(t, ds, 1)
	assert.Equal(t, "unknown-kind", ds[0].Rule)
}

// agreement cases: the schema and the parser must agree on each.
var agreement = []struct {
	name, schema, src string
	valid             bool
}{
	// starboard.yaml
	{"minimal config", "config", "version: 1\n", true},
	{"empty config", "config", "", false},
	{"config not a mapping", "config", "- 1\n", false},
	{"version missing", "config", "content: docs\n", false},
	{"version 2", "config", "version: 2\n", false},
	{"version string", "config", "version: \"1\"\n", false},
	{"unknown top key", "config", "version: 1\ncolour: blue\n", false},
	{"empty content", "config", "version: 1\ncontent: \"\"\n", false},
	{"content number", "config", "version: 1\ncontent: 3\n", false},
	{"null sections", "config", "version: 1\nplatforms:\nformFactors:\nvocabularies:\nareas:\nlint:\n", true},
	{"null platform", "config", "version: 1\nplatforms:\n  ios:\n", true},
	{"platform fields", "config", "version: 1\nplatforms:\n  ios: {formFactors: [phone], roots: [src], screenFiles: ['**/*View.swift']}\n", true},
	{"platform unknown key", "config", "version: 1\nplatforms:\n  ios: {files: [a]}\n", false},
	{"platform roots not list", "config", "version: 1\nplatforms:\n  ios: {roots: src}\n", false},
	{"platform empty root", "config", "version: 1\nplatforms:\n  ios: {roots: [\"\"]}\n", false},
	{"form factor", "config", "version: 1\nformFactors:\n  watch: {width: 200, height: 240}\n", true},
	{"form factor missing height", "config", "version: 1\nformFactors:\n  watch: {width: 200}\n", false},
	{"form factor zero width", "config", "version: 1\nformFactors:\n  watch: {width: 0, height: 1}\n", false},
	{"form factor float", "config", "version: 1\nformFactors:\n  watch: {width: 1.5, height: 1}\n", false},
	{"form factor null", "config", "version: 1\nformFactors:\n  watch:\n", false},
	{"form factor extra key", "config", "version: 1\nformFactors:\n  watch: {width: 1, height: 1, depth: 1}\n", false},
	{"vocabulary", "config", "version: 1\nvocabularies:\n  requires: {file: caps.json, select: \".caps[].name\"}\n", true},
	{"vocabulary missing select", "config", "version: 1\nvocabularies:\n  requires: {file: caps.json}\n", false},
	{"areas", "config", "version: 1\nareas: [a, b]\n", true},
	{"duplicate area", "config", "version: 1\nareas: [a, a]\n", false},
	{"area number", "config", "version: 1\nareas: [1]\n", false},
	{"area on two lines", "config", "version: 1\nareas: [\"a\\nb\"]\n", false},
	{"lint rules and limits", "config", "version: 1\nlint:\n  rules: {orphan-screen: off, missing-purpose: error}\n  limits: {label-too-long: 20}\n", true},
	{"lint correctness rule", "config", "version: 1\nlint:\n  rules: {file-missing: warn}\n", false},
	{"lint unknown rule", "config", "version: 1\nlint:\n  rules: {nope: warn}\n", false},
	{"lint bad severity", "config", "version: 1\nlint:\n  rules: {orphan-screen: loud}\n", false},
	{"lint unknown limit", "config", "version: 1\nlint:\n  limits: {width: 3}\n", false},
	{"lint zero limit", "config", "version: 1\nlint:\n  limits: {deep-nesting: 0}\n", false},
	{"lint unknown key", "config", "version: 1\nlint:\n  strict: true\n", false},

	// screens.yaml
	{"empty registry", "screens", "", true},
	{"null screens", "screens", "screens:\nunmapped:\n", true},
	{"registry not a mapping", "screens", "- a\n", false},
	{"unknown registry key", "screens", "flows: {}\n", false},
	{"screens not a mapping", "screens", "screens: [a]\n", false},
	{"minimal screen", "screens", "screens:\n  a.b: {title: A, area: a, presentation: root}\n", true},
	{"null screen", "screens", "screens:\n  a.b:\n", false},
	{"bad screen ID", "screens", "screens:\n  Home: {title: A, area: a, presentation: root}\n", false},
	{"missing title", "screens", "screens:\n  a.b: {area: a, presentation: root}\n", false},
	{"unknown presentation", "screens", "screens:\n  a.b: {title: A, area: a, presentation: modal}\n", false},
	{"unknown screen key", "screens", "screens:\n  a.b: {title: A, area: a, presentation: root, owner: me}\n", false},
	{"status per platform", "screens", "screens:\n  a.b: {title: A, area: a, presentation: root, status: {ios: shipped, android: proposed}}\n", true},
	{"status bad", "screens", "screens:\n  a.b: {title: A, area: a, presentation: root, status: done}\n", false},
	{"status null", "screens", "screens:\n  a.b: {title: A, area: a, presentation: root, status: }\n", false},
	{"status per platform bad", "screens", "screens:\n  a.b: {title: A, area: a, presentation: root, status: {ios: done}}\n", false},
	{"screen lists and maps", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    platforms: [ios]\n    states: [empty]\n    files: {ios: [A.swift]}\n    screenshots: {ios: a.png}\n    platformNote: iOS only\n    purpose: Why.\n", true},
	{"files not lists", "screens", "screens:\n  a.b: {title: A, area: a, presentation: root, files: {ios: A.swift}}\n", false},
	{"screenshot list", "screens", "screens:\n  a.b: {title: A, area: a, presentation: root, screenshots: {ios: [a.png]}}\n", false},
	{"layout not a list", "screens", "screens:\n  a.b: {title: A, area: a, presentation: root, layout: {region: x}}\n", false},
	{"region missing name", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - {kind: text}\n", false},
	{"region missing kind", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - {region: x}\n", false},
	{"region bad name", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - {region: Top, kind: text}\n", false},
	{"region unknown key", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - {region: x, kind: text, colour: red}\n", false},
	{"region null", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      -\n", false},
	{"region fields", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - {region: x, kind: action, label: Go, to: c.d, requires: edit, status: proposed, platformNote: n}\n", true},
	{"region bad status", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - {region: x, kind: text, status: maybe}\n", false},
	{"row widths", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - region: r\n        kind: row\n        children:\n          - {region: x, kind: nav, width: 240}\n          - {region: y, kind: column, width: \"2/3\"}\n", true},
	{"width zero", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - {region: x, kind: text, width: 0}\n", false},
	{"width percent", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - {region: x, kind: text, width: 50%}\n", false},
	{"child without name", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - region: r\n        kind: column\n        children:\n          - {kind: text}\n", false},
	{"children on text", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - region: r\n        kind: text\n        children: []\n", false},
	{"list item and empty", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - region: l\n        kind: list\n        item: {kind: card, label: Row, to: c.d}\n        empty: {label: Nothing}\n", true},
	{"item on card", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - region: l\n        kind: card\n        item: {kind: card}\n", false},
	{"empty on card", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - region: l\n        kind: card\n        empty: {label: None}\n", false},
	{"empty without label", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - region: l\n        kind: list\n        empty: {}\n", false},
	{"empty null", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - region: l\n        kind: list\n        empty:\n", false},
	{"item null", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - region: l\n        kind: list\n        item:\n", false},
	{"nav items", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - region: t\n        kind: tabs\n        items:\n          - {label: One, to: c.d, requires: x, status: proposed}\n", true},
	{"items on list", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - region: t\n        kind: list\n        items: []\n", false},
	{"nav item without label", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - region: t\n        kind: menu\n        items:\n          - {to: c.d}\n", false},
	{"nav item unknown key", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n      - region: t\n        kind: nav\n        items:\n          - {label: A, region: x}\n", false},
	{"layouts", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layouts:\n      web-wide:\n        - {region: x, kind: text}\n", true},
	{"layouts not a mapping", "screens", "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layouts: [a]\n", false},
	{"unmapped", "screens", "unmapped:\n  - {path: a/B.swift, reason: part of a.b}\n", true},
	{"unmapped missing reason", "screens", "unmapped:\n  - {path: a/B.swift}\n", false},
	{"unmapped null entry", "screens", "unmapped:\n  -\n", false},
	{"unmapped not a list", "screens", "unmapped: {path: a}\n", false},
}

func TestSchemasAgreeWithParsers(t *testing.T) {
	schemas := map[string]*jsonschema.Schema{"config": compile(t, "config"), "screens": compile(t, "screens")}
	for _, tc := range agreement {
		t.Run(tc.name, func(t *testing.T) {
			ds := parseErrors(tc.schema, tc.src)
			assert.Equal(t, tc.valid, len(ds) == 0, "parser: %v", ds)
			err := validate(t, schemas[tc.schema], tc.src)
			if tc.valid {
				assert.NoError(t, err)
			} else {
				assert.Error(t, err)
			}
		})
	}
}

// TestVocabulariesMatchCode pins the schemas' enums to the parsers' tables.
func TestVocabulariesMatchCode(t *testing.T) {
	var cfg, scr map[string]any
	data, _ := Get("config")
	require.NoError(t, json.Unmarshal(data, &cfg))
	data, _ = Get("screens")
	require.NoError(t, json.Unmarshal(data, &scr))

	defs := func(doc map[string]any) map[string]any { return doc["$defs"].(map[string]any) }
	enum := func(v any) []string {
		var out []string
		for _, s := range v.(map[string]any)["enum"].([]any) {
			out = append(out, s.(string))
		}
		slices.Sort(out)
		return out
	}

	assert.Equal(t, slices.Sorted(maps.Keys(diag.QualityRules)), enum(defs(cfg)["qualityRule"]))
	limits := defs(cfg)["limits"].(map[string]any)["properties"].(map[string]any)
	assert.Equal(t, slices.Sorted(maps.Keys(config.DefaultLimits)), slices.Sorted(maps.Keys(limits)))

	assert.Equal(t, slices.Sorted(maps.Keys(registry.Kinds)), enum(defs(scr)["kind"]))
	assert.Equal(t, slices.Sorted(maps.Keys(registry.Presentations)), enum(defs(scr)["presentation"]))
	assert.Equal(t, slices.Sorted(maps.Keys(registry.Containers)), enum(defs(scr)["container"]))
	assert.Equal(t, slices.Sorted(maps.Keys(registry.NavKinds)), enum(defs(scr)["navKind"]))
	assert.Equal(t, []string{registry.Proposed, registry.Shipped}, enum(defs(scr)["status"]))

	pattern := func(def string) string { return defs(scr)[def].(map[string]any)["pattern"].(string) }
	assert.Equal(t, registry.IDPattern.String(), pattern("screenID"))
	assert.Equal(t, registry.RegionPattern.String(), pattern("regionName"))
}
