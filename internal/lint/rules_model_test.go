// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package lint

import (
	"maps"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/project"
)

const (
	cfgFile    = "starboard.yaml"
	screensYML = "docs/flows/screens.yaml"
	flowFile   = "docs/flows/flows/add-activity.md"
)

// baseConfig configures ios and web, two areas and a requires vocabulary.
const baseConfig = `version: 1
platforms:
  ios:
    formFactors: [phone]
  web:
    formFactors: [web-wide]
vocabularies:
  requires:
    file: caps.json
    select: .capabilities[].name
areas: [trip, activity]
`

// baseScreens is a registry every model rule accepts, in canonical form.
const baseScreens = `screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    status: shipped
    files:
      ios: [a.swift]
    screenshots:
      ios: a.png
    layout:
      - region: tabs
        kind: tabs
        items:
          - {label: Timeline, to: trip.timeline, requires: view}
      - {region: add, kind: primary-action, label: Add, to: activity.editor, requires: edit}
    layouts:
      web-wide:
        - region: shell
          kind: row
          children:
            - region: side
              kind: nav
              platformNote: web adds in place
              items:
                - {label: Add, to: activity.editor}
  activity.editor:
    title: Editor
    area: activity
    presentation: sheet
    status:
      ios: shipped
    platforms: [ios]
    platformNote: iOS only for now
    layout:
      - {region: form, kind: form, status: shipped}
`

const baseFlow = `---
id: add-activity
title: Add an activity
status: shipped
entry: trip.timeline
platforms: [ios]
---

1. Tap @trip.timeline#add.
2. Fill @activity.editor#form.
3. Or use @trip.timeline#side on the web.
`

func base() map[string]string {
	return map[string]string{
		cfgFile:     baseConfig,
		screensYML:  baseScreens,
		flowFile:    baseFlow,
		"caps.json": `{"capabilities":[{"name":"edit"},{"name":"view"}]}`,
		"a.swift":   "// a\n",
		"a.png":     "png",
	}
}

// with returns the base project with files replaced; an empty value deletes.
func with(files map[string]string) map[string]string {
	out := base()
	for k, v := range files {
		if v == "" {
			delete(out, k)
			continue
		}
		out[k] = v
	}
	return out
}

// mkProject loads files as a project and fails the test on load diagnostics.
func mkProject(t *testing.T, files map[string]string) *project.Project {
	t.Helper()
	fsys := project.MemFS{}
	for name, data := range files {
		fsys[name] = []byte(data)
	}
	p, ds, err := project.Load(fsys)
	require.NoError(t, err)
	require.Empty(t, ds, "fixture should load cleanly")
	require.NotNil(t, p)
	return p
}

// at is the part of a diagnostic each rule test pins.
type at struct {
	File string
	Line int
	Path string
}

func rule(t *testing.T, id string) Rule {
	t.Helper()
	for _, r := range Rules() {
		if r.ID == id {
			return r
		}
	}
	t.Fatalf("rule %s is not registered", id)
	return Rule{}
}

type ruleCase struct {
	name  string
	files map[string]string
	want  []at
}

// runRule runs the rule id over each case and checks every diagnostic's
// rule, file, line and path. The base fixture must produce none.
func runRule(t *testing.T, id string, cases []ruleCase) {
	t.Helper()
	r := rule(t, id)
	cases = append([]ruleCase{{name: "valid fixture"}}, cases...)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := mkProject(t, with(tc.files))
			ds := r.Run(p, &Context{Limits: p.Config.Limits})
			diag.Sort(ds)
			var got []at
			for _, d := range ds {
				assert.Equal(t, id, d.Rule)
				assert.NotEmpty(t, d.Message)
				got = append(got, at{d.File, d.Line, d.Path})
			}
			assert.Equal(t, tc.want, got)
		})
	}
}

// screen is a one-screen registry header; callers append fields at four spaces.
const screen = `screens:
  a.one:
    title: A
    area: trip
    presentation: root
`

