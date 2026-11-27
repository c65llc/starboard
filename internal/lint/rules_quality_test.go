// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package lint

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/diag"
)

// qualityScreens is a registry no quality rule reports on.
const qualityScreens = `screens:
  trip.timeline:
    title: Timeline
    area: trip
    purpose: See the trip.
    presentation: root
    layout:
      - region: tabs
        kind: tabs
        items:
          - {label: Timeline, to: trip.timeline}
      - {region: add, kind: primary-action, label: Add, to: activity.editor}
    layouts:
      web-wide:
        - region: shell
          kind: row
          children:
            - region: side
              kind: nav
              items:
                - {label: Timeline, to: trip.timeline}
                - {label: Add, to: activity.editor}
  activity.editor:
    title: Editor
    area: activity
    purpose: Edit an activity.
    presentation: sheet
    layout:
      - {region: form, kind: form}
`

// qualityFlow references both screens, in its steps and its diagram.
const qualityFlow = "---\nid: add-activity\ntitle: Add an activity\nstatus: shipped\nentry: trip.timeline\n---\n\n" +
	"## Steps\n\n1. Tap @trip.timeline#add.\n2. Fill @activity.editor#form.\n\n" +
	"```mermaid\nflowchart LR\n  a[\"@trip.timeline\"] --> b[\"@activity.editor\"]\n```\n"

const qualityConfig = `version: 1
platforms:
  ios:
    formFactors: [phone]
  web:
    formFactors: [web-wide]
areas: [trip, activity]
`

func qualityBase() map[string]string {
	return map[string]string{cfgFile: qualityConfig, screensYML: qualityScreens, flowFile: qualityFlow}
}

