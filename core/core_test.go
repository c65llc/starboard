// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package core

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/rogpeppe/go-internal/txtar"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/cli"
	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/flows"
	"github.com/c65llc/starboard/internal/registry"
	"github.com/c65llc/starboard/internal/render"
)

// archive reads a txtar archive as Files.
func archive(t testing.TB, name string) Files {
	t.Helper()
	a, err := txtar.ParseFile(name)
	require.NoError(t, err)
	f := Files{}
	for _, file := range a.Files {
		f[file.Name] = string(file.Data)
	}
	return f
}

// trip is core/testdata/trip.txtar.
func trip(t *testing.T) Files {
	t.Helper()
	return archive(t, filepath.Join("testdata", "trip.txtar"))
}

// projects are every test project: each CLI script archive that holds a
// starboard.yaml, plus core/testdata.
func projects(t *testing.T) map[string]Files {
	t.Helper()
	names, err := filepath.Glob(filepath.Join("..", "cmd", "starboard", "testdata", "script", "*.txtar"))
	require.NoError(t, err)
	more, err := filepath.Glob(filepath.Join("testdata", "*.txtar"))
	require.NoError(t, err)
	out := map[string]Files{}
	for _, name := range append(names, more...) {
		if f := archive(t, name); f[config.FileName] != "" {
			out[filepath.Base(name)] = f
		}
	}
	require.GreaterOrEqual(t, len(out), 8, "the CLI scripts should give several projects")
	return out
}

// writeTree writes f under a new temporary directory and returns it.
func writeTree(t *testing.T, f Files) string {
	t.Helper()
	dir := t.TempDir()
	for name, data := range f {
		full := filepath.Join(dir, filepath.FromSlash(name))
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o750))
		require.NoError(t, os.WriteFile(full, []byte(data), 0o600))
	}
	return dir
}

// readTree reads every file under dir as Files.
func readTree(t *testing.T, dir string) Files {
	t.Helper()
	f := Files{}
	require.NoError(t, filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := os.ReadFile(p) //nolint:gosec // a path under the test's own temporary directory
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		f[filepath.ToSlash(rel)] = string(data)
		return nil
	}))
	return f
}

// starboard runs the CLI in-process and returns its exit status and stdout.
func starboard(t *testing.T, args ...string) (int, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := cli.Run(args, &stdout, &stderr)
	return code, stdout.String()
}

// cliReport is the document `starboard lint --json` writes.
type cliReport struct {
	Version  int               `json:"version"`
	Errors   []diag.Diagnostic `json:"errors"`
	Warnings []diag.Diagnostic `json:"warnings"`
}

func bySeverity(ds []diag.Diagnostic, sev diag.Severity) []diag.Diagnostic {
	out := []diag.Diagnostic{}
	for _, d := range ds {
		if d.Severity == sev {
			out = append(out, d)
		}
	}
	return out
}

func marshal(t *testing.T, v any) string {
	t.Helper()
	data, err := json.Marshal(v)
	require.NoError(t, err)
	return string(data)
}

// TestLintMatchesCLI checks core.Lint against `starboard lint --json` on
// the same files. The CLI's document splits the findings into errors and
// warnings, so each list is compared, byte for byte as JSON, with the
// findings of that severity, and the counts and pass/fail with the exit
// status, with and without --strict.
func TestLintMatchesCLI(t *testing.T) {
	for name, f := range projects(t) {
		t.Run(name, func(t *testing.T) {
			dir := writeTree(t, f)
			for _, strict := range []bool{false, true} {
				args := []string{"--dir", dir, "lint", "--json"}
				if strict {
					args = append(args, "--strict")
				}
				code, out := starboard(t, args...)
				var want cliReport
				require.NoError(t, json.Unmarshal([]byte(out), &want), out)

				got, err := Lint(f, strict)
				require.NoError(t, err)
				assert.Equal(t, marshal(t, want.Errors), marshal(t, bySeverity(got.Diagnostics, diag.Error)))
				assert.Equal(t, marshal(t, want.Warnings), marshal(t, bySeverity(got.Diagnostics, diag.Warn)))
				assert.Len(t, got.Diagnostics, got.Errors+got.Warnings)
				assert.Equal(t, len(want.Errors), got.Errors)
				assert.Equal(t, len(want.Warnings), got.Warnings)
				assert.Equal(t, code == cli.ExitOK, got.Passed, "strict=%v", strict)
			}
		})
	}
}

