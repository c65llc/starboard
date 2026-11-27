// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package mcp

import (
	"errors"
	"maps"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/core"
	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/project"
)

const registryFile = "docs/flows/screens.yaml"

// writeResult is a set tool's result.
type writeResult struct {
	Version int
	Written []string
	Lint    struct {
		Version          int
		Errors, Warnings []diag.Diagnostic
	}
}

func ruleIDs(ds []diag.Diagnostic) []string {
	var out []string
	for _, d := range ds {
		out = append(out, d.Rule)
	}
	return out
}

// formatted fails the test unless starboard fmt would change nothing in
// fsys: what a write leaves is byte for byte fmt's output.
func formatted(t *testing.T, fsys project.MemFS) {
	t.Helper()
	files := core.Files{}
	for name, data := range fsys {
		files[name] = string(data)
	}
	changed, err := core.Format(files)
	require.NoError(t, err)
	assert.Empty(t, changed, "fmt would change these files")
}

func TestScreenSetCreates(t *testing.T) {
	fsys := travelApp(t)
	var r writeResult
	ok(t, fsys, "starboard_screen_set", map[string]any{"id": "trip.notes", "fields": map[string]any{
		"title": "Notes", "area": "trip", "purpose": "Shared notes for the trip.", "presentation": "push", "status": "proposed",
		"layout": []any{map[string]any{"region": "notes", "kind": "text", "label": "The notes"}},
	}}, &r)
	assert.Equal(t, 1, r.Version)
	assert.Equal(t, []string{registryFile}, r.Written)
	formatted(t, fsys)
	assert.Contains(t, string(fsys[registryFile]), "  trip.notes:\n    title: Notes\n")
	assert.Contains(t, ruleIDs(r.Lint.Errors), "generated-stale", "the generated pages are now behind")

	var got struct{ Screen core.Screen }
	ok(t, fsys, "starboard_screen_get", map[string]any{"id": "trip.notes"}, &got)
	assert.Equal(t, "notes", got.Screen.Layout[0].Name)
	assert.Equal(t, "proposed", got.Screen.Status["ios"])
}

func TestScreenSetUpdates(t *testing.T) {
	fsys := travelApp(t)
	var r writeResult
	ok(t, fsys, "starboard_screen_set", map[string]any{"id": "trip.timeline", "fields": map[string]any{
		"status.web": "proposed", "purpose": "The days of the trip.", "states": nil,
	}}, &r)
	assert.Equal(t, []string{registryFile}, r.Written)
	formatted(t, fsys)
	src := string(fsys[registryFile])
	assert.Contains(t, src, "purpose: The days of the trip.")
	assert.Contains(t, src, "# None of these files exists yet, on purpose", "comments elsewhere stay")
	var got struct{ Screen core.Screen }
	ok(t, fsys, "starboard_screen_get", map[string]any{"id": "trip.timeline"}, &got)
	assert.Equal(t, map[string]string{"ios": "shipped", "android": "shipped", "web": "proposed"}, got.Screen.Status)
	assert.NotContains(t, src[strings.Index(src, "trip.timeline:"):strings.Index(src, "activity.add:")], "states:")

	// Setting what is already there writes nothing.
	ok(t, fsys, "starboard_screen_set", map[string]any{"id": "trip.timeline", "fields": map[string]any{"title": "Timeline"}}, &r)
	assert.Equal(t, []string{}, r.Written)
}

func TestScreenSetWritesDespiteLintErrors(t *testing.T) {
	fsys := travelApp(t)
	var r writeResult
	ok(t, fsys, "starboard_screen_set", map[string]any{"id": "trip.packing", "delete": true}, &r)
	assert.Equal(t, []string{registryFile}, r.Written)
	assert.NotContains(t, string(fsys[registryFile]), "trip.packing:")
	assert.Contains(t, ruleIDs(r.Lint.Errors), "edge-unresolved", "trip.checklist still leads to it")
	formatted(t, fsys)
}

func TestScreenSetRefusals(t *testing.T) {
	for args, want := range map[string]map[string]any{
		"id is required":            {"fields": map[string]any{"title": "X"}},
		"not both":                  {"id": "trip.map", "delete": true, "fields": map[string]any{"title": "X"}},
		"fields is empty":           {"id": "trip.map"},
		"fields may not set id":     {"id": "trip.map", "fields": map[string]any{"id": "trip.other"}},
		"unknown screen: trip.nope": {"id": "trip.nope", "delete": true},
		`key "a..b" must be a name`: {"id": "trip.map", "fields": map[string]any{"a..b": 1}},
		"title is not a mapping":    {"id": "trip.map", "fields": map[string]any{"title.x": 1}},
	} {
		fsys := travelApp(t)
		before := maps.Clone(fsys)
		msg := fails(t, fsys, "starboard_screen_set", want)
		assert.Contains(t, msg, args)
		assert.NotContains(t, msg, "op 0", "the op wrapper is dropped")
		assert.Equal(t, before, fsys, "a refused edit writes nothing: %s", args)
	}
}

