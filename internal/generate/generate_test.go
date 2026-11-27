// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package generate

import (
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/project"
	"github.com/c65llc/starboard/internal/render"
)

var update = flag.Bool("update", false, "rewrite testdata/golden from the valid fixture project")

const goldenDir = "testdata/golden"

// load loads files as a project and fails the test on load diagnostics.
func load(t *testing.T, fsys fs.FS) *project.Project {
	t.Helper()
	p, ds, err := project.Load(fsys)
	require.NoError(t, err)
	require.Empty(t, ds, "fixture should load cleanly")
	require.NotNil(t, p)
	return p
}

func memProject(t *testing.T, files map[string]string) (*project.Project, project.MemFS) {
	t.Helper()
	m := project.MemFS{}
	for k, v := range files {
		m[k] = []byte(v)
	}
	return load(t, m), m
}

// TestGenerateGolden pins every file All writes for the valid fixture
// project. Keys are project-relative; the golden tree holds them under
// testdata/golden at the same paths.
func TestGenerateGolden(t *testing.T) {
	p := load(t, os.DirFS("../testdata/projects/valid"))
	got := All(p)
	if *update {
		require.NoError(t, os.RemoveAll(goldenDir))
		for name, data := range got {
			file := filepath.Join(goldenDir, filepath.FromSlash(name))
			require.NoError(t, os.MkdirAll(filepath.Dir(file), 0o750))
			require.NoError(t, os.WriteFile(file, data, 0o600))
		}
	}
	want := map[string]string{}
	require.NoError(t, fs.WalkDir(os.DirFS(goldenDir), ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := fs.ReadFile(os.DirFS(goldenDir), name)
		want[name] = string(data)
		return err
	}))
	assert.Equal(t, []string{
		"docs/flows/generated/app-map.md",
		"docs/flows/generated/screens.md",
		"docs/flows/generated/wireframes/activity.editor.phone.svg",
		"docs/flows/generated/wireframes/trip.timeline.phone.svg",
	}, slices.Sorted(maps.Keys(got)))
	for name, data := range got {
		assert.Equal(t, want[name], string(data), name)
	}
	assert.Len(t, want, len(got))
}

func TestGenerateDeterministic(t *testing.T) {
	first, _ := memProject(t, rich())
	again, _ := memProject(t, rich())
	a, b := All(first), All(again)
	require.NotEmpty(t, a)
	assert.Equal(t, a, b)
	for range 5 {
		assert.Equal(t, a, All(first))
	}
	for name, data := range a {
		assert.True(t, strings.HasSuffix(string(data), "\n"), name)
		assert.NotContains(t, string(data), "\r", name)
	}
}

func TestMermaidIDs(t *testing.T) {
	for id, want := range map[string]string{
		"trip.timeline":         "trip_timeline",
		"trip.day-detail":       "trip_day__detail",
		"a-b.c-d.e":             "a__b_c__d_e",
		"settings.notification": "settings_notification",
		"a.b-c":                 "a_b__c",
		"a-b.c":                 "a__b_c",
		"a--b.c":                "a____b_c",
		"a-.b":                  "a___b",
	} {
		assert.Equal(t, want, MermaidID(id), id)
	}
	// The IDs a "."-and-"-" for "_" encoding would merge stay apart.
	seen := map[string]string{}
	for _, id := range []string{"a.b-c", "a-b.c", "a--b.c", "a-.b", "a.b--c", "a-b-c.d", "a.b.c-d", "a--.b"} {
		m := MermaidID(id)
		assert.NotContains(t, seen, m, "%s and %s collide", seen[m], id)
		seen[m] = id
	}
}