func TestLintJSONShape(t *testing.T) {
	got, err := Lint(Files{config.FileName: "version: 1\n"}, false)
	require.NoError(t, err)
	assert.JSONEq(t, `{"diagnostics":[],"errors":0,"warnings":0,"passed":true}`, marshal(t, got))
}

func TestLintStrictFailsOnWarnings(t *testing.T) {
	f := trip(t) // browse.md has a step with no reference, a warning
	loose, err := Lint(f, false)
	require.NoError(t, err)
	strict, err := Lint(f, true)
	require.NoError(t, err)
	assert.Positive(t, strict.Warnings)
	assert.Equal(t, loose.Diagnostics, strict.Diagnostics)
	assert.Equal(t, loose.Errors == 0, loose.Passed)
	assert.False(t, strict.Passed)
}

func TestLintUnreadableConfig(t *testing.T) {
	got, err := Lint(Files{config.FileName: "version: [1\n"}, false)
	require.NoError(t, err)
	require.NotEmpty(t, got.Diagnostics)
	assert.Equal(t, "yaml-syntax", got.Diagnostics[0].Rule)
	assert.False(t, got.Passed)
}

func TestNoProject(t *testing.T) {
	f := Files{"README.md": "hello"}
	_, err := Lint(f, false)
	require.ErrorIs(t, err, ErrNoProject)
	_, err = Format(f)
	require.ErrorIs(t, err, ErrNoProject)
	_, err = Generate(f)
	require.ErrorIs(t, err, ErrNoProject)
	_, err = Fix(f)
	require.ErrorIs(t, err, ErrNoProject)
	_, err = Render(f, "trip.timeline", "phone")
	require.ErrorIs(t, err, ErrNoProject)
	_, err = Model(f)
	require.ErrorIs(t, err, ErrNoProject)
	_, err = Walkthrough(f, "add-activity", "phone")
	require.ErrorIs(t, err, ErrNoProject)
}

func TestInvalidPath(t *testing.T) {
	for _, name := range []string{"/abs.md", "../up.md", "a/../b.md", `back\slash.md`, "", ".", "dir/"} {
		f := trip(t)
		f[name] = "x"
		_, err := Lint(f, false)
		require.ErrorIs(t, err, ErrInvalidPath, "%q", name)
		assert.Contains(t, err.Error(), "project-relative", "%q", name)
	}
}

func TestNotLoaded(t *testing.T) {
	broken := Files{config.FileName: "version: [1\n"}
	_, err := Generate(broken)
	require.ErrorIs(t, err, ErrNotLoaded)
	_, err = Fix(broken)
	require.ErrorIs(t, err, ErrNotLoaded)
	_, err = Render(broken, "trip.timeline", "phone")
	require.ErrorIs(t, err, ErrNotLoaded)
	_, err = Model(broken)
	require.ErrorIs(t, err, ErrNotLoaded)
	_, err = Walkthrough(broken, "add-activity", "phone")
	require.ErrorIs(t, err, ErrNotLoaded)

	// A load error elsewhere refuses generate and fix too, as the CLI does.
	f := trip(t)
	f["docs/flows/screens.yaml"] = "screens:\n  home.main:\n    presentation: modal\n"
	_, err = Generate(f)
	require.ErrorIs(t, err, ErrNotLoaded)
	_, err = Fix(f)
	require.ErrorIs(t, err, ErrNotLoaded)
}

func TestFormatOnlyChanged(t *testing.T) {
	f := trip(t)
	first, err := Format(f)
	require.NoError(t, err)
	require.NotEmpty(t, first, "the fixture's screens.yaml is written in flow style")
	for name, data := range first {
		require.Contains(t, f, name)
		assert.NotEqual(t, f[name], data, name)
	}
	maps.Copy(f, first)

	again, err := Format(f)
	require.NoError(t, err)
	assert.Empty(t, again, "formatting is idempotent")
	assert.Equal(t, "{}", marshal(t, again), "an empty result is {} in JSON, not null")

	// Unformat one file: only it comes back, in its canonical form.
	canonical := f[config.FileName]
	f[config.FileName] = "areas:   [trip, activity]\n" + strings.Replace(canonical, "areas: [trip, activity]\n", "", 1)
	got, err := Format(f)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{config.FileName: canonical}, got)
}

func TestFormatUnreadableConfig(t *testing.T) {
	got, err := Format(Files{config.FileName: "version: [1\n"})
	require.NoError(t, err)
	assert.Equal(t, map[string]string{}, got)
}