// runQuality is runRule over the quality base fixture: each case's files
// replace the base's, and an empty value deletes one.
func runQuality(t *testing.T, id string, cases []ruleCase) {
	t.Helper()
	r := rule(t, id)
	assert.Equal(t, diag.Warn, r.Default, "quality rules default to warn")
	cases = append([]ruleCase{{name: "valid fixture"}}, cases...)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			files := qualityBase()
			for k, v := range tc.files {
				if v == "" {
					delete(files, k)
					continue
				}
				files[k] = v
			}
			p := mkProject(t, files)
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

// two is a two-screen registry header; callers append a.two's fields at
// four spaces.
const two = `screens:
  a.one:
    title: A
    area: trip
    purpose: p
    presentation: root
    layout:
      - {region: go, kind: action, to: a.two}
  a.two:
    title: B
    area: trip
    purpose: p
`

func flowTo(body string) map[string]string {
	return map[string]string{flowFile: "---\nid: add-activity\ntitle: T\nstatus: proposed\nentry: a.one\n---\n\n" + body}
}

func TestRule_unreachable_screen(t *testing.T) {
	refs := "## Steps\n\n1. @a.one\n2. @a.two\n3. @a.three\n"
	runQuality(t, "unreachable-screen", []ruleCase{
		{
			name: "no inbound edge, or a self-edge only",
			files: map[string]string{screensYML: two + `    presentation: push
  a.three:
    title: C
    area: trip
    purpose: p
    presentation: push
    layouts:
      phone:
        - {region: x, kind: action, to: a.three}
  a.four:
    title: D
    area: trip
    purpose: p
    presentation: sheet
`, flowFile: flowTo(refs)[flowFile]},
			want: []at{
				{screensYML, 14, "screens.a.three"},
				{screensYML, 22, "screens.a.four"},
			},
		},
		{
			name: "an inbound edge from an override, or a flow entry",
			files: map[string]string{screensYML: two + `    presentation: push
    layouts:
      phone:
        - {region: back, kind: action, to: a.three}
  a.three:
    title: C
    area: trip
    purpose: p
    presentation: push
`, flowFile: "---\nid: add-activity\ntitle: T\nstatus: proposed\nentry: a.two\n---\n"},
		},
	})
}

func TestRule_orphan_screen(t *testing.T) {
	runQuality(t, "orphan-screen", []ruleCase{
		{
			name:  "an entry counts, the rest are orphans",
			files: map[string]string{flowFile: "---\nid: add-activity\ntitle: T\nstatus: proposed\nentry: activity.editor\n---\n"},
			want:  []at{{screensYML, 2, "screens.trip.timeline"}},
		},
		{
			name:  "no flow at all",
			files: map[string]string{flowFile: ""},
			want:  []at{{screensYML, 2, "screens.trip.timeline"}, {screensYML, 23, "screens.activity.editor"}},
		},
		{
			name:  "a reference counts",
			files: map[string]string{flowFile: "---\nid: add-activity\ntitle: T\nstatus: proposed\nentry: activity.editor\n---\n\nSee @trip.timeline.\n"},
		},
	})
}

func TestRule_missing_purpose(t *testing.T) {
	runQuality(t, "missing-purpose", []ruleCase{{
		name: "absent or blank",
		files: map[string]string{screensYML: strings.Replace(
			strings.Replace(qualityScreens, "    purpose: See the trip.\n", "", 1),
			"purpose: Edit an activity.", `purpose: "  "`, 1)},
		want: []at{{screensYML, 2, "screens.trip.timeline.purpose"}, {screensYML, 22, "screens.activity.editor.purpose"}},
	}})
}

func TestRule_label_too_long(t *testing.T) {
	long := strings.Repeat("é", 41) // 41 runes, 82 bytes
	ok := strings.Repeat("é", 40)
	runQuality(t, "label-too-long", []ruleCase{
		{
			name: "regions and nav items, counted in runes",
			files: map[string]string{screensYML: `screens:
  a.one:
    title: A
    area: trip
    purpose: p
    presentation: root
    layout:
      - {region: r, kind: action, label: ` + long + `}
      - {region: s, kind: action, label: ` + ok + `}
      - region: t
        kind: tabs
        items:
          - {label: ` + long + `}
          - {label: ` + ok + `}
      - region: l
        kind: list
        item: {kind: card, label: ` + long + `}
`},
			want: []at{
				{screensYML, 8, "screens.a.one.layout[0].label"},
				{screensYML, 13, "screens.a.one.layout[2].items[0].label"},
				{screensYML, 17, "screens.a.one.layout[3].item.label"},
			},
		},
		{
			name:  "a configured limit",
			files: map[string]string{cfgFile: qualityConfig + "lint:\n  limits:\n    label-too-long: 3\n"},
			want: []at{
				{screensYML, 11, "screens.trip.timeline.layout[0].items[0].label"},
				{screensYML, 21, "screens.trip.timeline.layouts.web-wide[0].children[0].items[0].label"},
			},
		},
	})
}

func TestRule_label_too_long_defaultLimit(t *testing.T) {
	p := mkProject(t, map[string]string{cfgFile: qualityConfig, screensYML: `screens:
  a.one:
    title: A
    area: trip
    presentation: root
    layout:
      - {region: r, kind: action, label: ` + strings.Repeat("x", 41) + `}
`})
	ds := rule(t, "label-too-long").Run(p, &Context{})
	require.Len(t, ds, 1, "a nil Limits falls back to the default 40")
}

func TestRule_flow_ref_not_in_diagram(t *testing.T) {
	diagram := "```mermaid\nflowchart LR\n  a[\"@a.one#go\"]\n```\n"
	runQuality(t, "flow-ref-not-in-diagram", []ruleCase{
		{
			name: "only screen IDs compare; the first outside ref is reported",
			files: map[string]string{
				screensYML: two + "    presentation: push\n",
				flowFile:   flowTo("## Steps\n\n1. @a.one#other\n2. @a.two\n3. @a.two again\n\n" + diagram)[flowFile],
			},
			want: []at{{flowFile, 11, ""}},
		},
		{
			name: "no diagram, no finding",
			files: map[string]string{
				screensYML: two + "    presentation: push\n",
				flowFile:   flowTo("## Steps\n\n1. @a.two\n")[flowFile],
			},
		},
	})
}

func TestRule_duplicate_edge(t *testing.T) {
	runQuality(t, "duplicate-edge", []ruleCase{
		{
			name: "same parent and target, in one tree",
			files: map[string]string{screensYML: two + `    presentation: push
    layout:
      - {region: x, kind: action, to: a.one}
      - {region: y, kind: action, to: a.one}
      - region: t
        kind: tabs
        to: a.one
        items:
          - {label: A, to: a.one}
          - {label: B, to: a.one}
      - region: c
        kind: column
        children:
          - {region: z, kind: action, to: a.one}
      - region: l
        kind: list
        item: {kind: card, to: a.one}
    layouts:
      phone:
        - {region: x, kind: action, to: a.one}
`},
			want: []at{
				{screensYML, 16, "screens.a.two.layout[1]"},
				{screensYML, 17, "screens.a.two.layout[2]"},
				{screensYML, 22, "screens.a.two.layout[2].items[1]"},
			},
		},
	})
}

func TestRule_deep_nesting(t *testing.T) {
	nest := func(depth int) string {
		var b strings.Builder
		for i := range depth {
			ind := strings.Repeat("  ", 3+2*i)
			b.WriteString(ind + "- region: r" + string(rune('a'+i)) + "\n")
			b.WriteString(ind + "  kind: column\n")
			if i < depth-1 {
				b.WriteString(ind + "  children:\n")
			}
		}
		return b.String()
	}
	runQuality(t, "deep-nesting", []ruleCase{
		{
			name: "depth 5 is fine, 7 reports the sixth only",
			files: map[string]string{screensYML: two + "    presentation: push\n    layout:\n" + nest(5) +
				"    layouts:\n      phone:\n" + nest(7)},
			want: []at{{screensYML, 46,
				"screens.a.two.layouts.phone[0].children[0].children[0].children[0].children[0].children[0]"}},
		},
		{
			name: "a list item counts, and two branches report twice",
			files: map[string]string{screensYML: two + `    presentation: push
    layout:
      - region: a
        kind: column
        children:
          - region: b
            kind: column
            children:
              - region: c
                kind: column
                children:
                  - region: d
                    kind: list
                    item:
                      kind: column
                      children:
                        - {region: e, kind: text}
                        - {region: f, kind: text}
`},
			want: []at{
				{screensYML, 29, "screens.a.two.layout[0].children[0].children[0].children[0].item.children[0]"},
				{screensYML, 30, "screens.a.two.layout[0].children[0].children[0].children[0].item.children[1]"},
			},
		},
		{
			name:  "a configured limit",
			files: map[string]string{cfgFile: qualityConfig + "lint:\n  limits:\n    deep-nesting: 1\n"},
			want:  []at{{screensYML, 18, "screens.trip.timeline.layouts.web-wide[0].children[0]"}},
		},
	})
}

func TestRule_edge_parity(t *testing.T) {
	runQuality(t, "edge-parity", []ruleCase{
		{
			name: "each missing target, per override",
			files: map[string]string{screensYML: two + `    presentation: push
    layout:
      - {region: x, kind: action, to: a.one}
      - region: t
        kind: tabs
        items:
          - {label: B, to: a.two}
    layouts:
      phone:
        - {region: x, kind: text}
      web-wide:
        - {region: x, kind: action, to: a.one}
`},
			want: []at{{screensYML, 9, "screens.a.two.layouts.phone"}, {screensYML, 9, "screens.a.two.layouts.phone"},
				{screensYML, 9, "screens.a.two.layouts.web-wide"}},
		},
	})
}

func TestRule_step_without_ref(t *testing.T) {
	runQuality(t, "step-without-ref", []ruleCase{{
		name:  "a step with no reference",
		files: map[string]string{flowFile: strings.Replace(qualityFlow, "2. Fill @activity.editor#form.", "2. Fill it in.", 1)},
		want:  []at{{flowFile, 11, ""}},
	}})
}

func TestQualityRulesRegistered(t *testing.T) {
	for id, sev := range diag.QualityRules {
		assert.Equal(t, sev, rule(t, id).Default, id)
	}
}

func TestSeverityOverride(t *testing.T) {
	files := qualityBase()
	files[screensYML] = strings.Replace(qualityScreens, "    purpose: See the trip.\n", "", 1)
	files[flowFile] = strings.Replace(qualityFlow, "2. Fill @activity.editor#form.", "2. Fill it in.", 1)
	files[cfgFile] = qualityConfig + "lint:\n  rules:\n    missing-purpose: error\n    step-without-ref: off\n"
	p := mkProject(t, files)
	res := Run(p, nil, Options{})
	require.Len(t, res.Diagnostics, 1)
	assert.Equal(t, "missing-purpose", res.Diagnostics[0].Rule)
	assert.Equal(t, diag.Error, res.Diagnostics[0].Severity)
	assert.Equal(t, 1, res.Errors)
	assert.Zero(t, res.Warnings)

	files[cfgFile] = qualityConfig
	p = mkProject(t, files)
	res = Run(p, nil, Options{})
	assert.Zero(t, res.Errors)
	assert.Equal(t, 2, res.Warnings)
}

func TestQualityBaseIsClean(t *testing.T) {
	p := mkProject(t, qualityBase())
	res := Run(p, nil, Options{})
	assert.Empty(t, res.Diagnostics)
}
