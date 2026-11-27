// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package registry

import (
	"io/fs"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/diag"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := fs.ReadFile(os.DirFS("testdata"), name)
	require.NoError(t, err)
	return data
}

// parseOK parses src and fails the test on any diagnostic.
func parseOK(t *testing.T, src string) *Registry {
	t.Helper()
	reg, ds := Parse([]byte(src))
	require.Empty(t, ds)
	require.NotNil(t, reg)
	return reg
}

func targets(es []Edge) []string {
	var out []string
	for _, e := range es {
		out = append(out, e.To)
	}
	return out
}

func TestParseTimeline(t *testing.T) {
	reg, ds := Parse(fixture(t, "timeline.yaml"))
	require.Empty(t, ds)
	require.NotNil(t, reg)
	assert.Equal(t, []string{"trip.timeline"}, reg.Order)
	s := reg.Screens["trip.timeline"]
	require.NotNil(t, s)
	assert.Equal(t, "trip.timeline", s.ID)
	assert.Equal(t, "Timeline", s.Title)
	assert.Equal(t, "trip", s.Area)
	assert.Equal(t, "tab", s.Presentation)
	assert.Equal(t, Status{All: "shipped"}, s.Status)
	assert.Equal(t, []string{"ios", "android"}, s.Platforms)
	assert.Equal(t, []string{"empty", "ended", "read-only"}, s.States)
	assert.Equal(t, []string{"shells/apple/AwayTeam/Sources/Screens/Timeline/TimelineView.swift"}, s.Files["ios"])
	assert.Equal(t, "shells/android/app/src/androidTest/assets/goldens/arm64-v8a/signature-light/timeline.png", s.Screenshots["android"])
	assert.Equal(t, 2, s.Line)
	require.Len(t, s.Layout, 5)

	bar := s.Layout[0]
	assert.Equal(t, "app-bar", bar.Name)
	assert.Equal(t, "bar", bar.Kind)
	assert.Equal(t, 16, bar.Line)
	require.Len(t, bar.Children, 2)
	assert.Equal(t, "Trip name · dates", bar.Children[0].Label)

	list := s.Layout[2]
	require.NotNil(t, list.Item)
	assert.Equal(t, "", list.Item.Name)
	assert.Equal(t, "activity.detail", list.Item.To)
	assert.Equal(t, &Empty{Label: "No activities yet"}, list.Empty)

	assert.Equal(t, "editLogistics", s.Layout[3].Requires)
	tabs := s.Layout[4]
	assert.Equal(t, []NavItem{
		{Label: "Timeline", To: "trip.timeline", Line: 30},
		{Label: "Checklist", To: "trip.checklist", Line: 31},
	}, tabs.Items)

	wide := s.Layouts["web-wide"]
	require.Len(t, wide, 1)
	assert.Equal(t, Width{Px: 240}, wide[0].Children[0].Width)

	assert.Equal(t, []string{"activity.detail", "activity.editor", "trip.checklist", "trip.info", "trip.timeline"},
		targets(Edges(s, "phone")))

	assert.Equal(t, []Unmapped{{
		Path:   "shells/apple/AwayTeam/Sources/Screens/Timeline/LensPickerView.swift",
		Reason: "control inside trip.timeline#app-bar",
		Line:   52,
	}}, reg.Unmapped)
}

func TestStatusPerPlatform(t *testing.T) {
	reg := parseOK(t, "screens:\n  a.b:\n    status: { ios: shipped, android: proposed }\n"+req)
	st := reg.Screens["a.b"].Status
	assert.Equal(t, "proposed", st.For("android"))
	assert.Equal(t, "shipped", st.For("ios"))
	assert.Equal(t, "shipped", st.For("web"))
	assert.Equal(t, "proposed", Status{All: "proposed"}.For("web"))
	assert.Equal(t, "shipped", Status{}.For("web"))
}

// req is the required screen keys, appended to a screen's body.
const req = "    title: T\n    area: a\n    presentation: push\n"

func region(src string) string {
	return "screens:\n  a.b:\n    layout:\n      - " + src + "\n" + req
}