func TestGenerate(t *testing.T) {
	f := trip(t)
	got, err := Generate(f)
	require.NoError(t, err)
	for _, name := range []string{
		"docs/flows/generated/app-map.md",
		"docs/flows/generated/screens.md",
		"docs/flows/generated/wireframes/trip.timeline.phone.svg",
		"docs/flows/generated/wireframes/trip.timeline.web-wide.svg",
	} {
		assert.Contains(t, got, name)
	}
	// With the generated files in place, nothing is stale.
	maps.Copy(f, got)
	res, err := Lint(f, false)
	require.NoError(t, err)
	for _, d := range res.Diagnostics {
		assert.NotEqual(t, "generated-stale", d.Rule, d.Message)
	}
}

// TestFixMatchesCLI applies core.Fix's changes to the files and compares
// the result with the tree `starboard lint --fix` leaves.
func TestFixMatchesCLI(t *testing.T) {
	for name, f := range projects(t) {
		t.Run(name, func(t *testing.T) {
			dir := writeTree(t, f)
			starboard(t, "--dir", dir, "lint", "--fix")
			want := readTree(t, dir)

			got := maps.Clone(f)
			ch, err := Fix(f)
			if err != nil {
				require.ErrorIs(t, err, ErrNotLoaded)
				assert.Equal(t, FixResult{}, ch)
			}
			maps.Copy(got, ch.Write)
			for _, name := range ch.Remove {
				delete(got, name)
			}
			assert.Equal(t, want, got)
		})
	}
}

func TestFixRemovesObsoleteGenerated(t *testing.T) {
	f := trip(t)
	formatted, err := Format(f)
	require.NoError(t, err)
	maps.Copy(f, formatted)
	gen, err := Generate(f)
	require.NoError(t, err)
	maps.Copy(f, gen)
	f["docs/flows/generated/wireframes/gone.screen.phone.svg"] = "<svg/>"

	got, err := Fix(f)
	require.NoError(t, err)
	assert.Equal(t, FixResult{Write: map[string]string{}, Remove: []string{"docs/flows/generated/wireframes/gone.screen.phone.svg"}}, got)
	assert.JSONEq(t, `{"write":{},"remove":["docs/flows/generated/wireframes/gone.screen.phone.svg"]}`, marshal(t, got))
}

func TestRender(t *testing.T) {
	f := trip(t)
	timeline := screen(t, f, "trip.timeline")
	for _, ff := range []string{"phone", "web-wide", "desktop"} {
		got, err := Render(f, "trip.timeline", ff)
		require.NoError(t, err)
		assert.Equal(t, string(render.Wireframe(timeline, ff, config.DefaultFormFactors[ff])), got, ff)
	}
	// No form factor is the screen's first, as the CLI chooses.
	def, err := Render(f, "trip.timeline", "")
	require.NoError(t, err)
	phone, err := Render(f, "trip.timeline", "phone")
	require.NoError(t, err)
	assert.Equal(t, phone, def)
}

func TestRenderErrors(t *testing.T) {
	f := trip(t)
	_, err := Render(f, "nope.screen", "phone")
	require.ErrorIs(t, err, ErrUnknownScreen)
	assert.EqualError(t, err, "unknown screen: nope.screen; use one of activity.editor, trip.timeline")

	_, err = Render(f, "trip.timeline", "watch")
	require.ErrorIs(t, err, ErrUnknownFormFactor)
	assert.EqualError(t, err, "unknown form factor: watch; use one of desktop, phone, tablet, web-narrow, web-wide")

	f[config.FileName] = strings.Replace(f[config.FileName], "areas:", "  cli: {}\nareas:", 1)
	f["docs/flows/screens.yaml"] += "  cli.only:\n    title: CLI\n    area: trip\n    presentation: push\n    platforms: [cli]\n    platformNote: terminal only\n"
	_, err = Render(f, "cli.only", "")
	require.ErrorIs(t, err, ErrNoFormFactor)
	assert.EqualError(t, err, "screen has no form factor: cli.only; pass a form factor")
}

// screen loads f and returns its screen id, for comparing with the
// internal packages.
func screen(t *testing.T, f Files, id string) *registry.Screen {
	t.Helper()
	_, p, _, err := load(f)
	require.NoError(t, err)
	s, ok := p.Registry.Screens[id]
	require.True(t, ok, id)
	return s
}

