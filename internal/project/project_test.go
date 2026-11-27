// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package project

import (
	"errors"
	"io/fs"
	"maps"
	"os"
	"slices"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/diag"
)

const minimalConfig = "version: 1\nplatforms:\n  ios:\n    formFactors: [phone]\n"

func fixture(name string) fs.FS {
	return os.DirFS("../testdata/projects/" + name)
}

func sortedKeys[V any](m map[string]V) []string {
	return slices.Sorted(maps.Keys(m))
}

func files(ds []diag.Diagnostic) []string {
	var out []string
	for _, d := range ds {
		out = append(out, d.File)
	}
	return out
}

func TestLoadValid(t *testing.T) {
	p, ds, err := Load(fixture("valid"))
	require.NoError(t, err)
	require.Empty(t, ds)
	require.NotNil(t, p)
	assert.Equal(t, "docs/flows", p.Config.Content)
	assert.Equal(t, []string{"trip.timeline", "activity.editor"}, p.Registry.Order)
	assert.Equal(t, []string{"docs/flows/flows/add-activity.md"}, p.FlowFiles)
	require.Contains(t, p.Flows, "add-activity")
	assert.Equal(t, "add-activity", p.Flows["add-activity"].ID)
	assert.Equal(t, []string{
		"docs/flows/flows/add-activity.md",
		"docs/flows/screens.yaml",
		"starboard.yaml",
	}, sortedKeys(p.Sources))
	assert.NotEmpty(t, p.Sources["starboard.yaml"])
	assert.NotNil(t, p.FS)
}

func TestLoadNoProject(t *testing.T) {
	p, ds, err := Load(fstest.MapFS{"docs/flows/screens.yaml": {Data: []byte("screens: {}\n")}})
	require.ErrorIs(t, err, ErrNoProject)
	assert.Nil(t, p)
	assert.Empty(t, ds)
	assert.Equal(t, "no starboard.yaml found; run `starboard init`", ErrNoProject.Error())
}

func TestLoadEmpty(t *testing.T) {
	p, ds, err := Load(fixture("empty"))
	require.NoError(t, err)
	require.Empty(t, ds)
	require.NotNil(t, p.Registry)
	assert.Empty(t, p.Registry.Screens)
	assert.Empty(t, p.Flows)
	assert.Empty(t, p.FlowFiles)
}

func TestLoadMissingRegistryAndFlows(t *testing.T) {
	p, ds, err := Load(fstest.MapFS{"starboard.yaml": {Data: []byte(minimalConfig)}})
	require.NoError(t, err)
	require.Empty(t, ds)
	require.NotNil(t, p.Registry)
	assert.Empty(t, p.Registry.Screens)
	assert.NotNil(t, p.Flows)
	assert.Empty(t, p.FlowFiles)
	assert.Equal(t, []string{"starboard.yaml"}, sortedKeys(p.Sources))
}

func TestDiagnosticPathsRelative(t *testing.T) {
	p, ds, err := Load(fixture("broken"))
	require.NoError(t, err)
	require.NotNil(t, p)
	assert.Equal(t, []string{"docs/flows/no-front-matter.md"}, p.FlowFiles)
	assert.Contains(t, p.Flows, "no-front-matter")
	got := map[string]string{}
	for _, d := range ds {
		got[d.File] = d.Rule
	}
	assert.Equal(t, map[string]string{
		"docs/flows/no-front-matter.md": "flow-frontmatter-invalid",
		"docs/screens.yaml":             "schema-invalid",
		"starboard.yaml":                "config-invalid",
	}, got)
	assert.IsIncreasing(t, files(ds)) // diag.Sort: by file first
}

func TestLoadOnlyFlowMarkdownDirectlyUnderFlows(t *testing.T) {
	flow := []byte("---\nid: b\ntitle: B\nstatus: proposed\nentry: a.b\n---\n")
	p, ds, err := Load(fstest.MapFS{
		"starboard.yaml":                 {Data: []byte(minimalConfig)},
		"docs/flows/flows/b.md":          {Data: flow},
		"docs/flows/flows/a.md":          {Data: flow},
		"docs/flows/flows/notes.txt":     {Data: []byte("x")},
		"docs/flows/flows/nested/c.md":   {Data: flow},
		"docs/flows/flows/dir.md/inside": {Data: []byte("x")},
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"docs/flows/flows/a.md", "docs/flows/flows/b.md"}, p.FlowFiles)
	assert.Equal(t, []string{"a", "b"}, sortedKeys(p.Flows))
	// Keyed by the file's stem, never the front matter id.
	assert.Equal(t, "b", p.Flows["a"].ID)
	for _, d := range ds {
		assert.Contains(t, []string{"docs/flows/flows/a.md", "docs/flows/flows/b.md"}, d.File)
	}
}