func TestRule_unknown_platform(t *testing.T) {
	runRule(t, "unknown-platform", []ruleCase{
		{
			name: "platforms, status, files and screenshots keys",
			files: map[string]string{screensYML: screen + `    platformNote: n
    platforms: [ios, tv]
    status: { ios: shipped, watch: proposed }
    files: { ios: [x], tv: [y] }
    screenshots: { car: z }
`},
			want: []at{
				{screensYML, 2, "screens.a.one.files.tv"},
				{screensYML, 2, "screens.a.one.platforms[1]"},
				{screensYML, 2, "screens.a.one.screenshots.car"},
				{screensYML, 2, "screens.a.one.status.watch"},
			},
		},
	})
}

func TestRule_unknown_form_factor(t *testing.T) {
	runRule(t, "unknown-form-factor", []ruleCase{
		{
			name: "layouts key",
			files: map[string]string{screensYML: screen + `    layouts:
      phone: [{ region: a, kind: text }]
      watchface: [{ region: a, kind: text }]
`},
			want: []at{{screensYML, 2, "screens.a.one.layouts.watchface"}},
		},
	})
}

func TestRule_unknown_area(t *testing.T) {
	runRule(t, "unknown-area", []ruleCase{
		{
			name:  "area not configured",
			files: map[string]string{screensYML: "screens:\n  a.one:\n    title: A\n    area: nowhere\n    presentation: root\n"},
			want:  []at{{screensYML, 2, "screens.a.one.area"}},
		},
	})
}

func TestRule_platform_note_missing(t *testing.T) {
	runRule(t, "platform-note-missing", []ruleCase{
		{
			name:  "subset without a note",
			files: map[string]string{screensYML: screen + "    platforms: [ios]\n"},
			want:  []at{{screensYML, 2, "screens.a.one.platforms"}},
		},
		{
			name:  "every platform needs no note",
			files: map[string]string{screensYML: screen + "    platforms: [web, ios]\n"},
		},
		{
			name:  "subset with a note",
			files: map[string]string{screensYML: screen + "    platforms: [web]\n    platformNote: web first\n"},
		},
	})
}

func TestRule_edge_unresolved(t *testing.T) {
	runRule(t, "edge-unresolved", []ruleCase{
		{
			name: "region, list item and nav item",
			files: map[string]string{screensYML: screen + `    layout:
      - { region: go, kind: action, to: no.where }
      - region: things
        kind: list
        item: { kind: card, to: no.thing }
    layouts:
      web-wide:
        - region: side
          kind: nav
          items:
            - { label: Fine, to: a.one }
            - { label: Bad, to: also.missing }
`},
			want: []at{
				{screensYML, 7, "screens.a.one.layout[0]"},
				{screensYML, 10, "screens.a.one.layout[1].item"},
				{screensYML, 17, "screens.a.one.layouts.web-wide[0].items[1]"},
			},
		},
	})
}

// twoScreens has a.one on web and b.two on ios.
const twoScreens = `screens:
  b.two:
    title: B
    area: trip
    presentation: root
    platforms: [ios]
    platformNote: ios only
  a.one:
    title: A
    area: trip
    presentation: root
    platforms: [web]
    platformNote: web only
    layout:
`

func TestRule_edge_platform_mismatch(t *testing.T) {
	runRule(t, "edge-platform-mismatch", []ruleCase{
		{
			name: "region and nav item without a note",
			files: map[string]string{screensYML: twoScreens + `      - { region: go, kind: action, to: b.two }
      - { region: noted, kind: action, to: b.two, platformNote: opens the ios app }
      - region: menu
        kind: menu
        items: [{ label: B, to: b.two }]
      - { region: dangling, kind: action, to: no.where }
`},
			want: []at{
				{screensYML, 15, "screens.a.one.layout[0]"},
				{screensYML, 19, "screens.a.one.layout[2].items[0]"},
			},
		},
		{
			name: "a screen without platforms is on every platform",
			files: map[string]string{screensYML: twoScreens + `      - { region: go, kind: action, to: c.three }
  c.three:
    title: C
    area: trip
    presentation: root
`},
		},
	})
}