func TestWidthForms(t *testing.T) {
	reg := parseOK(t, region("{ region: x, kind: text, width: 240 }"))
	assert.Equal(t, Width{Px: 240}, reg.Screens["a.b"].Layout[0].Width)

	reg = parseOK(t, region(`{ region: x, kind: text, width: "1/3" }`))
	assert.Equal(t, Width{Num: 1, Den: 3}, reg.Screens["a.b"].Layout[0].Width)

	for _, bad := range []string{`"abc"`, "0", "-5", `"0/3"`, `"4/3"`, `"1/0"`, "1.5", "[1]"} {
		t.Run(bad, func(t *testing.T) {
			reg, ds := Parse([]byte(region("{ region: x, kind: text, width: " + bad + " }")))
			require.NotNil(t, reg)
			require.Len(t, ds, 1)
			assert.Equal(t, "schema-invalid", ds[0].Rule)
			assert.Equal(t, "screens.a.b.layout[0].width", ds[0].Path)
			assert.Equal(t, Width{}, reg.Screens["a.b"].Layout[0].Width)
		})
	}
}

func TestChildrenOnNonContainer(t *testing.T) {
	src := "screens:\n  a.b:\n    layout:\n      - region: x\n        kind: text\n        children:\n          - { region: y, kind: text }\n" + req
	reg, ds := Parse([]byte(src))
	require.NotNil(t, reg)
	require.Len(t, ds, 1)
	assert.Equal(t, "schema-invalid", ds[0].Rule)
	assert.Equal(t, 4, ds[0].Line)
	assert.Equal(t, "screens.a.b.layout[0].children", ds[0].Path)
	assert.Equal(t, "children is allowed only on column, row, section and bar, not text", ds[0].Message)
}

func TestDuplicateRegionInItem(t *testing.T) {
	src := `screens:
  a.b:
    layout:
      - region: rows
        kind: list
        item:
          region: row
          kind: section
          children:
            - { region: rows, kind: text }
    title: T
    area: a
    presentation: push
`
	_, ds := Parse([]byte(src))
	require.Len(t, ds, 1, "%v", ds)
	assert.Equal(t, "duplicate-region", ds[0].Rule)
	assert.Equal(t, 10, ds[0].Line)
	assert.Equal(t, "screens.a.b.layout[0].item.children[0].region", ds[0].Path)
}

func TestDuplicateRegionIsPerLayoutTree(t *testing.T) {
	src := `screens:
  a.b:
    layout:
      - { region: x, kind: text }
    layouts:
      web-wide:
        - { region: x, kind: text }
        - { region: x, kind: text }
    title: T
    area: a
    presentation: push
`
	_, ds := Parse([]byte(src))
	require.Len(t, ds, 1, "%v", ds)
	assert.Equal(t, "duplicate-region", ds[0].Rule)
	assert.Equal(t, "screens.a.b.layouts.web-wide[1].region", ds[0].Path)
}

func TestIDInvalid(t *testing.T) {
	for _, id := range []string{"Trip.Timeline", "timeline", "trip..x", "1trip.x", "trip.x."} {
		t.Run(id, func(t *testing.T) {
			reg, ds := Parse([]byte("screens:\n  " + id + ":\n" + req))
			require.NotNil(t, reg)
			require.Len(t, ds, 1)
			assert.Equal(t, "id-invalid", ds[0].Rule)
			assert.Equal(t, 2, ds[0].Line)
			assert.Equal(t, "screens."+id, ds[0].Path)
			assert.Contains(t, ds[0].Message, id)
		})
	}
}

func TestDuplicateScreen(t *testing.T) {
	reg, ds := Parse([]byte("screens:\n  a.b:\n    title: One\n    area: a\n    presentation: push\n  a.b:\n    title: Two\n"))
	require.Len(t, ds, 1)
	assert.Equal(t, "duplicate-screen", ds[0].Rule)
	assert.Equal(t, 6, ds[0].Line)
	assert.Equal(t, []string{"a.b"}, reg.Order)
	assert.Equal(t, "One", reg.Screens["a.b"].Title)
}