func TestLoadBrokenConfigIsAFinding(t *testing.T) {
	p, ds, err := Load(fstest.MapFS{"starboard.yaml": {Data: []byte("version: [\n")}})
	require.NoError(t, err)
	assert.Nil(t, p)
	require.NotEmpty(t, ds)
	assert.Equal(t, "yaml-syntax", ds[0].Rule)
	assert.Equal(t, "starboard.yaml", ds[0].File)
}

func TestLoadBrokenRegistryYAML(t *testing.T) {
	p, ds, err := Load(fstest.MapFS{
		"starboard.yaml":          {Data: []byte(minimalConfig)},
		"docs/flows/screens.yaml": {Data: []byte("screens: [\n")},
	})
	require.NoError(t, err)
	require.NotNil(t, p)
	require.NotNil(t, p.Registry, "an unreadable screens.yaml gives an empty registry, never nil")
	assert.Empty(t, p.Registry.Screens)
	assert.NotNil(t, p.Registry.Screens)
	require.NotNil(t, p.Flows)
	assert.Empty(t, p.Flows)
	require.NotEmpty(t, ds)
	assert.Equal(t, "docs/flows/screens.yaml", ds[0].File)
	assert.Contains(t, p.Sources, "docs/flows/screens.yaml")
}

func TestLoadContentInvalid(t *testing.T) {
	for _, content := range []string{"../outside", "/abs", `docs\flows`} {
		t.Run(content, func(t *testing.T) {
			cfg := minimalConfig + "content: '" + content + "'\n"
			p, ds, err := Load(fstest.MapFS{"starboard.yaml": {Data: []byte(cfg)}})
			require.NoError(t, err)
			require.NotNil(t, p)
			require.Len(t, ds, 1)
			assert.Equal(t, diag.Diagnostic{
				Rule: "path-invalid", Severity: diag.Error, File: "starboard.yaml", Path: "content",
				Message: "content " + content + " must be a relative path inside the project, written with /",
			}, ds[0])
			require.NotNil(t, p.Registry)
			assert.NotNil(t, p.Registry.Screens)
			assert.Empty(t, p.Registry.Screens)
			require.NotNil(t, p.Flows)
			assert.Empty(t, p.Flows)
			assert.Empty(t, p.FlowFiles)
		})
	}
}

func TestLoadContentCleaned(t *testing.T) {
	p, ds, err := Load(fstest.MapFS{
		"starboard.yaml":    {Data: []byte(minimalConfig + "content: ./docs/\n")},
		"docs/screens.yaml": {Data: []byte("screens: {}\n")},
	})
	require.NoError(t, err)
	require.Empty(t, ds)
	assert.Contains(t, p.Sources, "docs/screens.yaml")
}

var errBoom = errors.New("boom")

// failFS fails to open one name with errBoom. It offers only Open, so every
// read goes through it.
type failFS struct {
	m   fstest.MapFS
	bad string
}

func (f failFS) Open(name string) (fs.File, error) {
	if name == f.bad {
		return nil, &fs.PathError{Op: "open", Path: name, Err: errBoom}
	}
	return f.m.Open(name)
}

func TestLoadIOErrors(t *testing.T) {
	base := fstest.MapFS{
		"starboard.yaml":          {Data: []byte(minimalConfig)},
		"docs/flows/screens.yaml": {Data: []byte("screens: {}\n")},
		"docs/flows/flows/a.md":   {Data: []byte("---\nid: a\n---\n")},
	}
	for _, bad := range []string{"starboard.yaml", "docs/flows/screens.yaml", "docs/flows/flows", "docs/flows/flows/a.md"} {
		t.Run(bad, func(t *testing.T) {
			p, _, err := Load(failFS{base, bad})
			require.ErrorIs(t, err, errBoom)
			assert.Nil(t, p)
		})
	}
}