// screenIDPattern is the registry's screen ID form: segments of a letter
// then letters, digits and hyphens, joined by dots, at least two.
var screenIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`)

// TestMermaidIDsInjective enumerates every valid screen ID up to six
// characters over a small alphabet and checks that no two share a
// Mermaid ID, and that every Mermaid ID is a plain identifier.
func TestMermaidIDsInjective(t *testing.T) {
	alphabet := []byte("ab1.-")
	seen := map[string]string{}
	var ids []string
	var gen func(prefix []byte)
	gen = func(prefix []byte) {
		if screenIDPattern.Match(prefix) {
			ids = append(ids, string(prefix))
		}
		if len(prefix) == 6 {
			return
		}
		for _, c := range alphabet {
			gen(append(slices.Clone(prefix), c))
		}
	}
	gen(nil)
	require.Greater(t, len(ids), 1000)
	ident := regexp.MustCompile(`^[a-z0-9_]+$`)
	for _, id := range ids {
		m := MermaidID(id)
		require.Regexp(t, ident, m, id)
		if other, ok := seen[m]; ok {
			t.Fatalf("%s and %s both map to %s", other, id, m)
		}
		seen[m] = id
	}
}

func FuzzMermaidIDInjective(f *testing.F) {
	f.Add("a.b-c", "a-b.c")
	f.Add("a--b.c", "a-.b")
	f.Fuzz(func(t *testing.T, x, y string) {
		if x == y || !screenIDPattern.MatchString(x) || !screenIDPattern.MatchString(y) {
			return
		}
		if MermaidID(x) == MermaidID(y) {
			t.Fatalf("%s and %s both map to %s", x, y, MermaidID(x))
		}
	})
}

// TestEscaping: titles, purposes, flow titles, file names and area names
// are escaped for Markdown, and area names for Mermaid.
func TestEscaping(t *testing.T) {
	p, _ := memProject(t, map[string]string{
		"starboard.yaml": "version: 1\nplatforms:\n  ios: {}\nareas: ['Trip \"plans\" [beta]']\n",
		"docs/flows/screens.yaml": "screens:\n  trip.main:\n    title: 'A [b] <c> `d` \\e'\n" +
			"    area: 'Trip \"plans\" [beta]'\n    purpose: 'Use <b>bold</b> [x](y)'\n    presentation: root\n" +
			"    files:\n      ios: ['App/[x] (y).swift']\n",
		"docs/flows/flows/f.md": "---\nid: f\ntitle: 'F [one]'\nstatus: proposed\nactors: [a]\nentry: trip.main\n---\n\n# F\n",
	})
	gen := All(p)
	m := string(gen["docs/flows/generated/app-map.md"])
	assert.Contains(t, m, "  subgraph area1[\"Trip #quot;plans#quot; [beta]\"]\n")
	sc := string(gen["docs/flows/generated/screens.md"])
	assert.Contains(t, sc, "\n## Trip \"plans\" \\[beta\\]\n")
	assert.Contains(t, sc, "\n### A \\[b\\] \\<c\\> \\`d\\` \\\\e (`trip.main`)\n")
	assert.Contains(t, sc, "- Purpose: Use \\<b\\>bold\\</b\\> \\[x\\](y)\n")
	assert.Contains(t, sc, "- ios: [App/\\[x\\] (y).swift](<../../../App/[x] (y).swift>)\n")
	assert.Contains(t, sc, "- [F \\[one\\]](../flows/f.md)\n")
}

// rich is a project with two platforms, per-platform status, files,
// screenshots, an area outside the config, a screen with no form factor,
// edges to an unknown screen and duplicate edges.
func rich() map[string]string {
	return map[string]string{
		"starboard.yaml": `version: 1
content: ref
platforms:
  ios:
    formFactors: [phone, tablet]
  web:
    formFactors: [web-wide, phone]
  cli: {}