func TestModelTimeline(t *testing.T) {
	m, err := Model(trip(t))
	require.NoError(t, err)
	require.Len(t, m.Screens, 2)
	assert.Equal(t, []string{"trip.timeline", "activity.editor"}, []string{m.Screens[0].ID, m.Screens[1].ID}, "file order")

	tl := m.Screens[0]
	assert.Equal(t, "Timeline", tl.Title)
	assert.Equal(t, "trip", tl.Area)
	assert.Equal(t, "The trip's days in order.", tl.Purpose)
	assert.Equal(t, "root", tl.Presentation)
	assert.Equal(t, map[string]string{"ios": "shipped", "web": "shipped"}, tl.Status)
	assert.Equal(t, []string{"ios", "web"}, tl.Platforms)
	assert.Equal(t, []string{"phone", "web-wide"}, tl.FormFactors)
	assert.Equal(t, 2, tl.Line)
	assert.Equal(t, map[string][]string{}, tl.Files, "trip.txtar names no screen files")

	require.Len(t, tl.Layout, 4)
	bar := tl.Layout[0]
	assert.Equal(t, "app-bar", bar.Name)
	assert.Equal(t, "bar", bar.Kind)
	assert.Equal(t, "layout[0]", bar.Path)
	require.Len(t, bar.Children, 1)
	assert.Equal(t, Region{
		Name: "title", Kind: "text", Label: "Trip name", Path: "layout[0].children[0]", Line: 11,
		Children: []Region{}, Items: []NavItem{},
	}, bar.Children[0])

	list := tl.Layout[1]
	require.NotNil(t, list.Item)
	assert.Equal(t, "activity.editor", list.Item.To)
	assert.Equal(t, "layout[1].item", list.Item.Path)
	assert.Equal(t, &EmptyState{Label: "No activities yet"}, list.Empty)

	add := tl.Layout[2]
	assert.Equal(t, "editLogistics", add.Requires)
	assert.Equal(t, 16, add.Line)

	tabs := tl.Layout[3]
	assert.Equal(t, []NavItem{
		{Label: "Timeline", To: "trip.timeline", Path: "layout[3].items[0]", Line: 20},
		{Label: "Costs", To: "trip.timeline", Status: "proposed", Path: "layout[3].items[1]", Line: 21},
	}, tabs.Items)

	wide := tl.Layouts["web-wide"]
	require.Len(t, wide, 1)
	assert.Equal(t, "layouts.web-wide[0]", wide[0].Path)
	assert.Equal(t, "240", wide[0].Children[0].Width)
	assert.Equal(t, "1/3", wide[0].Children[1].Width)

	assert.Equal(t, []Edge{
		{From: "trip.timeline", To: "activity.editor", Region: "activities", Path: "layout[1].item", Line: 14},
		{From: "trip.timeline", To: "activity.editor", Region: "add-activity", Path: "layout[2]", Line: 16},
		{From: "trip.timeline", To: "trip.timeline", Region: "tabs", Path: "layout[3].items[0]", Line: 20},
		{From: "trip.timeline", To: "trip.timeline", Region: "tabs", Path: "layout[3].items[1]", Line: 21},
	}, tl.Edges)

	ed := m.Screens[1]
	assert.Equal(t, map[string]string{"ios": "shipped", "web": "proposed"}, ed.Status)
	assert.Equal(t, map[string][]Region{}, ed.Layouts)

	require.Len(t, m.Flows, 2)
	af := m.Flows[0]
	assert.Equal(t, "add-activity", af.ID)
	assert.Equal(t, "docs/flows/flows/add-activity.md", af.File)
	assert.Equal(t, "Add an activity", af.Title)
	assert.Equal(t, "proposed", af.Status)
	assert.Equal(t, "trip.timeline", af.Entry)
	assert.Equal(t, "add-activity", af.FrontMatterID)
	assert.Equal(t, []string{}, m.Flows[1].Platforms)
	require.Len(t, af.Steps, 3)
	assert.Equal(t, FlowStep{
		Number: 1, Text: "Tap @trip.timeline#add-activity.", Screen: "trip.timeline", Region: "add-activity",
		Branches: []string{"If the trip is read-only, the button is hidden."}, Line: 10,
	}, af.Steps[0])
	assert.Equal(t, "browse", m.Flows[1].ID)
	assert.Equal(t, FlowStep{Number: 2, Text: "Scroll through the days.", Branches: []string{}, Line: 11}, m.Flows[1].Steps[1])
}

