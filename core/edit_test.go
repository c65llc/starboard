// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package core

import (
	"encoding/json"
	"flag"
	"maps"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/diag"
)

var update = flag.Bool("update", false, "rewrite core/testdata/edit's golden files")

const (
	screensFile = "docs/flows/screens.yaml"
	addFlowFile = "docs/flows/flows/add-activity.md"
)

// editProject is core/testdata/edit/project.txtar.
func editProject(t *testing.T) Files {
	t.Helper()
	return archive(t, filepath.Join("testdata", "edit", "project.txtar"))
}

// golden compares got with core/testdata/edit/name, or rewrites it.
func golden(t *testing.T, name, got string) {
	t.Helper()
	file := filepath.Join("testdata", "edit", name)
	if *update {
		require.NoError(t, os.WriteFile(file, []byte(got), 0o600))
	}
	want, err := os.ReadFile(file) //nolint:gosec // a test fixture
	require.NoError(t, err)
	assert.Equal(t, string(want), got)
}

// jsonValue round-trips v through JSON, as a value from the web app comes.
func jsonValue(t *testing.T, v string) any {
	t.Helper()
	var out any
	require.NoError(t, json.Unmarshal([]byte(v), &out))
	return out
}

func TestEditOps(t *testing.T) {
	tl := "trip.timeline"
	cases := []struct {
		name string
		file string // the one file the edit changes
		ops  []EditOp
	}{
		{"set-label.yaml", screensFile, []EditOp{{Op: "set", Screen: tl, Path: "layout[0].children[0]", Key: "label", Value: "Trip title"}}},
		{"set-remove-key.yaml", screensFile, []EditOp{{Op: "set", Screen: tl, Path: "layout[2]", Key: "requires", Value: nil}}},
		{"set-screen-key.yaml", screensFile, []EditOp{{Op: "set", Screen: tl, Key: "purpose", Value: "Every day of the trip."}}},
		{"set-item.yaml", screensFile, []EditOp{{Op: "set", Screen: tl, Path: "layout[1].item", Key: "label", Value: "Activity card"}}},
		{"set-nav-item.yaml", screensFile, []EditOp{{Op: "set", Screen: tl, Path: "layout[3].items[1]", Key: "status", Value: nil}}},
		{"set-in-override.yaml", screensFile, []EditOp{{Op: "set", Screen: tl, Path: "layouts.web-wide[0].children[0]", Key: "width", Value: jsonValue(t, "200")}}},
		{"set-override-layout.yaml", screensFile, []EditOp{{Op: "set", Screen: "activity.editor", Key: "layouts.phone", Value: jsonValue(t,
			`[{"region":"title","kind":"field","label":"Title"},{"region":"save","kind":"primary-action","label":"Save","to":"trip.timeline"}]`)}}},
		{"set-nested-status.yaml", screensFile, []EditOp{{Op: "set", Screen: "activity.editor", Key: "status.web", Value: "shipped"}}},
		{"add-screen.yaml", screensFile, []EditOp{{Op: "addScreen", Value: jsonValue(t,
			`{"id":"trip.costs","title":"Costs","area":"trip","presentation":"push"}`)}}},
		{"remove-screen.yaml", screensFile, []EditOp{{Op: "removeScreen", Screen: "activity.editor"}}},
		{"insert-region-top.yaml", screensFile, []EditOp{{Op: "insertRegion", Screen: tl, Index: 1, Value: jsonValue(t,
			`{"region":"banner","kind":"text","label":"Day 1"}`)}}},
		{"insert-region-child.yaml", screensFile, []EditOp{{Op: "insertRegion", Screen: tl, Path: "layout[0]", Index: 1, Value: jsonValue(t,
			`{"region":"share","kind":"button","label":"Share"}`)}}},
		{"insert-region-new-children.yaml", screensFile, []EditOp{{Op: "insertRegion", Screen: tl, Path: "layout[2]", Index: 0, Value: jsonValue(t,
			`{"region":"icon","kind":"image"}`)}}},
		{"insert-region-override.yaml", screensFile, []EditOp{{Op: "insertRegion", Screen: tl, Path: "layouts.web-wide", Index: 1, Value: jsonValue(t,
			`{"region":"footer","kind":"text","label":"Footer"}`)}}},
		{"remove-region.yaml", screensFile, []EditOp{{Op: "removeRegion", Screen: tl, Path: "layout[2]"}}},
		{"remove-nav-item.yaml", screensFile, []EditOp{{Op: "removeRegion", Screen: tl, Path: "layout[3].items[1]"}}},
		{"move-region.yaml", screensFile, []EditOp{{Op: "moveRegion", Screen: tl, Path: "layout[3]", Index: 0}}},
		{"move-region-down.yaml", screensFile, []EditOp{{Op: "moveRegion", Screen: tl, Path: "layout[0]", Index: 2}}},
		{"set-flow-meta.md", addFlowFile, []EditOp{{Op: "setFlowMeta", Flow: "add-activity", Key: "title", Value: "Add a plan"}}},
		{"remove-flow-meta.md", addFlowFile, []EditOp{{Op: "setFlowMeta", Flow: "add-activity", Key: "entry", Value: nil}}},
		{"add-flow.md", "docs/flows/flows/plan-a-day.md", []EditOp{{Op: "addFlow", Flow: "plan-a-day", Value: jsonValue(t,
			`{"title":"Plan a day","status":"proposed","entry":"trip.timeline","actors":["organizer"]}`)}}},
		{"add-flow-title-only.md", "docs/flows/flows/plan-a-day.md", []EditOp{{Op: "addFlow", Flow: "plan-a-day", Value: jsonValue(t,
			`{"title":"Plan a day","entry":null}`)}}},
		{"write-flow-body.md", addFlowFile, []EditOp{{Op: "writeFlowBody", Flow: "add-activity",
			Value: "\n## Steps\n\n1. Tap @trip.timeline#add-activity.\n2. Tap @activity.editor#save.\n\n\n"}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := editProject(t)
			before := maps.Clone(f)
			got, err := Edit(f, c.ops)
			require.NoError(t, err)
			assert.Equal(t, before, f, "Edit never changes its input")
			require.Equal(t, []string{c.file}, keys(got.Files))
			golden(t, c.name, got.Files[c.file])

			// The result is canonical: formatting it changes nothing.
			maps.Copy(f, got.Files)
			again, err := Format(f)
			require.NoError(t, err)
			assert.Empty(t, again)
		})
	}
}