func TestRule_status_conflict(t *testing.T) {
	runRule(t, "status-conflict", []ruleCase{
		{
			name: "shipped region and nav item under a proposed platform",
			files: map[string]string{screensYML: screen + `    status: { web: proposed }
    layout:
      - { region: ok, kind: text, status: proposed }
      - { region: bad, kind: text, status: shipped }
    layouts:
      web-wide:
        - region: tabs
          kind: tabs
          items:
            - { label: X, status: shipped }
            - { label: Y }
`},
			want: []at{
				{screensYML, 9, "screens.a.one.layout[1]"},
				{screensYML, 15, "screens.a.one.layouts.web-wide[0].items[0]"},
			},
		},
		{
			name: "proposed for every platform",
			files: map[string]string{screensYML: screen + `    status: proposed
    platforms: [ios]
    platformNote: n
    layout:
      - { region: bad, kind: text, status: shipped }
`},
			want: []at{{screensYML, 10, "screens.a.one.layout[0]"}},
		},
		{
			name: "proposed on a platform the screen is not on",
			files: map[string]string{screensYML: screen + `    status: { web: proposed }
    platforms: [ios]
    platformNote: n
    layout:
      - { region: fine, kind: text, status: shipped }
`},
		},
	})
}

// flow builds a flow file from front matter lines and a body.
func flow(front, body string) string {
	return "---\n" + front + "---\n\n" + body
}

func TestRule_ref_unresolved(t *testing.T) {
	front := "id: add-activity\ntitle: T\nstatus: proposed\nentry: no.entry\n"
	runRule(t, "ref-unresolved", []ruleCase{
		{
			name: "unknown entry, screen and region",
			files: map[string]string{flowFile: flow(front,
				"1. Open @no.screen.\n2. Tap @trip.timeline#nope.\n3. Use @trip.timeline#side and @trip.timeline.\n")},
			want: []at{
				{flowFile, 5, "entry"},
				{flowFile, 8, ""},
				{flowFile, 9, ""},
			},
		},
		{
			name: "a second flow file is checked too",
			files: map[string]string{"docs/flows/flows/b.md": flow("id: b\ntitle: T\nstatus: proposed\nentry: trip.timeline\n",
				"See @x.y#z.\n")},
			want: []at{{"docs/flows/flows/b.md", 8, ""}},
		},
	})
}

func TestRule_flow_id_mismatch(t *testing.T) {
	runRule(t, "flow-id-mismatch", []ruleCase{
		{
			name: "id differs from the file stem",
			files: map[string]string{flowFile: flow("title: T\nstatus: shipped\n\nid: something-else\nentry: trip.timeline\n",
				"Nothing.\n")},
			want: []at{{flowFile, 5, "id"}},
		},
	})
}

func TestRule_shipped_flow_proposed_ref(t *testing.T) {
	screens := `screens:
  p.screen:
    title: P
    area: trip
    presentation: root
    status: { web: proposed }
  s.screen:
    title: S
    area: trip
    presentation: root
    layout:
      - { region: ok, kind: text }
    layouts:
      web-wide:
        - { region: new, kind: text, status: proposed }
`
	shipped := func(platforms, entry string) string {
		return "id: add-activity\ntitle: T\nstatus: shipped\nentry: " + entry + "\n" + platforms
	}
	body := "1. @p.screen\n2. @s.screen#new\n3. @s.screen#ok\n4. @x.unknown\n5. @s.screen#gone\n"
	runRule(t, "shipped-flow-proposed-ref", []ruleCase{
		{
			name:  "web flow sees the proposed screen and region",
			files: map[string]string{screensYML: screens, flowFile: flow(shipped("platforms: [web]\n", "p.screen"), body)},
			want: []at{
				{flowFile, 5, "entry"},
				{flowFile, 9, ""},
				{flowFile, 10, ""},
			},
		},
		{
			name:  "a flow without platforms uses every platform",
			files: map[string]string{screensYML: screens, flowFile: flow(shipped("", "s.screen"), body)},
			want: []at{
				{flowFile, 8, ""},
				{flowFile, 9, ""},
			},
		},
		{
			name:  "ios flow sees nothing proposed",
			files: map[string]string{screensYML: screens, flowFile: flow(shipped("platforms: [ios]\n", "p.screen"), body)},
		},
		{
			name: "a proposed flow may reference proposed screens",
			files: map[string]string{screensYML: screens, flowFile: flow(
				"id: add-activity\ntitle: T\nstatus: proposed\nentry: p.screen\n", body)},
		},
	})
}