func TestFlowSet(t *testing.T) {
	fsys := travelApp(t)
	var r writeResult
	body := "\n**Goal:** write a note.\n\n## Steps\n\n1. Open @trip.timeline#info.\n"
	ok(t, fsys, "starboard_flow_set", map[string]any{"id": "write-a-note", "frontMatter": map[string]any{
		"title": "Write a note", "status": "proposed", "entry": "trip.timeline", "actors": []any{"traveller"},
	}, "body": body}, &r)
	const file = "docs/flows/flows/write-a-note.md"
	assert.Equal(t, []string{file}, r.Written)
	formatted(t, fsys)
	assert.Equal(t, "---\nid: write-a-note\ntitle: Write a note\nstatus: proposed\nactors: [traveller]\nentry: trip.timeline\n---\n"+body, string(fsys[file]))

	ok(t, fsys, "starboard_flow_set", map[string]any{"id": "write-a-note", "frontMatter": map[string]any{"status": "shipped", "actors": nil}}, &r)
	assert.Equal(t, "---\nid: write-a-note\ntitle: Write a note\nstatus: shipped\nentry: trip.timeline\n---\n"+body, string(fsys[file]))

	ok(t, fsys, "starboard_flow_set", map[string]any{"id": "write-a-note", "body": "\n## Steps\n\n1. Open @trip.timeline.\n\n\n"}, &r)
	assert.True(t, strings.HasSuffix(string(fsys[file]), "\n## Steps\n\n1. Open @trip.timeline.\n"), "the body is formatted")
	formatted(t, fsys)

	// A new flow with no body gets an empty Steps section.
	ok(t, fsys, "starboard_flow_set", map[string]any{"id": "bare", "frontMatter": map[string]any{"title": "Bare"}}, &r)
	assert.Equal(t, "---\nid: bare\ntitle: Bare\n---\n\n## Steps\n", string(fsys["docs/flows/flows/bare.md"]))
	assert.NotEmpty(t, r.Lint.Errors, "the bare flow lacks fields lint requires")

	for msg, args := range map[string]map[string]any{
		"id is required":         {"body": "x"},
		"nothing to set":         {"id": "add-activity"},
		"a new flow needs a":     {"id": "untitled", "body": "x"},
		"a flow ID is lowercase": {"id": "Bad_ID", "frontMatter": map[string]any{"title": "Bad"}},
	} {
		before := maps.Clone(fsys)
		assert.Contains(t, fails(t, fsys, "starboard_flow_set", args), msg)
		assert.Equal(t, before, fsys)
	}
}

func TestGenerate(t *testing.T) {
	fsys := travelApp(t)
	type genResult struct {
		Check            bool
		Written, Removed []string
	}
	var g genResult
	ok(t, fsys, "starboard_generate", nil, &g)
	assert.Equal(t, genResult{Written: []string{}, Removed: []string{}}, g, "travel-app is current")

	ok(t, fsys, "starboard_screen_set", map[string]any{"id": "trip.packing", "delete": true}, nil)
	ok(t, fsys, "starboard_screen_set", map[string]any{"id": "trip.checklist", "fields": map[string]any{"layout": []any{
		map[string]any{"region": "items", "kind": "list", "label": "Items"},
	}}}, nil)
	before := maps.Clone(fsys)
	var check genResult
	ok(t, fsys, "starboard_generate", map[string]any{"check": true}, &check)
	assert.True(t, check.Check)
	assert.Contains(t, check.Written, "docs/flows/generated/screens.md")
	assert.Contains(t, check.Removed, "docs/flows/generated/wireframes/trip.packing.phone.svg")
	assert.Equal(t, before, fsys, "check changes nothing")

	ok(t, fsys, "starboard_generate", nil, &g)
	assert.Equal(t, check.Written, g.Written)
	assert.Equal(t, check.Removed, g.Removed)
	assert.NotContains(t, fsys, "docs/flows/generated/wireframes/trip.packing.phone.svg")
	var report struct{ Errors, Warnings []diag.Diagnostic }
	ok(t, fsys, "starboard_lint", nil, &report)
	assert.NotContains(t, ruleIDs(report.Errors), "generated-stale")
	assert.NotContains(t, ruleIDs(report.Warnings), "generated-stale")

	fsys[registryFile] = []byte("screens:\n  trip.map: [\n")
	assert.Contains(t, fails(t, fsys, "starboard_generate", nil), "the project has load errors, so nothing was generated: docs/flows/screens.yaml: ")
}

// failingFS is a project whose writes and removals fail.
type failingFS struct{ project.MemFS }

func (failingFS) WriteFile(string, []byte) error { return errors.New("read-only file system") }
func (failingFS) Remove(string) error            { return errors.New("read-only file system") }

func TestWriteFailures(t *testing.T) {
	fsys := travelApp(t)
	broken := failingFS{fsys}
	assert.Contains(t, fails(t, broken, "starboard_screen_set", map[string]any{"id": "trip.map", "fields": map[string]any{"title": "Map!"}}),
		"read-only file system")

	fsys[registryFile] = []byte(strings.Replace(string(fsys[registryFile]), "    title: Timeline\n", "    title: Timeline!\n", 1))
	assert.Contains(t, fails(t, broken, "starboard_generate", nil), "read-only file system")

	delete(fsys, registryFile) // every screen's pages are now extra
	assert.Contains(t, fails(t, broken, "starboard_generate", nil), "read-only file system")
}