func keys(m map[string]string) []string {
	out := []string{}
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestEditPreservesUnrelatedComments(t *testing.T) {
	f := editProject(t)
	got, err := Edit(f, []EditOp{
		{Op: "set", Screen: "trip.timeline", Path: "layout[0].children[0]", Key: "label", Value: "Trip title"},
		{Op: "removeRegion", Screen: "trip.timeline", Path: "layout[2]"},
		{Op: "moveRegion", Screen: "trip.timeline", Path: "layout[2]", Index: 0},
		{Op: "set", Screen: "activity.editor", Key: "status.ios", Value: "beta"},
		{Op: "addScreen", Value: map[string]any{"id": "trip.costs", "title": "Costs", "area": "trip", "presentation": "push"}},
		{Op: "setFlowMeta", Flow: "add-activity", Key: "title", Value: "Add a plan"},
	})
	require.NoError(t, err)
	screens := got.Files[screensFile]
	for _, c := range []string{
		"# The trip screens.", "# The home of a trip.", "# The top bar.", "# the trip's name",
		"# not built yet", "# Wide screens get a side bar.", "# Opened as a sheet.", "# web is next",
	} {
		assert.Contains(t, screens, c)
	}
	assert.NotContains(t, screens, "# Adding needs logistics rights.", "a removed region's own comment goes with it")
	assert.Contains(t, got.Files[addFlowFile], "status: proposed # not yet shipped")
}

func TestEditAtomicOnError(t *testing.T) {
	f := editProject(t)
	before := maps.Clone(f)
	got, err := Edit(f, []EditOp{
		{Op: "set", Screen: "trip.timeline", Key: "title", Value: "Days"},
		{Op: "set", Screen: "nope.screen", Key: "title", Value: "Nope"},
	})
	require.ErrorIs(t, err, ErrUnknownScreen)
	assert.Equal(t, EditResult{}, got)
	assert.Equal(t, before, f)
}

func TestEditErrors(t *testing.T) {
	tl := "trip.timeline"
	region := map[string]any{"region": "x", "kind": "text"}
	cases := []struct {
		name string
		op   EditOp
		want error
		msg  string
	}{
		{"unknown op", EditOp{Op: "rename"}, ErrUnknownOp,
			"op 0 (rename): unknown edit op: rename; use one of addFlow, addScreen, insertRegion, moveRegion, removeRegion, removeScreen, set, setFlowMeta, writeFlowBody"},
		{"unknown screen", EditOp{Op: "removeScreen", Screen: "nope"}, ErrUnknownScreen,
			"op 0 (removeScreen): unknown screen: nope; use one of activity.editor, odd.layouts, odd.scalar, odd.screen, trip.timeline"},
		{"unknown flow", EditOp{Op: "setFlowMeta", Flow: "nope", Key: "title", Value: "x"}, ErrUnknownFlow,
			"op 0 (setFlowMeta): unknown flow: nope; use one of add-activity"},
		{"no layout key", EditOp{Op: "set", Screen: tl, Path: "layout", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"index out of range", EditOp{Op: "set", Screen: tl, Path: "layout[9]", Key: "label", Value: "x"}, ErrBadPath,
			"op 0 (set): invalid region path: layout[9]: trip.timeline has no layout[9]"},
		{"unknown root", EditOp{Op: "set", Screen: tl, Path: "states[0]", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"unknown key", EditOp{Op: "set", Screen: tl, Path: "layout[0].kids[0]", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"not a number", EditOp{Op: "set", Screen: tl, Path: "layout[x]", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"unclosed", EditOp{Op: "set", Screen: tl, Path: "layout[0", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"signed index", EditOp{Op: "set", Screen: tl, Path: "layout[+1]", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"leading zero", EditOp{Op: "set", Screen: tl, Path: "layout[01]", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"empty index", EditOp{Op: "set", Screen: tl, Path: "layout[]", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"empty segment", EditOp{Op: "set", Screen: tl, Path: "layout[0]..item", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"no item", EditOp{Op: "set", Screen: tl, Path: "layout[0].item", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"no override", EditOp{Op: "set", Screen: tl, Path: "layouts.phone[0]", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"layouts alone", EditOp{Op: "set", Screen: tl, Path: "layouts", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"past a nav item", EditOp{Op: "set", Screen: tl, Path: "layout[3].items[0].children[0]", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"index a region", EditOp{Op: "set", Screen: tl, Path: "layout[0][0]", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"set on a list", EditOp{Op: "set", Screen: tl, Path: "layout[0].children", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"empty key", EditOp{Op: "set", Screen: tl, Key: "", Value: "x"}, ErrBadEdit, ""},
		{"empty key part", EditOp{Op: "set", Screen: tl, Key: "layouts.", Value: "x"}, ErrBadEdit, ""},
		{"key through a scalar", EditOp{Op: "set", Screen: tl, Key: "title.text", Value: "x"}, ErrBadEdit,
			"op 0 (set): invalid edit: title is not a mapping"},
		{"unencodable value", EditOp{Op: "set", Screen: tl, Key: "title", Value: func() {}}, ErrBadEdit, ""},
		{"unencodable in a list", EditOp{Op: "set", Screen: tl, Key: "layout", Value: []any{nil, func() {}}}, ErrBadEdit, ""},
		{"unencodable in a mapping", EditOp{Op: "set", Screen: tl, Key: "status", Value: map[string]any{"ios": math.Inf(1)}}, ErrBadEdit, ""},
		{"add without id", EditOp{Op: "addScreen", Value: map[string]any{"title": "x"}}, ErrBadEdit, ""},
		{"add not a mapping", EditOp{Op: "addScreen", Value: "trip.costs"}, ErrBadEdit, ""},
		{"add twice", EditOp{Op: "addScreen", Value: map[string]any{"id": tl}}, ErrBadEdit,
			"op 0 (addScreen): invalid edit: screen trip.timeline already exists"},
		{"insert not a mapping", EditOp{Op: "insertRegion", Screen: tl, Value: "banner"}, ErrBadEdit, ""},
		{"insert past the end", EditOp{Op: "insertRegion", Screen: tl, Index: 5, Value: region}, ErrBadEdit,
			"op 0 (insertRegion): invalid edit: index 5 is outside 0..4"},
		{"insert before the start", EditOp{Op: "insertRegion", Screen: tl, Index: -1, Value: region}, ErrBadEdit, ""},
		{"insert into a nav item", EditOp{Op: "insertRegion", Screen: tl, Path: "layout[3].items[0]", Value: region}, ErrBadPath, ""},
		{"insert into children that are not a list", EditOp{Op: "insertRegion", Screen: "odd.screen", Path: "layout[0]", Value: region}, ErrBadEdit, ""},
		{"insert into a layout that is not a list", EditOp{Op: "insertRegion", Screen: "odd.screen", Path: "layouts.phone", Value: region}, ErrBadPath, ""},
		{"remove an item", EditOp{Op: "removeRegion", Screen: tl, Path: "layout[1].item"}, ErrBadPath, ""},
		{"remove a list", EditOp{Op: "removeRegion", Screen: tl, Path: "layout"}, ErrBadPath, ""},
		{"move past the end", EditOp{Op: "moveRegion", Screen: tl, Path: "layout[0]", Index: 4}, ErrBadEdit,
			"op 0 (moveRegion): invalid edit: index 4 is outside 0..3"},
		{"move an item", EditOp{Op: "moveRegion", Screen: tl, Path: "layout[1].item"}, ErrBadPath, ""},
		{"body not a string", EditOp{Op: "writeFlowBody", Flow: "add-activity", Value: 3.0}, ErrBadEdit, ""},
		{"flow key empty", EditOp{Op: "setFlowMeta", Flow: "add-activity", Key: "", Value: "x"}, ErrBadEdit, ""},
		{"screen not a mapping", EditOp{Op: "set", Screen: "odd.scalar", Key: "title", Value: "x"}, ErrBadEdit,
			"op 0 (set): invalid edit: screen odd.scalar is not a mapping"},
		{"layouts not a mapping", EditOp{Op: "set", Screen: "odd.layouts", Path: "layouts.phone[0]", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"no layouts", EditOp{Op: "set", Screen: "activity.editor", Path: "layouts.phone[0]", Key: "label", Value: "x"}, ErrBadPath, ""},
		{"insert bad value", EditOp{Op: "insertRegion", Screen: tl, Value: []any{func() {}}}, ErrBadEdit, ""},
		{"insert past a list's end", EditOp{Op: "insertRegion", Screen: tl, Path: "layouts.web-wide", Index: 2, Value: region}, ErrBadEdit, ""},
		{"add bad value", EditOp{Op: "addScreen", Value: map[string]any{"id": "a.b", "x": func() {}}}, ErrBadEdit, ""},
		{"add flow twice", EditOp{Op: "addFlow", Flow: "add-activity", Value: map[string]any{"title": "x"}}, ErrBadEdit,
			"op 0 (addFlow): invalid edit: flow add-activity already exists"},
		{"add flow bad id", EditOp{Op: "addFlow", Flow: "Plan a day", Value: map[string]any{"title": "x"}}, ErrBadEdit, ""},
		{"add flow empty id", EditOp{Op: "addFlow", Value: map[string]any{"title": "x"}}, ErrBadEdit, ""},
		{"add flow no title", EditOp{Op: "addFlow", Flow: "plan", Value: map[string]any{"status": "proposed"}}, ErrBadEdit,
			"op 0 (addFlow): invalid edit: a new flow needs a title"},
		{"add flow not a mapping", EditOp{Op: "addFlow", Flow: "plan", Value: "Plan"}, ErrBadEdit, ""},
		{"add flow unknown key", EditOp{Op: "addFlow", Flow: "plan", Value: map[string]any{"title": "x", "goal": "y"}}, ErrBadEdit,
			"op 0 (addFlow): invalid edit: a new flow's front matter may set title, status, entry, actors, platforms, not goal"},
		{"add flow sets id", EditOp{Op: "addFlow", Flow: "plan", Value: map[string]any{"title": "x", "id": "other"}}, ErrBadEdit, ""},
		{"add flow bad value", EditOp{Op: "addFlow", Flow: "plan", Value: map[string]any{"title": func() {}}}, ErrBadEdit, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := editProject(t)
			f[screensFile] += "  odd.screen:\n    title: Odd\n    layout:\n      - region: a\n        children: nope\n    layouts:\n      phone: nope\n" +
				"  odd.scalar: nope\n  odd.layouts:\n    title: Odd\n    layouts: nope\n"
			got, err := Edit(f, []EditOp{c.op})
			require.ErrorIs(t, err, c.want)
			if c.msg != "" {
				assert.EqualError(t, err, c.msg)
			}
			assert.Equal(t, EditResult{}, got)
		})
	}
}

func TestEditProjectErrors(t *testing.T) {
	set := []EditOp{{Op: "set", Screen: "trip.timeline", Key: "title", Value: "x"}}

	_, err := Edit(Files{"README.md": "x"}, set)
	require.ErrorIs(t, err, ErrNoProject)

	f := editProject(t)
	f["../up.md"] = "x"
	_, err = Edit(f, set)
	require.ErrorIs(t, err, ErrInvalidPath)

	_, err = Edit(Files{config.FileName: "version: [1\n"}, set)
	require.ErrorIs(t, err, ErrNotLoaded)

	// A content directory outside the project has no registry to edit.
	_, err = Edit(Files{config.FileName: "version: 1\ncontent: ../out\n"}, set)
	require.ErrorIs(t, err, ErrNotLoaded)

	// A registry that is not a mapping cannot take a new screen either.
	f = editProject(t)
	f[screensFile] = "- a\n"
	_, err = Edit(f, []EditOp{{Op: "addScreen", Value: map[string]any{"id": "a.b"}}})
	require.ErrorIs(t, err, ErrNotLoaded)

	for name, src := range map[string]string{
		"unreadable": "screens: [\n",
		"not a map":  "- a\n",
		"screens":    "screens: [a]\n",
	} {
		f = editProject(t)
		f[screensFile] = src
		_, err = Edit(f, set)
		require.ErrorIs(t, err, ErrNotLoaded, name)
	}

	// Front matter that does not parse, or is not a mapping, cannot be edited.
	for _, fm := range []string{"title: [x", "- a"} {
		f = editProject(t)
		f[addFlowFile] = "---\n" + fm + "\n---\n\nBody.\n"
		_, err = Edit(f, []EditOp{{Op: "setFlowMeta", Flow: "add-activity", Key: "title", Value: "x"}})
		require.ErrorIs(t, err, ErrNotLoaded, fm)
	}

	// The formatter refusing the result fails the edit: a body with a lone
	// CR is one it will not write.
	f = editProject(t)
	f[addFlowFile] = "---\ntitle: x\n---\n"
	_, err = Edit(f, []EditOp{{Op: "writeFlowBody", Flow: "add-activity", Value: "a\rb"}})
	require.ErrorIs(t, err, ErrBadEdit)
}

func TestEditEmptyRegistryAndFlows(t *testing.T) {
	// No screens.yaml yet: addScreen creates it.
	f := Files{config.FileName: "version: 1\nareas: [trip]\n"}
	got, err := Edit(f, []EditOp{
		{Op: "addScreen", Value: map[string]any{"id": "trip.home", "title": "Home", "area": "trip", "presentation": "root"}},
		{Op: "insertRegion", Screen: "trip.home", Value: map[string]any{"region": "title", "kind": "text", "label": "Hi"}},
	})
	require.NoError(t, err)
	assert.Equal(t, "screens:\n  trip.home:\n    title: Home\n    area: trip\n    presentation: root\n    layout:\n      - {region: title, kind: text, label: Hi}\n",
		got.Files[screensFile])

	// An empty screens.yaml, and one whose screens is null, are the same.
	for _, src := range []string{"", "screens:\n"} {
		f[screensFile] = src
		got, err = Edit(f, []EditOp{{Op: "addScreen", Value: map[string]any{"id": "trip.home"}}})
		require.NoError(t, err)
		assert.Equal(t, "screens:\n  trip.home: {}\n", got.Files[screensFile], "%q", src)
	}

	// A flow with no front matter gets one; its body stays.
	f = editProject(t)
	f[addFlowFile] = "## Steps\n\n1. Open @trip.timeline.\n"
	got, err = Edit(f, []EditOp{{Op: "setFlowMeta", Flow: "add-activity", Key: "id", Value: "add-activity"}})
	require.NoError(t, err)
	assert.Equal(t, "---\nid: add-activity\n---\n## Steps\n\n1. Open @trip.timeline.\n", got.Files[addFlowFile])
	got, err = Edit(f, []EditOp{{Op: "writeFlowBody", Flow: "add-activity", Value: "Hello.\n"}})
	require.NoError(t, err)
	assert.Equal(t, "Hello.\n", got.Files[addFlowFile])

	// An empty front matter is a mapping to add to; removing a missing key
	// changes nothing, and nothing is returned.
	f[addFlowFile] = "---\n---\nBody.\n"
	got, err = Edit(f, []EditOp{{Op: "setFlowMeta", Flow: "add-activity", Key: "status", Value: "proposed"}})
	require.NoError(t, err)
	assert.Equal(t, "---\nstatus: proposed\n---\nBody.\n", got.Files[addFlowFile])
	got, err = Edit(editProject(t), []EditOp{
		{Op: "setFlowMeta", Flow: "add-activity", Key: "actors", Value: nil},
		{Op: "set", Screen: "trip.timeline", Key: "layouts.phone", Value: nil},
	})
	require.NoError(t, err)
	assert.Empty(t, got.Files)
	assert.Equal(t, `{}`, marshal(t, got.Files))
}

func TestEditValues(t *testing.T) {
	// Values of every JSON type, and Go ints, are written as YAML; a later
	// op on a flow sees an earlier one's change.
	got, err := Edit(editProject(t), []EditOp{
		{Op: "set", Screen: "activity.editor", Key: "x.flag", Value: true},
		{Op: "set", Screen: "activity.editor", Key: "x.count", Value: 3},
		{Op: "set", Screen: "activity.editor", Key: "x.ratio", Value: 0.5},
		{Op: "set", Screen: "activity.editor", Key: "x.list", Value: []any{"a", nil, 1e20}},
		{Op: "set", Screen: "activity.editor", Key: "y.gone", Value: nil},
		{Op: "setFlowMeta", Flow: "add-activity", Key: "title", Value: "One"},
		{Op: "setFlowMeta", Flow: "add-activity", Key: "status", Value: "shipped"},
	})
	require.NoError(t, err)
	assert.Contains(t, got.Files[screensFile], "    x:\n      flag: true\n      count: 3\n      ratio: 0.5\n      list: [a, null, 1e+20]\n")
	assert.NotContains(t, got.Files[screensFile], "\n    y:")
	assert.Contains(t, got.Files[addFlowFile], "title: One\nstatus: shipped # not yet shipped\n")
}

func TestEditKeepsValueComment(t *testing.T) {
	f := editProject(t)
	got, err := Edit(f, []EditOp{{Op: "set", Screen: "activity.editor", Key: "status.web", Value: "beta"}})
	require.NoError(t, err)
	assert.Contains(t, got.Files[screensFile], "web: beta # web is next")
}

func TestEditResultJSON(t *testing.T) {
	got, err := Edit(editProject(t), nil)
	require.NoError(t, err)
	out := marshal(t, got)
	assert.True(t, strings.HasPrefix(out, `{"files":{},"diagnostics":[`), out)

	var op EditOp
	require.NoError(t, json.Unmarshal([]byte(`{"op":"set","screen":"s","path":"layout[0]","key":"label","value":"x","index":2,"flow":"f"}`), &op))
	assert.Equal(t, EditOp{Op: "set", Screen: "s", Path: "layout[0]", Key: "label", Value: "x", Index: 2, Flow: "f"}, op)
}

// TestEditThenLintSameAsCLI checks that Edit's diagnostics are those
// `starboard lint --json` gives for the edited files.
func TestEditThenLintSameAsCLI(t *testing.T) {
	f := editProject(t)
	got, err := Edit(f, []EditOp{
		{Op: "set", Screen: "trip.timeline", Path: "layout[2]", Key: "kind", Value: "rocket"},
		{Op: "set", Screen: "trip.timeline", Path: "layout[1].item", Key: "to", Value: "nope.screen"},
	})
	require.NoError(t, err)
	maps.Copy(f, got.Files)
	code, out := starboard(t, "--dir", writeTree(t, f), "lint", "--json")
	var want cliReport
	require.NoError(t, json.Unmarshal([]byte(out), &want), out)
	assert.NotEqual(t, 0, code)
	assert.Equal(t, marshal(t, want.Errors), marshal(t, bySeverity(got.Diagnostics, diag.Error)))
	assert.Equal(t, marshal(t, want.Warnings), marshal(t, bySeverity(got.Diagnostics, diag.Warn)))
	assert.Len(t, got.Diagnostics, len(want.Errors)+len(want.Warnings))
	assert.Contains(t, marshal(t, got.Diagnostics), "rocket", "the edit's own problem is reported")
	assert.Contains(t, marshal(t, got.Diagnostics), "nope.screen")
}

// FuzzEditSetLabel sets a region's label to any text and reads it back.
func FuzzEditSetLabel(f *testing.F) {
	for _, s := range []string{"Trip title", "", "a: b", "# not a comment", "- dash", "{x}", "日本語", "\"quoted\"", "x\ny", " lead", "trail ", "\t", "null", "12", "\uFEFF", "e\u0301"} {
		f.Add(s)
	}
	base := archive(f, filepath.Join("testdata", "edit", "project.txtar"))
	f.Fuzz(func(t *testing.T, label string) {
		if !utf8.ValidString(label) {
			t.Skip("JSON carries only UTF-8")
		}
		files := maps.Clone(base)
		got, err := Edit(files, []EditOp{{Op: "set", Screen: "trip.timeline", Path: "layout[0].children[0]", Key: "label", Value: label}})
		require.NoError(t, err)
		maps.Copy(files, got.Files)
		m, err := Model(files)
		require.NoError(t, err)
		require.Equal(t, "trip.timeline", m.Screens[0].ID)
		assert.Equal(t, label, m.Screens[0].Layout[0].Children[0].Label)
	})
}

// listEnd is a registry whose layout ends in a region with its own head and
// foot comments, followed by a key with a head comment: the comments yaml
// can hand to the wrong node at the end of a list.
const listEnd = `screens:
  trip.timeline:
    title: Timeline
    area: trip
    purpose: Days.
    presentation: root
    layout:
      - {region: first, kind: text, label: First} # first's line note
      # The last region.
      - region: last
        kind: text
        label: Last # last's line note
        # last's own foot note.
    # The overrides follow.
    layouts:
      web-wide:
        - {region: wide, kind: text, label: Wide}
`

func TestEditListEndComments(t *testing.T) {
	for _, c := range []struct {
		name string
		op   EditOp
	}{
		{"list-end-remove.yaml", EditOp{Op: "removeRegion", Screen: "trip.timeline", Path: "layout[1]"}},
		{"list-end-move.yaml", EditOp{Op: "moveRegion", Screen: "trip.timeline", Path: "layout[1]", Index: 0}},
		{"list-end-move-first.yaml", EditOp{Op: "moveRegion", Screen: "trip.timeline", Path: "layout[0]", Index: 1}},
	} {
		t.Run(c.name, func(t *testing.T) {
			f := editProject(t)
			f[screensFile] = listEnd
			got, err := Edit(f, []EditOp{c.op})
			require.NoError(t, err)
			out := got.Files[screensFile]
			golden(t, c.name, out)
			assert.Contains(t, out, "    # The overrides follow.\n    layouts:", "the next key keeps its head comment")
			assert.Contains(t, out, "# first's line note")
			last := []string{"# The last region.", "# last's line note", "# last's own foot note."}
			for _, cm := range last {
				if c.op.Op == "removeRegion" {
					assert.NotContains(t, out, cm, "a removed region's comments go with it")
				} else {
					assert.Contains(t, out, cm)
				}
			}
		})
	}
}

// TestEditNestedListEndComments is TestEditListEndComments one level down:
// the last child has its own foot comment and the parent's next region a
// head comment.
func TestEditNestedListEndComments(t *testing.T) {
	f := editProject(t)
	f[screensFile] = `screens:
  trip.timeline:
    title: Timeline
    area: trip
    purpose: Days.
    presentation: root
    layout:
      - region: bar
        kind: bar
        children:
          - {region: a, kind: text, label: A}
          - region: b
            kind: text
            label: B
            # b's own foot note.
      # The next region.
      - {region: next, kind: text, label: Next}
`
	got, err := Edit(f, []EditOp{{Op: "removeRegion", Screen: "trip.timeline", Path: "layout[0].children[1]"}})
	require.NoError(t, err)
	golden(t, "list-end-nested-remove.yaml", got.Files[screensFile])
	assert.NotContains(t, got.Files[screensFile], "# b's own foot note.")
	assert.Contains(t, got.Files[screensFile], "      # The next region.\n      - {region: next")
}

func TestEditFlowBodyEmptyFrontMatter(t *testing.T) {
	f := editProject(t)
	f[addFlowFile] = "---\n---\n"
	got, err := Edit(f, []EditOp{{Op: "writeFlowBody", Flow: "add-activity", Value: "\n\n## Steps\n\n1. Open @trip.timeline.  \n"}})
	require.NoError(t, err)
	assert.Equal(t, "---\n---\n\n## Steps\n\n1. Open @trip.timeline.\n", got.Files[addFlowFile])
	maps.Copy(f, got.Files)
	again, err := Format(f)
	require.NoError(t, err)
	assert.NotContains(t, again, addFlowFile, "canonical")
	same, err := Edit(f, []EditOp{{Op: "writeFlowBody", Flow: "add-activity", Value: "\n## Steps\n\n1. Open @trip.timeline.\n"}})
	require.NoError(t, err)
	assert.Empty(t, same.Files, "stable: writing the same body changes nothing")
}