// vocab replaces the requires vocabulary's file and selector.
func vocab(file, sel string) string {
	return `version: 1
platforms:
  ios:
    formFactors: [phone]
  web:
    formFactors: [web-wide]
vocabularies:
  requires:
    file: ` + file + `
    select: ` + sel + `
areas: [trip, activity]
`
}

func TestRule_vocabulary_source_invalid(t *testing.T) {
	const sel = ".capabilities[].name"
	runRule(t, "vocabulary-source-invalid", []ruleCase{
		{
			name:  "missing file",
			files: map[string]string{cfgFile: vocab("gone.json", sel)},
			want:  []at{{cfgFile, 9, "vocabularies.requires.file"}},
		},
		{
			name:  "unsupported extension",
			files: map[string]string{cfgFile: vocab("caps.txt", sel), "caps.txt": "edit\n"},
			want:  []at{{cfgFile, 9, "vocabularies.requires.file"}},
		},
		{
			name:  "bad JSON",
			files: map[string]string{"caps.json": "{"},
			want:  []at{{cfgFile, 9, "vocabularies.requires.file"}},
		},
		{
			name:  "bad YAML",
			files: map[string]string{cfgFile: vocab("caps.yaml", sel), "caps.yaml": "a: [\n"},
			want:  []at{{cfgFile, 9, "vocabularies.requires.file"}},
		},
		{
			name:  "YAML alias",
			files: map[string]string{cfgFile: vocab("caps.yml", sel), "caps.yml": "x: &a [1]\ny: *a\n"},
			want:  []at{{cfgFile, 9, "vocabularies.requires.file"}},
		},
		{
			name:  "selector does not compile",
			files: map[string]string{cfgFile: vocab("caps.json", `".a | .b"`)},
			want:  []at{{cfgFile, 10, "vocabularies.requires.select"}},
		},
		{
			name:  "selector yields non-strings",
			files: map[string]string{"caps.json": `{"capabilities":[{"name":1}]}`},
			want:  []at{{cfgFile, 10, "vocabularies.requires.select"}},
		},
		{
			name: "unsupported vocabulary key",
			files: map[string]string{cfgFile: strings.Replace(baseConfig, "areas:", `  tags:
    file: caps.json
    select: .x
areas:`, 1)},
			want: []at{{cfgFile, 11, "vocabularies.tags"}},
		},
		{
			name:  "an invalid path is left to path-invalid",
			files: map[string]string{cfgFile: vocab("../caps.json", sel)},
		},
		{
			name:  "a backslash path is left to path-invalid",
			files: map[string]string{cfgFile: vocab(`'a\caps.json'`, sel)},
		},
		{
			name:  "valid YAML source",
			files: map[string]string{cfgFile: vocab("caps.yaml", sel), "caps.yaml": "capabilities:\n  - name: edit\n  - name: view\n"},
		},
		{
			name:  "no vocabularies",
			files: map[string]string{cfgFile: "version: 1\nplatforms:\n  ios:\n    formFactors: [phone]\nareas: [trip, activity]\n"},
		},
	})
}