areas: [trip, activity, empty]
`,
		"ref/screens.yaml": `screens:
  trip.timeline:
    title: Timeline
    area: trip
    purpose: |
      The trip's days
      in order.
    presentation: root
    status: {ios: shipped, web: proposed}
    platforms: [web, ios]
    platformNote: not on the command line
    files:
      ios: [App/Timeline View.swift, App/TimelineModel.swift]
      web: [web/src/timeline.tsx]
    screenshots:
      ios: shots/timeline.png
    layout:
      - {region: add, kind: primary-action, label: Add, to: activity.editor}
      - {region: again, kind: action, label: Again, to: activity.editor}
      - {region: lost, kind: action, label: Lost, to: nowhere.at-all}
  activity.editor:
    title: Activity editor
    area: activity
    presentation: sheet
    status: proposed
    layout:
      - {region: save, kind: primary-action, label: Save, to: trip.timeline}
  odd.one:
    title: Odd
    area: zzz
    presentation: push
    platforms: [cli]
    platformNote: terminal only
    layout:
      - {region: x, kind: text, label: X}
`,
		"ref/flows/plan.md": `---
id: plan
title: Plan a day
status: proposed
actors: [traveler]
entry: trip.timeline
platforms: [ios]
---

# Plan a day

## Steps

1. Open @trip.timeline.
2. Tap @activity.editor#save.
`,
		"ref/flows/browse.md": `---
id: browse
title: Browse
status: proposed
actors: [traveler]
entry: trip.timeline
platforms: [ios]
---

# Browse

## Steps

1. Open @trip.timeline.
`,
		"ref/generated/app-map.md": "stale\n",
		"ref/other.md":             "not generated\n",
	}
}

func TestAll_richPaths(t *testing.T) {
	p, _ := memProject(t, rich())
	got := All(p)
	assert.Equal(t, []string{
		"ref/generated/app-map.md",
		"ref/generated/screens.md",
		"ref/generated/wireframes/activity.editor.phone.svg",
		"ref/generated/wireframes/activity.editor.tablet.svg",
		"ref/generated/wireframes/activity.editor.web-wide.svg",
		"ref/generated/wireframes/trip.timeline.phone.svg",
		"ref/generated/wireframes/trip.timeline.tablet.svg",
		"ref/generated/wireframes/trip.timeline.web-wide.svg",
	}, slices.Sorted(maps.Keys(got)))
	s := p.Registry.Screens["trip.timeline"]
	assert.Equal(t, string(render.Wireframe(s, "tablet", p.Config.FormFactors["tablet"])),
		string(got["ref/generated/wireframes/trip.timeline.tablet.svg"]))
}

func TestFormFactors(t *testing.T) {
	p, _ := memProject(t, rich())
	assert.Equal(t, []string{"phone", "tablet", "web-wide"}, FormFactors(p, p.Registry.Screens["trip.timeline"]))
	assert.Equal(t, []string{"phone", "tablet", "web-wide"}, FormFactors(p, p.Registry.Screens["activity.editor"]))
	assert.Empty(t, FormFactors(p, p.Registry.Screens["odd.one"]))
}

func TestAppMap(t *testing.T) {
	p, _ := memProject(t, rich())
	assert.Equal(t, `<!-- Generated by starboard. Do not edit. -->

# App map

`+"```mermaid"+`
flowchart LR
  subgraph area1["trip"]
    trip_timeline["trip.timeline"]
  end
  subgraph area2["activity"]
    activity_editor["activity.editor"]
  end
  subgraph area3["zzz"]
    odd_one["odd.one"]
  end
  activity_editor --> trip_timeline
  trip_timeline --> activity_editor
`+"```"+`
`, string(All(p)["ref/generated/app-map.md"]))
}

func TestScreens(t *testing.T) {
	p, _ := memProject(t, rich())
	assert.Equal(t, `<!-- Generated by starboard. Do not edit. -->

# Screens

## trip

### Timeline (`+"`trip.timeline`"+`)

- Purpose: The trip's days in order.
- Presentation: root
- Status: ios: shipped, web: proposed
- Platforms: ios, web

![trip.timeline on phone](wireframes/trip.timeline.phone.svg)
![trip.timeline on tablet](wireframes/trip.timeline.tablet.svg)
![trip.timeline on web-wide](wireframes/trip.timeline.web-wide.svg)

Files:

- ios: [App/Timeline View.swift](<../../App/Timeline View.swift>)
- ios: [App/TimelineModel.swift](../../App/TimelineModel.swift)
- web: [web/src/timeline.tsx](../../web/src/timeline.tsx)

Screenshots:

- ios: ![trip.timeline on ios](../../shots/timeline.png)

Navigates to:

- `+"`activity.editor`"+`
- `+"`nowhere.at-all`"+`

Reached from:

- `+"`activity.editor`"+`

Used in flows:

- [Browse](../flows/browse.md)
- [Plan a day](../flows/plan.md)

## activity

### Activity editor (`+"`activity.editor`"+`)

- Purpose: none
- Presentation: sheet
- Status: proposed
- Platforms: ios, web, cli

![activity.editor on phone](wireframes/activity.editor.phone.svg)
![activity.editor on tablet](wireframes/activity.editor.tablet.svg)
![activity.editor on web-wide](wireframes/activity.editor.web-wide.svg)

Files: none.

Screenshots: none.

Navigates to:

- `+"`trip.timeline`"+`

Reached from:

- `+"`trip.timeline`"+`

Used in flows:

- [Plan a day](../flows/plan.md)

## zzz

### Odd (`+"`odd.one`"+`)

- Purpose: none
- Presentation: push
- Status: shipped
- Platforms: cli

No form factor configured.

Files: none.

Screenshots: none.

Navigates to: none.

Reached from: none.

Used in flows: none.
`, string(All(p)["ref/generated/screens.md"]))
}

// TestAppMapLarge: past 60 screens, a per-area section follows the full
// map, each holding that area's screens and their direct targets.
func TestAppMapLarge(t *testing.T) {
	for _, n := range []int{60, 61} {
		var b strings.Builder
		b.WriteString("screens:\n")
		for i := range n {
			area := "a"
			if i%2 == 1 {
				area = "b"
			}
			fmt.Fprintf(&b, "  %s.s%02d:\n    title: S%d\n    area: %s\n    presentation: push\n", area, i, i, area)
			if i == 0 {
				b.WriteString("    layout:\n      - {region: go, kind: action, label: Go, to: b.s01}\n")
			}
		}
		p, _ := memProject(t, map[string]string{
			"starboard.yaml":          "version: 1\nareas: [a, b]\n",
			"docs/flows/screens.yaml": b.String(),
		})
		got := string(All(p)["docs/flows/generated/app-map.md"])
		if n == 60 {
			assert.NotContains(t, got, "## ")
			continue
		}
		head, rest, ok := strings.Cut(got, "\n## a\n")
		require.True(t, ok, got)
		assert.Contains(t, head, "  a_s00 --> b_s01\n")
		a, bSection, ok := strings.Cut(rest, "\n## b\n")
		require.True(t, ok)
		assert.Equal(t, "\n```mermaid\nflowchart LR\n", a[:len("\n```mermaid\nflowchart LR\n")])
		assert.Contains(t, a, "  subgraph area1[\"a\"]\n    a_s00[\"a.s00\"]\n")
		assert.Contains(t, a, "  b_s01[\"b.s01\"]\n", "a direct target outside the area")
		assert.Contains(t, a, "  a_s00 --> b_s01\n")
		assert.NotContains(t, a, "b_s03")
		assert.Contains(t, bSection, "  subgraph area2[\"b\"]\n    b_s01[\"b.s01\"]\n")
		assert.NotContains(t, bSection, "a_s00")
		assert.NotContains(t, bSection, "-->")
		assert.True(t, strings.HasSuffix(got, "```\n"))
	}
}

func TestAll_emptyAndInvalid(t *testing.T) {
	p, _ := memProject(t, map[string]string{"starboard.yaml": "version: 1\n"})
	got := All(p)
	assert.NotNil(t, got, "a valid content root gives a non-nil map")
	assert.Empty(t, got, "no screens, nothing to generate")

	m := project.MemFS{"starboard.yaml": []byte("version: 1\ncontent: ../out\n")}
	bad, _, err := project.Load(m)
	require.NoError(t, err)
	require.NotNil(t, bad)
	assert.Nil(t, All(bad))
	_, ok := Dir(bad)
	assert.False(t, ok)
	changes, err := Diff(bad, nil)
	assert.NoError(t, err)
	assert.Empty(t, changes)
}