func TestRejectAliases(t *testing.T) {
	for _, name := range []string{"aliases.yaml", "merge.yaml"} {
		t.Run(name, func(t *testing.T) {
			reg, ds := Parse(fixture(t, name))
			assert.Nil(t, reg, "no screens")
			require.NotEmpty(t, ds)
			for _, d := range ds {
				assert.Equal(t, "yaml-alias-not-allowed", d.Rule)
				assert.Equal(t, "screens.yaml", d.File)
			}
		})
	}
}

func TestParseSyntaxErrors(t *testing.T) {
	for _, src := range []string{"screens: [\n", "screens: {}\n---\nscreens: {}\n"} {
		reg, ds := Parse([]byte(src))
		assert.Nil(t, reg)
		require.Len(t, ds, 1)
		assert.Equal(t, "yaml-syntax", ds[0].Rule)
		assert.Equal(t, "screens.yaml", ds[0].File)
	}
}

func TestParseCRLF(t *testing.T) {
	lf := fixture(t, "timeline.yaml")
	crlf := []byte(strings.ReplaceAll(string(lf), "\n", "\r\n"))
	a, ads := Parse(lf)
	b, bds := Parse(crlf)
	assert.Equal(t, a, b)
	assert.Equal(t, ads, bds)
}

func TestParseEmpty(t *testing.T) {
	for _, src := range []string{"", "screens:\nunmapped:\n"} {
		reg := parseOK(t, src)
		assert.Empty(t, reg.Screens)
		assert.Empty(t, reg.Order)
		assert.Empty(t, reg.Unmapped)
	}
}

func TestRequiredScreenFields(t *testing.T) {
	cases := []struct {
		name, body string
		missing    []string
	}{
		{"no title", "    area: a\n    presentation: push\n", []string{"title"}},
		{"no area", "    title: T\n    presentation: push\n", []string{"area"}},
		{"no presentation", "    title: T\n    area: a\n", []string{"presentation"}},
		{"null screen", "", []string{"area", "presentation", "title"}},
		{"only purpose", "    purpose: P\n", []string{"area", "presentation", "title"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reg, ds := Parse([]byte("screens:\n  a.b:\n" + tc.body))
			require.NotNil(t, reg)
			require.NotNil(t, reg.Screens["a.b"], "the screen is still registered")
			var got []string
			for _, d := range ds {
				assert.Equal(t, "schema-invalid", d.Rule)
				assert.Equal(t, "screens.a.b", d.Path)
				assert.Equal(t, 2, d.Line)
				got = append(got, d.Message)
			}
			var want []string
			for _, k := range tc.missing {
				want = append(want, "screens.a.b."+k+" is required")
			}
			assert.Equal(t, want, got)
		})
	}
	// purpose is optional: a screen with the three required keys is clean.
	parseOK(t, "screens:\n  a.b:\n"+req)
	// A screen that is not a mapping reports only that.
	_, ds := Parse([]byte("screens:\n  a.b: x\n"))
	require.Len(t, ds, 1)
	assert.Equal(t, "screens.a.b must be a mapping", ds[0].Message)
}

func TestUnknownKindAndPresentation(t *testing.T) {
	src := "screens:\n  a.b:\n    title: T\n    area: a\n    presentation: popover\n    layout:\n      - region: x\n        kind: carousel\n        children:\n          - { region: y, kind: text, to: c.d }\n"
	reg, ds := Parse([]byte(src))
	require.Len(t, ds, 2, "%v", ds)
	assert.Equal(t, "unknown-presentation", ds[0].Rule)
	assert.Equal(t, "screens.a.b.presentation", ds[0].Path)
	assert.Equal(t, "unknown-kind", ds[1].Rule)
	assert.Equal(t, "screens.a.b.layout[0].kind", ds[1].Path)
	// An unknown kind's subtree is still parsed, so its edges survive.
	assert.Equal(t, []string{"c.d"}, targets(Edges(reg.Screens["a.b"], "phone")))
}