func TestRule_vocabulary_unknown(t *testing.T) {
	bad := screen + `    layout:
      - { region: go, kind: action, requires: edit }
      - { region: nope, kind: action, requires: fly }
    layouts:
      web-wide:
        - region: menu
          kind: menu
          items:
            - { label: X, requires: swim }
`
	runRule(t, "vocabulary-unknown", []ruleCase{
		{
			name:  "region and nav item",
			files: map[string]string{screensYML: bad},
			want: []at{
				{screensYML, 8, "screens.a.one.layout[1].requires"},
				{screensYML, 14, "screens.a.one.layouts.web-wide[0].items[0].requires"},
			},
		},
		{
			name:  "an invalid source checks nothing",
			files: map[string]string{screensYML: bad, "caps.json": ""},
		},
		{
			name:  "no vocabulary checks nothing",
			files: map[string]string{screensYML: bad, cfgFile: "version: 1\nplatforms:\n  ios:\n    formFactors: [phone]\nareas: [trip]\n"},
		},
	})
}

func TestRulesSortedAndDefaults(t *testing.T) {
	rs := Rules()
	require.NotEmpty(t, rs)
	var ids []string
	for _, r := range rs {
		ids = append(ids, r.ID)
		require.NotNil(t, r.Run, r.ID)
		if diag.CorrectnessRules[r.ID] {
			assert.Equal(t, diag.Error, r.Default, r.ID)
		} else {
			assert.Equal(t, diag.QualityRules[r.ID], r.Default, r.ID)
			assert.NotEmpty(t, r.Default, "%s is neither a correctness nor a quality rule", r.ID)
		}
	}
	assert.IsIncreasing(t, ids)
	for _, id := range []string{
		"edge-platform-mismatch", "edge-unresolved", "flow-id-mismatch", "platform-note-missing",
		"ref-unresolved", "shipped-flow-proposed-ref", "status-conflict", "unknown-area",
		"unknown-form-factor", "unknown-platform", "vocabulary-source-invalid", "vocabulary-unknown",
	} {
		assert.Contains(t, ids, id)
	}
}

// TestRunValidProjectIsClean: the base fixture breaks no correctness rule.
// It is not written for the quality rules; qualityBase is clean of those.
func TestRunValidProjectIsClean(t *testing.T) {
	p := mkProject(t, base())
	res := Run(p, nil, Options{})
	assert.Zero(t, res.Errors)
	for _, d := range res.Diagnostics {
		assert.Contains(t, diag.QualityRules, d.Rule)
	}
}

func TestRunMergesSortsAndCounts(t *testing.T) {
	p := mkProject(t, with(map[string]string{
		screensYML: "screens:\n  a.one:\n    title: A\n    area: nowhere\n    presentation: root\n",
		flowFile:   "",
	}))
	load := []diag.Diagnostic{
		{Rule: "schema-invalid", Severity: diag.Error, File: screensYML, Line: 1, Path: "screens", Message: "m"},
	}
	res := Run(p, load, Options{Strict: true})
	require.Len(t, res.Diagnostics, 4)
	assert.Equal(t, "schema-invalid", res.Diagnostics[0].Rule)
	assert.Equal(t, "missing-purpose", res.Diagnostics[1].Rule)
	assert.Equal(t, diag.Warn, res.Diagnostics[1].Severity)
	assert.Equal(t, "orphan-screen", res.Diagnostics[2].Rule)
	assert.Equal(t, "unknown-area", res.Diagnostics[3].Rule)
	assert.Equal(t, diag.Error, res.Diagnostics[3].Severity)
	assert.Equal(t, 2, res.Errors)
	assert.Equal(t, 2, res.Warnings)
}

func TestRunNilProject(t *testing.T) {
	load := []diag.Diagnostic{
		{Rule: "config-invalid", Severity: diag.Error, File: cfgFile, Line: 3, Message: "b"},
		{Rule: "yaml-syntax", Severity: diag.Error, File: cfgFile, Line: 1, Message: "a"},
	}
	res := Run(nil, load, Options{})
	require.Len(t, res.Diagnostics, 2)
	assert.Equal(t, 1, res.Diagnostics[0].Line)
	assert.Equal(t, 2, res.Errors)
	assert.Equal(t, 3, load[0].Line, "Run must not reorder the caller's slice")
}