func TestDir(t *testing.T) {
	p, _ := memProject(t, map[string]string{"starboard.yaml": "version: 1\ncontent: ./a/b/\n"})
	d, ok := Dir(p)
	assert.True(t, ok)
	assert.Equal(t, "a/b/generated", d)
	p, _ = memProject(t, map[string]string{"starboard.yaml": "version: 1\ncontent: .\n"})
	d, _ = Dir(p)
	assert.Equal(t, "generated", d)
}

func TestDiff(t *testing.T) {
	files := rich()
	files["ref/generated/extra.md"] = "x\n"
	files["ref/generated/wireframes/gone.phone.svg"] = "<svg/>\n"
	p, m := memProject(t, files)
	want := All(p)
	m["ref/generated/screens.md"] = want["ref/generated/screens.md"] // already fresh
	got, err := Diff(p, want)
	require.NoError(t, err)
	assert.Equal(t, []Change{
		{Path: "ref/generated/app-map.md", Kind: Changed},
		{Path: "ref/generated/extra.md", Kind: Extra},
		{Path: "ref/generated/wireframes/activity.editor.phone.svg", Kind: Missing},
		{Path: "ref/generated/wireframes/activity.editor.tablet.svg", Kind: Missing},
		{Path: "ref/generated/wireframes/activity.editor.web-wide.svg", Kind: Missing},
		{Path: "ref/generated/wireframes/gone.phone.svg", Kind: Extra},
		{Path: "ref/generated/wireframes/trip.timeline.phone.svg", Kind: Missing},
		{Path: "ref/generated/wireframes/trip.timeline.tablet.svg", Kind: Missing},
		{Path: "ref/generated/wireframes/trip.timeline.web-wide.svg", Kind: Missing},
	}, got)

	for name, data := range want {
		m[name] = data
	}
	delete(m, "ref/generated/extra.md")
	delete(m, "ref/generated/wireframes/gone.phone.svg")
	got, err = Diff(p, want)
	require.NoError(t, err)
	assert.Empty(t, got, "fresh, and ref/other.md outside generated/ is ignored")
}

// failFS fails reads of one name.
type failFS struct {
	project.MemFS
	fail string
}

var errBoom = errors.New("boom")

func (f failFS) Open(name string) (fs.File, error) {
	if name == f.fail {
		return nil, errBoom
	}
	return f.MemFS.Open(name)
}

func TestDiffErrors(t *testing.T) {
	p, m := memProject(t, rich())
	want := All(p)
	p.FS = failFS{MemFS: m, fail: "ref/generated"}
	_, err := Diff(p, want)
	assert.ErrorIs(t, err, errBoom)

	p.FS = failFS{MemFS: m, fail: "ref/generated/app-map.md"}
	_, err = Diff(p, want)
	assert.ErrorIs(t, err, errBoom)

	p.FS = failFS{MemFS: m, fail: "ref/generated/screens.md"} // missing, then read when wanted
	_, err = Diff(p, want)
	assert.ErrorIs(t, err, errBoom)
}

func TestRel(t *testing.T) {
	for _, tc := range []struct{ from, to, want string }{
		{"docs/flows/generated", "App/A.swift", "../../../App/A.swift"},
		{"docs/flows/generated", "docs/flows/x.png", "../x.png"},
		{"generated", "a.png", "../a.png"},
		{"a/generated", "a/generated/b.svg", "b.svg"},
		{"a/generated", "./a/../b/c.png", "../../b/c.png"},
	} {
		assert.Equal(t, tc.want, rel(tc.from, tc.to), "%s -> %s", tc.from, tc.to)
	}
	assert.Equal(t, "x", path.Clean("x"))
}