func TestParseFullRegion(t *testing.T) {
	src := `screens:
  a.b:
    platformNote: iOS only for now
    layout:
      - region: r
        kind: row
        status: proposed
        platformNote: web has no row
        requires: editTrip
        to: c.d
        width: "2/3"
        label: Row
      - region: m
        kind: menu
        items:
          - { label: One, to: c.d, requires: x, status: proposed }
    title: T
    area: a
    presentation: push
`
	reg := parseOK(t, src)
	s := reg.Screens["a.b"]
	assert.Equal(t, "iOS only for now", s.PlatformNote)
	assert.Equal(t, &Region{
		Name: "r", Kind: "row", Label: "Row", To: "c.d", Requires: "editTrip", Status: "proposed",
		PlatformNote: "web has no row", Width: Width{Num: 2, Den: 3}, Line: 5,
	}, s.Layout[0])
	assert.Equal(t, []NavItem{{Label: "One", To: "c.d", Requires: "x", Status: "proposed", Line: 16}}, s.Layout[1].Items)
}

func TestParseInvalid(t *testing.T) {
	cases := []struct {
		name, src, rule, path, msg string
	}{
		{"root not mapping", "- 1\n", "schema-invalid", "", "screens.yaml must be a mapping"},
		{"unknown top key", "version: 1\n", "schema-invalid", "version", "unknown key version"},
		{"screens not mapping", "screens: [a]\n", "schema-invalid", "screens", "screens must be a mapping"},
		{"screen not mapping", "screens:\n  a.b: x\n", "schema-invalid", "screens.a.b", "screens.a.b must be a mapping"},
		{"unknown screen key", "screens:\n  a.b:\n    colour: red\n" + req, "schema-invalid", "screens.a.b.colour", "unknown key colour"},
		{"title not string", "screens:\n  a.b:\n    title: [x]\n    area: a\n    presentation: push\n", "schema-invalid", "screens.a.b.title", "screens.a.b.title must be a string"},
		{"status bad scalar", "screens:\n  a.b:\n    status: done\n" + req, "schema-invalid", "screens.a.b.status", "screens.a.b.status must be shipped or proposed"},
		{"status bad per platform", "screens:\n  a.b:\n    status: { ios: done }\n" + req, "schema-invalid", "screens.a.b.status.ios", "screens.a.b.status.ios must be shipped or proposed"},
		{"status list", "screens:\n  a.b:\n    status: [shipped]\n" + req, "schema-invalid", "screens.a.b.status", "screens.a.b.status must be shipped or proposed, or a mapping of platform to either"},
		{"platforms not list", "screens:\n  a.b:\n    platforms: ios\n" + req, "schema-invalid", "screens.a.b.platforms", "screens.a.b.platforms must be a list of strings"},
		{"files not mapping", "screens:\n  a.b:\n    files: [x]\n" + req, "schema-invalid", "screens.a.b.files", "screens.a.b.files must be a mapping"},
		{"files entry not list", "screens:\n  a.b:\n    files: { ios: x }\n" + req, "schema-invalid", "screens.a.b.files.ios", "screens.a.b.files.ios must be a list of strings"},
		{"screenshot not string", "screens:\n  a.b:\n    screenshots: { ios: [x] }\n" + req, "schema-invalid", "screens.a.b.screenshots.ios", "screens.a.b.screenshots.ios must be a string"},
		{"layout not list", "screens:\n  a.b:\n    layout: x\n" + req, "schema-invalid", "screens.a.b.layout", "screens.a.b.layout must be a list of regions"},
		{"layouts not mapping", "screens:\n  a.b:\n    layouts: [x]\n" + req, "schema-invalid", "screens.a.b.layouts", "screens.a.b.layouts must be a mapping"},
		{"override not list", "screens:\n  a.b:\n    layouts: { phone: x }\n" + req, "schema-invalid", "screens.a.b.layouts.phone", "screens.a.b.layouts.phone must be a list of regions"},
		{"region not mapping", region("x"), "schema-invalid", "screens.a.b.layout[0]", "screens.a.b.layout[0] must be a mapping"},
		{"region unknown key", region("{ region: x, kind: text, size: 3 }"), "schema-invalid", "screens.a.b.layout[0].size", "unknown key size"},
		{"region name missing", region("{ kind: text }"), "schema-invalid", "screens.a.b.layout[0]", "screens.a.b.layout[0].region is required"},
		{"region kind missing", region("{ region: x }"), "schema-invalid", "screens.a.b.layout[0]", "screens.a.b.layout[0].kind is required"},
		{"region name invalid", region("{ region: Top_Bar, kind: text }"), "id-invalid", "screens.a.b.layout[0].region", "region name Top_Bar must match ^[a-z][a-z0-9-]*$"},
		{"region name not string", region("{ region: [x], kind: text }"), "schema-invalid", "screens.a.b.layout[0].region", "screens.a.b.layout[0].region must be a string"},
		{"kind not string", region("{ region: x, kind: [text] }"), "schema-invalid", "screens.a.b.layout[0].kind", "screens.a.b.layout[0].kind must be a string"},
		{"region status bad", region("{ region: x, kind: text, status: { ios: shipped } }"), "schema-invalid", "screens.a.b.layout[0].status", "screens.a.b.layout[0].status must be shipped or proposed"},
		{"children not list", region("{ region: x, kind: row, children: x }"), "schema-invalid", "screens.a.b.layout[0].children", "screens.a.b.layout[0].children must be a list of regions"},
		{"item on non-list", region("{ region: x, kind: text, item: { kind: card } }"), "schema-invalid", "screens.a.b.layout[0].item", "item is allowed only on list, not text"},
		{"empty on non-list", region("{ region: x, kind: text, empty: { label: y } }"), "schema-invalid", "screens.a.b.layout[0].empty", "empty is allowed only on list, not text"},
		{"items on non-nav", region("{ region: x, kind: list, items: [] }"), "schema-invalid", "screens.a.b.layout[0].items", "items is allowed only on tabs, nav and menu, not list"},
		{"item kind missing", region("{ region: x, kind: list, item: { label: y } }"), "schema-invalid", "screens.a.b.layout[0].item", "screens.a.b.layout[0].item.kind is required"},
		{"empty not mapping", region("{ region: x, kind: list, empty: y }"), "schema-invalid", "screens.a.b.layout[0].empty", "screens.a.b.layout[0].empty must be a mapping"},
		{"empty unknown key", region("{ region: x, kind: list, empty: { label: y, to: a.b } }"), "schema-invalid", "screens.a.b.layout[0].empty.to", "unknown key to"},
		{"empty label missing", region("{ region: x, kind: list, empty: {} }"), "schema-invalid", "screens.a.b.layout[0].empty", "screens.a.b.layout[0].empty.label is required"},
		{"items not list", region("{ region: x, kind: tabs, items: x }"), "schema-invalid", "screens.a.b.layout[0].items", "screens.a.b.layout[0].items must be a list"},
		{"nav item not mapping", region("{ region: x, kind: tabs, items: [x] }"), "schema-invalid", "screens.a.b.layout[0].items[0]", "screens.a.b.layout[0].items[0] must be a mapping"},
		{"nav item unknown key", region("{ region: x, kind: tabs, items: [{ label: a, kind: text }] }"), "schema-invalid", "screens.a.b.layout[0].items[0].kind", "unknown key kind"},
		{"nav item label missing", region("{ region: x, kind: tabs, items: [{ to: a.b }] }"), "schema-invalid", "screens.a.b.layout[0].items[0]", "screens.a.b.layout[0].items[0].label is required"},
		{"nav item status bad", region("{ region: x, kind: tabs, items: [{ label: a, status: maybe }] }"), "schema-invalid", "screens.a.b.layout[0].items[0].status", "screens.a.b.layout[0].items[0].status must be shipped or proposed"},
		{"unmapped not list", "unmapped: x\n", "schema-invalid", "unmapped", "unmapped must be a list"},
		{"unmapped entry not mapping", "unmapped: [x]\n", "schema-invalid", "unmapped[0]", "unmapped[0] must be a mapping"},
		{"unmapped unknown key", "unmapped:\n  - { path: a, reason: b, why: c }\n", "schema-invalid", "unmapped[0].why", "unknown key why"},
		{"unmapped reason missing", "unmapped:\n  - { path: a }\n", "schema-invalid", "unmapped[0]", "unmapped[0].reason is required"},
		{"unmapped path empty", "unmapped:\n  - { path: \"\", reason: b }\n", "schema-invalid", "unmapped[0].path", "unmapped[0].path must not be empty"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reg, ds := Parse([]byte(tc.src))
			require.NotNil(t, reg, "a schema problem still yields a registry")
			require.Len(t, ds, 1, "%v", ds)
			d := ds[0]
			assert.Equal(t, tc.rule, d.Rule)
			assert.Equal(t, diag.Error, d.Severity)
			assert.Equal(t, "screens.yaml", d.File)
			assert.Equal(t, tc.path, d.Path)
			assert.Equal(t, tc.msg, d.Message)
			assert.Positive(t, d.Line)
		})
	}
}

