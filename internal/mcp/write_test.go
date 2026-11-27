// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package mcp

import (
	"encoding/json"
	"errors"
	"io/fs"
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
		"id is required":             {"body": "x"},
		"nothing to set":             {"id": "add-activity"},
		"a new flow needs a":         {"id": "untitled", "body": "x"},
		"a flow ID is lowercase":     {"id": "Bad_ID", "frontMatter": map[string]any{"title": "Bad"}},
		"frontMatter may not set id": {"id": "add-activity", "frontMatter": map[string]any{"id": "other"}},
	} {
		before := maps.Clone(fsys)
		assert.Contains(t, fails(t, fsys, "starboard_flow_set", args), msg)
		assert.Equal(t, before, fsys)
	}
}

func TestGenerate(t *testing.T) {
	fsys := travelApp(t)
	type genResult struct {
		Preview          bool
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
	ok(t, fsys, "starboard_generate", map[string]any{"preview": true}, &check)
	assert.True(t, check.Preview)
	assert.Contains(t, check.Written, "docs/flows/generated/screens.md")
	assert.Contains(t, check.Removed, "docs/flows/generated/wireframes/trip.packing.phone.svg")
	assert.Equal(t, before, fsys, "a preview changes nothing")

	ok(t, fsys, "starboard_generate", nil, &g)
	assert.Equal(t, check.Written, g.Written)
	assert.Equal(t, check.Removed, g.Removed)
	assert.NotContains(t, fsys, "docs/flows/generated/wireframes/trip.packing.phone.svg")
	var report struct{ Errors, Warnings []diag.Diagnostic }
	ok(t, fsys, "starboard_lint", nil, &report)
	assert.NotContains(t, ruleIDs(report.Errors), "generated-stale")
	assert.NotContains(t, ruleIDs(report.Warnings), "generated-stale")

	fsys[registryFile] = []byte("screens:\n  trip.map: [\n")
	assert.Contains(t, fails(t, fsys, "starboard_generate", nil), "the project has load errors, so nothing was generated; starboard_lint reports them")
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

// previewResult is a set tool's result with preview.
type previewResult struct {
	Preview       bool
	Written       []string
	Files         map[string]string
	RecordVersion string
	Lint          json.RawMessage
}

// A preview returns what the write would write and the lint it would
// give, and writes nothing.
func TestPreview(t *testing.T) {
	for _, tc := range []struct {
		name string
		tool string
		args map[string]any
	}{
		{"update screen", "starboard_screen_set", map[string]any{"id": "trip.map", "fields": map[string]any{"title": "Places"}}},
		{"new screen", "starboard_screen_set", map[string]any{"id": "trip.notes", "fields": map[string]any{"title": "Notes", "area": "trip"}}},
		{"delete screen", "starboard_screen_set", map[string]any{"id": "trip.packing", "delete": true}},
		{"new flow", "starboard_flow_set", map[string]any{"id": "read-notes", "frontMatter": map[string]any{"title": "Read notes"}, "body": "\n## Steps\n\n1. Open @trip.map.\n"}},
		{"update flow", "starboard_flow_set", map[string]any{"id": "add-activity", "frontMatter": map[string]any{"status": "proposed"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fsys := travelApp(t)
			before := maps.Clone(fsys)
			args := maps.Clone(tc.args)
			args["preview"] = true
			var pre previewResult
			ok(t, fsys, tc.tool, args, &pre)
			assert.Equal(t, before, fsys, "a preview writes nothing")
			assert.True(t, pre.Preview)
			require.Len(t, pre.Written, 1)
			require.Len(t, pre.Files, 1)

			var done previewResult
			ok(t, fsys, tc.tool, tc.args, &done)
			assert.False(t, done.Preview)
			assert.Nil(t, done.Files, "a write does not echo the files")
			assert.Equal(t, pre.Written, done.Written)
			assert.Equal(t, pre.Files[pre.Written[0]], string(fsys[pre.Written[0]]), "the preview is what was written")
			assert.JSONEq(t, string(done.Lint), string(pre.Lint), "the preview's lint is the write's")
			assert.Equal(t, done.RecordVersion, pre.RecordVersion)
		})
	}

	// Nothing to change: the preview lists no files.
	var pre previewResult
	ok(t, travelApp(t), "starboard_screen_set", map[string]any{"id": "trip.timeline", "fields": map[string]any{"title": "Timeline"}, "preview": true}, &pre)
	assert.Equal(t, []string{}, pre.Written)
	assert.Equal(t, map[string]string{}, pre.Files)
}

// The overlay a preview lints lists a new file beside the old ones, and
// a directory that only the overlay has.
func TestOverlay(t *testing.T) {
	o := overlay{base: project.MemFS{"a/x.md": []byte("x")}, files: project.MemFS{"a/y.md": []byte("y"), "a/x.md": []byte("x2"), "b/z.md": []byte("z")}}
	entries, err := fs.ReadDir(o, "a")
	require.NoError(t, err)
	require.Len(t, entries, 2)
	assert.Equal(t, "x.md", entries[0].Name())
	assert.Equal(t, "y.md", entries[1].Name())
	data, err := fs.ReadFile(o, "a/x.md")
	require.NoError(t, err)
	assert.Equal(t, "x2", string(data))
	entries, err = fs.ReadDir(o, "b")
	require.NoError(t, err)
	assert.Len(t, entries, 1)
	_, err = fs.ReadDir(o, "c")
	require.ErrorIs(t, err, fs.ErrNotExist)
	_, err = fs.ReadDir(overlay{base: failingDir{}, files: project.MemFS{}}, "a")
	require.ErrorContains(t, err, "unreadable")
}

// failingDir fails every read.
type failingDir struct{}

func (failingDir) Open(string) (fs.File, error) { return nil, errors.New("unreadable") }

// An edit made on a stale read is refused, and nothing is written.
func TestBaseVersion(t *testing.T) {
	fsys := travelApp(t)
	type got struct{ RecordVersion string }
	var screen, flow got
	ok(t, fsys, "starboard_screen_get", map[string]any{"id": "trip.map"}, &screen)
	ok(t, fsys, "starboard_flow_get", map[string]any{"id": "add-activity"}, &flow)
	assert.Regexp(t, `^sha256:[0-9a-f]{64}$`, screen.RecordVersion)
	assert.Regexp(t, `^sha256:[0-9a-f]{64}$`, flow.RecordVersion)

	// Another screen's change, or a change fmt would undo, is not a change to this one.
	ok(t, fsys, "starboard_screen_set", map[string]any{"id": "trip.info", "fields": map[string]any{"title": "About the trip"}}, nil)
	var again got
	ok(t, fsys, "starboard_screen_get", map[string]any{"id": "trip.map"}, &again)
	assert.Equal(t, screen, again)

	// The matching version is accepted, and the result carries the next one.
	var wrote previewResult
	ok(t, fsys, "starboard_screen_set", map[string]any{"id": "trip.map", "fields": map[string]any{"title": "Places"}, "baseVersion": screen.RecordVersion}, &wrote)
	assert.NotEqual(t, screen.RecordVersion, wrote.RecordVersion)
	ok(t, fsys, "starboard_screen_get", map[string]any{"id": "trip.map"}, &again)
	assert.Equal(t, wrote.RecordVersion, again.RecordVersion)

	// The stale one is a conflict.
	before := maps.Clone(fsys)
	msg := fails(t, fsys, "starboard_screen_set", map[string]any{"id": "trip.map", "fields": map[string]any{"title": "Maps"}, "baseVersion": screen.RecordVersion})
	assert.Contains(t, msg, "conflict: screen trip.map changed since you read it")
	msg = fails(t, fsys, "starboard_screen_set", map[string]any{"id": "trip.gone", "fields": map[string]any{"title": "Gone"}, "baseVersion": screen.RecordVersion})
	assert.Contains(t, msg, "conflict: screen trip.gone no longer exists")
	assert.Equal(t, before, fsys)

	ok(t, fsys, "starboard_flow_set", map[string]any{"id": "add-activity", "frontMatter": map[string]any{"status": "proposed"}, "baseVersion": flow.RecordVersion}, &wrote)
	msg = fails(t, fsys, "starboard_flow_set", map[string]any{"id": "add-activity", "body": "x", "baseVersion": flow.RecordVersion})
	assert.Contains(t, msg, "conflict: flow add-activity changed since you read it")

	// A deleted screen has no version left.
	ok(t, fsys, "starboard_screen_set", map[string]any{"id": "trip.packing", "delete": true}, &wrote)
	assert.Empty(t, wrote.RecordVersion)
}

func TestRecordVersionHelpers(t *testing.T) {
	p, _, err := project.Load(travelApp(t))
	require.NoError(t, err)
	assert.Empty(t, screenVersion(p, "trip.nope"))
	assert.Empty(t, flowVersion(p, "nope"))
	// The last screen in the file runs to the end.
	last := p.Registry.Order[len(p.Registry.Order)-1]
	assert.NotEmpty(t, screenVersion(p, last))
	// An unformattable registry is hashed as it is.
	p.Sources["docs/flows/screens.yaml"] = []byte("screens: [\n")
	assert.Equal(t, hash(p.Sources["docs/flows/screens.yaml"]), screenVersion(p, last))
	p.Sources["docs/flows/flows/add-activity.md"] = []byte("---\nid: [\n")
	assert.Equal(t, hash(p.Sources["docs/flows/flows/add-activity.md"]), flowVersion(p, "add-activity"))
}
