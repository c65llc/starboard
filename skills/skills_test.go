// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package skills

import (
	"io/fs"
	"slices"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// wantSkills are the skills this release ships, by name.
var wantSkills = []string{"starboard", "starboard-adopt", "starboard-implement", "starboard-propose"}

// sources returns every embedded skill file's stem and raw content.
func sources(t *testing.T) map[string]string {
	t.Helper()
	names, err := fs.Glob(FS, "*.md")
	require.NoError(t, err)
	out := map[string]string{}
	for _, name := range names {
		data, err := fs.ReadFile(FS, name)
		require.NoError(t, err)
		out[strings.TrimSuffix(name, ".md")] = string(data)
	}
	return out
}

func TestAllReturnsEverySkillSortedByName(t *testing.T) {
	all := All()
	var names []string
	for _, s := range all {
		names = append(names, s.Name)
	}
	assert.Equal(t, wantSkills, names)
	assert.True(t, slices.IsSorted(names))
}

// TestSkillFrontMatter: every file opens with front matter whose name is
// kebab-case and equal to the file's stem, and whose description is one
// non-empty line. Nothing else is in the front matter.
func TestSkillFrontMatter(t *testing.T) {
	src := sources(t)
	require.Len(t, src, len(wantSkills))
	for stem, data := range src {
		t.Run(stem, func(t *testing.T) {
			require.True(t, strings.HasPrefix(data, "---\n"), "front matter must open the file")
			s, err := parse(stem+".md", []byte(data))
			require.NoError(t, err)
			assert.Equal(t, stem, s.Name)
			assert.Regexp(t, kebab, s.Name)
			assert.NotEmpty(t, s.Description)
			assert.NotContains(t, s.Description, "\n")
			assert.True(t, strings.HasSuffix(s.Description, "."), "description is one sentence")
		})
	}
}

func TestParse(t *testing.T) {
	good := "---\nname: x-y\ndescription: Use it.\n---\n\n# X\n"
	s, err := parse("x-y.md", []byte(good))
	require.NoError(t, err)
	assert.Equal(t, Skill{Name: "x-y", Description: "Use it.", Body: "# X\n"}, s)

	for name, tc := range map[string]struct{ file, data, err string }{
		"no front matter":    {"a.md", "# A\n", "a.md: must start with front matter between --- lines"},
		"empty front matter": {"a.md", "---\n\n---\n", `a.md: name "" must be kebab-case`},
		"never closed":       {"a.md", "---\nname: a\n", "a.md: front matter is never closed with ---"},
		"bad yaml":           {"a.md", "---\nname: [\n---\n", "a.md: front matter:"},
		"unknown key":        {"a.md", "---\nname: a\ndescription: d.\nx: 1\n---\n", "a.md: front matter:"},
		"name mismatch":      {"a.md", "---\nname: b\ndescription: d.\n---\n", `a.md: name "b" must equal the file's stem "a"`},
		"name not kebab":     {"A_b.md", "---\nname: A_b\ndescription: d.\n---\n", `A_b.md: name "A_b" must be kebab-case`},
		"empty description":  {"a.md", "---\nname: a\n---\n", "a.md: description must be one non-empty line"},
		"multi-line desc":    {"a.md", "---\nname: a\ndescription: |\n  one\n  two\n---\n", "a.md: description must be one non-empty line"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := parse(tc.file, []byte(tc.data))
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.err)
		})
	}
}

func TestLoad(t *testing.T) {
	got, err := load(fstest.MapFS{
		"b.md":      {Data: []byte("---\nname: b\ndescription: B.\n---\nB\n")},
		"a.md":      {Data: []byte("---\nname: a\ndescription: A.\n---\nA\n")},
		"notes.txt": {Data: []byte("ignored")},
	})
	require.NoError(t, err)
	assert.Equal(t, []Skill{{"a", "A.", "A\n"}, {"b", "B.", "B\n"}}, got)

	_, err = load(fstest.MapFS{"a.md": {Data: []byte("nope")}})
	assert.Error(t, err)

	_, err = load(fstest.MapFS{"a.md": {Mode: fs.ModeDir}})
	assert.Error(t, err)
}

func TestMustLoadPanicsOnABadSkill(t *testing.T) {
	assert.Panics(t, func() { mustLoad(fstest.MapFS{"a.md": {Data: []byte("nope")}}) })
}