func TestParseInvalidUnmappedIsDropped(t *testing.T) {
	reg, _ := Parse([]byte("unmapped:\n  - { path: a }\n  - { path: b, reason: c }\n"))
	assert.Equal(t, []Unmapped{{Path: "b", Reason: "c", Line: 3}}, reg.Unmapped)
}

func TestParseReportsEveryProblemSorted(t *testing.T) {
	src := "screens:\n  Bad:\n    presentation: x\n    title: T\n    area: a\n  a.b:\n    status: x\n" + req
	_, ds := Parse([]byte(src))
	require.Len(t, ds, 3)
	assert.Equal(t, []int{2, 3, 7}, []int{ds[0].Line, ds[1].Line, ds[2].Line})
}

func TestVocabulary(t *testing.T) {
	members := func(set map[string]bool) []string {
		var out []string
		for k, v := range set {
			assert.True(t, v, k)
			out = append(out, k)
		}
		slices.Sort(out)
		return out
	}
	assert.Equal(t, []string{
		"action", "banner", "bar", "card", "column", "field", "form", "header", "list",
		"map", "media", "menu", "nav", "primary-action", "row", "section", "tabs", "text",
	}, members(Kinds))
	assert.Equal(t, []string{"bar", "column", "row", "section"}, members(Containers))
	assert.Equal(t, []string{"menu", "nav", "tabs"}, members(NavKinds))
	assert.Equal(t, []string{"dialog", "push", "root", "route", "sheet", "tab", "window"}, members(Presentations))
	for k := range Containers {
		assert.True(t, Kinds[k], k)
	}
	for k := range NavKinds {
		assert.True(t, Kinds[k], k)
	}
	assert.True(t, IDPattern.MatchString("trip.timeline"))
	assert.True(t, RegionPattern.MatchString("app-bar"))
}

func TestParseNullSectionsAreEmpty(t *testing.T) {
	src := "screens:\n  a.b:\n    platforms:\n    files:\n    screenshots:\n    layouts:\n    layout:\n      - { region: x, kind: tabs, items: }\n" + req
	s := parseOK(t, src).Screens["a.b"]
	assert.Equal(t, &Screen{
		ID: "a.b", Title: "T", Area: "a", Presentation: "push", Line: 2,
		Layout: []*Region{{Name: "x", Kind: "tabs", Line: 8}},
		FieldLines: map[string]int{"platforms": 3, "files": 4, "screenshots": 5, "layouts": 6,
			"layout": 7, "title": 9, "area": 10, "presentation": 11},
	}, s)
	assert.Equal(t, 10, s.FieldLine("area"))
	assert.Equal(t, 2, s.FieldLine("purpose"), "a field not written is on the screen's line")
	s = parseOK(t, "screens:\n  a.b:\n    layout:\n"+req).Screens["a.b"]
	assert.Nil(t, s.Layout)
}