func TestModelJSONHasNoNulls(t *testing.T) {
	m, err := Model(trip(t))
	require.NoError(t, err)
	out := marshal(t, m)
	// Only the optional objects, a list's item and empty state, may be null.
	stripped := strings.NewReplacer(`"item":null`, "", `"empty":null`, "").Replace(out)
	assert.NotContains(t, stripped, "null")
	for _, key := range []string{`"screens":`, `"flows":`, `"formFactors":`, `"layouts":`, `"edges":`, `"platformNote":`, `"branches":`} {
		assert.Contains(t, out, key)
	}
}

func TestModelEmptyProject(t *testing.T) {
	m, err := Model(Files{config.FileName: "version: 1\n"})
	require.NoError(t, err)
	assert.JSONEq(t, `{"screens":[],"flows":[],"areas":[],"idPattern":`+marshal(t, m.IDPattern)+
		`,"refPattern":`+marshal(t, m.RefPattern)+`,"flowIdPattern":`+marshal(t, m.FlowIDPattern)+`,"flowKeys":`+marshal(t, m.FlowKeys)+`,"kinds":`+marshal(t, m.Kinds)+`,"presentations":`+marshal(t, m.Presentations)+`}`, marshal(t, m))
}

// The vocabularies the app's inspector offers are the registry's, sorted.
func TestModelVocabularies(t *testing.T) {
	m, err := Model(Files{config.FileName: "version: 1\n"})
	require.NoError(t, err)
	assert.Equal(t, slices.Sorted(maps.Keys(registry.Kinds)), m.Kinds)
	assert.Equal(t, slices.Sorted(maps.Keys(registry.Presentations)), m.Presentations)
	assert.Contains(t, m.Kinds, "primary-action")
	assert.Contains(t, m.Presentations, "sheet")
	assert.Equal(t, registry.IDPattern.String(), m.IDPattern)
	assert.Equal(t, flows.RefPattern.String(), m.RefPattern)
	assert.Equal(t, flows.IDPattern.String(), m.FlowIDPattern)
	assert.Equal(t, []string{"id", "title", "status", "entry", "actors", "platforms"}, m.FlowKeys)
}

// The web app derives every reference regular expression from RefPattern;
// its unit tests read this copy (web/app/test/unit/flow-refs.test.ts), so a
// change to the pattern fails here until the copy, and the app, follow.
func TestRefPatternCopy(t *testing.T) {
	file := filepath.Join("testdata", "refpattern.txt")
	if *update {
		require.NoError(t, os.WriteFile(file, []byte(flows.RefPattern.String()+"\n"), 0o600))
	}
	got, err := os.ReadFile(file) //nolint:gosec // a test fixture
	require.NoError(t, err)
	assert.Equal(t, flows.RefPattern.String()+"\n", string(got))
}

// Areas are the configured areas, in config order, for a new screen's area.
func TestModelAreas(t *testing.T) {
	m, err := Model(Files{config.FileName: "version: 1\nareas: [trip, account]\n"})
	require.NoError(t, err)
	assert.Equal(t, []string{"trip", "account"}, m.Areas)
}

// Files are the screen's implementation files by platform, as written.
func TestModelScreenFiles(t *testing.T) {
	f := trip(t)
	reg := "docs/flows/screens.yaml"
	f[reg] = strings.Replace(f[reg], "  trip.timeline:\n", "  trip.timeline:\n    files:\n      ios: [App/Timeline.swift]\n", 1)
	m, err := Model(f)
	require.NoError(t, err)
	assert.Equal(t, map[string][]string{"ios": {"App/Timeline.swift"}}, m.Screens[0].Files)
}

// Actors and platforms come from the front matter, as written.
func TestModelFlowLists(t *testing.T) {
	m, err := Model(Files{
		config.FileName:         "version: 1\nplatforms:\n  ios: {}\n",
		"docs/flows/flows/a.md": "---\nid: b\ntitle: A\nstatus: proposed\nentry: x.y\nactors: [organizer, member]\nplatforms: [ios]\n---\n",
	})
	require.NoError(t, err)
	require.Len(t, m.Flows, 1)
	assert.Equal(t, "b", m.Flows[0].FrontMatterID)
	assert.Equal(t, []string{"organizer", "member"}, m.Flows[0].Actors)
	assert.Equal(t, []string{"ios"}, m.Flows[0].Platforms)
}