func TestRunAppliesQualitySeverities(t *testing.T) {
	emit := func(id string) Rule {
		return Rule{ID: id, Default: diag.QualityRules[id], Run: func(*project.Project, *Context) []diag.Diagnostic {
			return []diag.Diagnostic{{Rule: id, File: screensYML, Message: "m"}}
		}}
	}
	p := mkProject(t, base())
	cfg := *p.Config
	cfg.Rules = maps.Clone(cfg.Rules)
	cfg.Rules["orphan-screen"] = diag.Off
	cfg.Rules["missing-purpose"] = diag.Error
	p.Config = &cfg

	res := run(p, nil, []Rule{emit("orphan-screen"), emit("missing-purpose"), emit("deep-nesting")}, nil)
	require.Len(t, res.Diagnostics, 2)
	assert.Equal(t, "deep-nesting", res.Diagnostics[0].Rule)
	assert.Equal(t, diag.Warn, res.Diagnostics[0].Severity)
	assert.Equal(t, "missing-purpose", res.Diagnostics[1].Rule)
	assert.Equal(t, diag.Error, res.Diagnostics[1].Severity)
	assert.Equal(t, 1, res.Errors)
	assert.Equal(t, 1, res.Warnings)
}

func TestRunDropsOffLoadDiagnostics(t *testing.T) {
	load := []diag.Diagnostic{{Rule: "x", Severity: diag.Off, File: cfgFile}}
	res := Run(nil, load, Options{})
	assert.Empty(t, res.Diagnostics)
}

func TestStatusConflictWithoutPlatforms(t *testing.T) {
	p := mkProject(t, map[string]string{
		cfgFile:    "version: 1\nareas: [trip]\n",
		screensYML: screen + "    status: proposed\n    layout:\n      - { region: bad, kind: text, status: shipped }\n",
	})
	ds := rule(t, "status-conflict").Run(p, &Context{})
	require.Len(t, ds, 1)
	assert.Equal(t, at{screensYML, 8, "screens.a.one.layout[0]"}, at{ds[0].File, ds[0].Line, ds[0].Path})
	assert.Equal(t, "status shipped under a.one, which is proposed", ds[0].Message)
}

func TestRunUnconfiguredRuleUsesDefault(t *testing.T) {
	p := mkProject(t, base())
	r := Rule{ID: "not-configured", Default: diag.Warn, Run: func(*project.Project, *Context) []diag.Diagnostic {
		return []diag.Diagnostic{{Rule: "not-configured", File: cfgFile, Message: "m"}}
	}}
	res := run(p, nil, []Rule{r}, nil)
	require.Len(t, res.Diagnostics, 1)
	assert.Equal(t, diag.Warn, res.Diagnostics[0].Severity)
}

func TestLookupMisses(t *testing.T) {
	src := []byte("a:\n  b: 1\nc: [x]\n")
	assert.Equal(t, 2, valueLine(src, 0, "a", "b"))
	assert.Equal(t, 2, keyLine(src, "a", "b"))
	assert.Zero(t, valueLine(src, 0, "a", "z"), "missing key")
	assert.Zero(t, keyLine(src, "c", "x"), "not a mapping")
	assert.Zero(t, valueLine([]byte("a: [\n"), 0, "a"), "unreadable YAML")
}

func TestReadDocumentErrors(t *testing.T) {
	fsys := fstest.MapFS{
		"dir.json/x":  {Data: []byte("{}")},
		"bad-tag.yml": {Data: []byte("a: !!int nope\n")},
	}
	_, err := readDocument(fsys, "dir.json")
	require.Error(t, err)
	assert.NotContains(t, err.Error(), "does not exist")
	_, err = readDocument(fsys, "bad-tag.yml")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not valid YAML")
}
