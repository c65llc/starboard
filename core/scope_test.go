// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package core

import (
	"maps"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// folder is a project folder as a host lists it: starboard.yaml and the
// registry read, every other file listed with no contents.
func folder(config, registry string, listed ...string) Files {
	f := Files{"starboard.yaml": config}
	if registry != "" {
		f["design/screens.yaml"] = registry
	}
	for _, name := range listed {
		f[name] = ""
	}
	return f
}

const scopeConfig = `version: 1
content: design
platforms:
  ios:
    formFactors: [phone]
    roots: [ios]
    screenFiles: ['**/*View.swift']
  web:
    formFactors: [web-wide]
    roots: [web/src]
    screenFiles: ['**/*.tsx']
vocabularies:
  requires:
    file: caps.json
    select: .capabilities[].name
areas: [home]
`

const scopeRegistry = `screens:
  home.main:
    title: Home
    area: home
    purpose: Start here.
    files:
      ios: [ios/HomeView.swift]
    screenshots:
      web: shots/home.png
    layout:
      - {region: title, kind: text, label: Home}
`

func TestScopeSaysWhatToReadAndWhatOnlyExists(t *testing.T) {
	f := folder(scopeConfig, scopeRegistry,
		"caps.json", "design/flows/a.md", "ios/HomeView.swift", "ios/Package.swift",
		"web/src/App.tsx", "web/README.md", "shots/home.png", "other/notes.txt")
	got, err := Scope(f)
	require.NoError(t, err)
	assert.Equal(t, "design", got.Content)
	assert.Equal(t, []string{"caps.json"}, got.Read)
	// Everything under a root (so a root with no matches still exists) and
	// every screenshot; nothing under the content root, nothing else.
	assert.Equal(t, []string{"ios/HomeView.swift", "ios/Package.swift", "shots/home.png", "web/src/App.tsx"}, got.Present)
}

func TestScopeOfAFirstPassWithoutTheRegistry(t *testing.T) {
	got, err := Scope(folder(scopeConfig, "", "ios/HomeView.swift", "shots/home.png"))
	require.NoError(t, err)
	assert.Equal(t, "design", got.Content)
	assert.Empty(t, got.Read, "caps.json is not in the folder")
	assert.Equal(t, []string{"ios/HomeView.swift"}, got.Present, "the screenshot is known only once the registry is read")
}

func TestScopeWithRootDotIsTheWholeFolder(t *testing.T) {
	cfg := "version: 1\nplatforms:\n  web:\n    roots: ['.']\n    screenFiles: ['**/*.tsx']\n"
	got, err := Scope(folder(cfg, "", "a.tsx", "docs/flows/screens.yaml", "b/c.txt"))
	require.NoError(t, err)
	assert.Equal(t, "docs/flows", got.Content)
	assert.Equal(t, []string{"a.tsx", "b/c.txt"}, got.Present)
	assert.NotNil(t, got.Read)
}

func TestScopeOfAnUnreadableConfigIsTheDefaultContentRoot(t *testing.T) {
	got, err := Scope(Files{"starboard.yaml": "version: [1\n", "x.txt": ""})
	require.NoError(t, err)
	// The CLI reads nothing but starboard.yaml then, so neither does a host.
	assert.Equal(t, ScopeResult{Content: "docs/flows", Read: []string{}, Present: []string{}, Walk: []string{}, Named: []string{}}, got)
}

func TestScopeIgnoresInvalidRootsAndVocabularies(t *testing.T) {
	cfg := "version: 1\ncontent: ../out\nplatforms:\n  web:\n    roots: ['../up']\nvocabularies:\n  requires:\n    file: ../caps.json\n    select: .x[]\n"
	got, err := Scope(folder(cfg, "", "docs/flows/x.md"))
	require.NoError(t, err)
	// An invalid content root is not walked, nor is anything else here.
	assert.Equal(t, ScopeResult{Content: "docs/flows", Read: []string{}, Present: []string{}, Walk: []string{}, Named: []string{}}, got)

	cfg = "version: 1\nplatforms:\n  web:\n    roots: ['../up', 'a/', 'b\\\\c']\n    screenFiles: ['**/*.tsx']\nvocabularies:\n  requires:\n    file: ../caps.json\n    select: .x[]\n"
	got, err = Scope(folder(cfg, ""))
	require.NoError(t, err)
	assert.Equal(t, []string{"docs/flows"}, got.Walk, "the CLI globs no invalid root")
	assert.Equal(t, []string{}, got.Named, "nor reads an invalid vocabulary file")
}

func TestScopeErrors(t *testing.T) {
	_, err := Scope(Files{"x.txt": ""})
	require.ErrorIs(t, err, ErrNoProject)
	_, err = Scope(Files{"starboard.yaml": "version: 1\n", "../x": ""})
	require.ErrorIs(t, err, ErrInvalidPath)
}

func TestScopeWithContentDotIsTheProjectRoot(t *testing.T) {
	cfg := "version: 1\ncontent: .\nplatforms:\n  web:\n    roots: ['.']\n    screenFiles: ['**/*.tsx']\nvocabularies:\n  requires:\n    file: caps.json\n    select: .x[]\n"
	f := Files{"starboard.yaml": cfg, "screens.yaml": scopeRegistry}
	for _, name := range []string{"caps.json", "flows/a.md", "generated/screens.md", "ios/HomeView.swift", "shots/home.png", "src/App.tsx"} {
		f[name] = ""
	}
	got, err := Scope(f)
	require.NoError(t, err)
	assert.Equal(t, ".", got.Content)
	assert.Equal(t, []string{"caps.json"}, got.Read)
	// The content root's own files (screens.yaml, flows/, generated/) are
	// not listed: a host reads them as the content root.
	assert.Equal(t, []string{"ios/HomeView.swift", "shots/home.png", "src/App.tsx"}, got.Present)
}

func TestScopeWithAnInvalidContentRootStillWalksTheRootsAndReadsTheVocabularies(t *testing.T) {
	// lint still globs the roots and reads the vocabularies (Load stops only
	// before the registry), so a host lists those and nothing more.
	cfg := "version: 1\ncontent: ../out\nplatforms:\n  web:\n    roots: [web]\n    screenFiles: ['**/*.tsx']\nvocabularies:\n  requires:\n    file: caps.json\n    select: .x[]\n"
	got, err := Scope(folder(cfg, "", "caps.json", "web/App.tsx", "docs/flows/screens.yaml", "dist/x.tsx"))
	require.NoError(t, err)
	assert.Equal(t, ScopeResult{
		Content: "docs/flows",
		Read:    []string{"caps.json"},
		Present: []string{"web/App.tsx"},
		Walk:    []string{"web"},
		Named:   []string{"caps.json"},
	}, got)
}

func TestScopeWithAnEscapingOrBackslashContentIsTheDefault(t *testing.T) {
	for _, content := range []string{"..", "a/../..", `a\b`} {
		got, err := Scope(Files{"starboard.yaml": "version: 1\ncontent: '" + content + "'\n"})
		require.NoError(t, err)
		assert.Equal(t, "docs/flows", got.Content, content)
	}
}

func TestScopeWalksTheContentRootAndEachRoot(t *testing.T) {
	// Only the configuration: the first call a host makes.
	got, err := Scope(Files{"starboard.yaml": scopeConfig})
	require.NoError(t, err)
	assert.Equal(t, []string{"design", "ios", "web/src"}, got.Walk)
	assert.Equal(t, []string{"caps.json"}, got.Named, "named whether or not the folder holds it")
}

func TestScopeNamesEachScreensFilesAndScreenshotsOutsideTheWalk(t *testing.T) {
	reg := `screens:
  home.main:
    title: Home
    area: home
    purpose: Start here.
    files:
      ios: [ios/HomeView.swift, dist/Home.swift, ../out.swift]
      web: [web/src/App.tsx]
    screenshots:
      web: shots/home.png
      ios: ../shot.png
    layout:
      - {region: title, kind: text, label: Home}
`
	got, err := Scope(folder(scopeConfig, reg))
	require.NoError(t, err)
	assert.Equal(t, []string{"design", "ios", "web/src"}, got.Walk)
	// ios/ and web/src/ are walked anyway; invalid paths are never opened.
	assert.Equal(t, []string{"caps.json", "dist/Home.swift", "shots/home.png"}, got.Named)
}

func TestScopeWalksRootDotOnlyWhereItsPatternsCanReach(t *testing.T) {
	for _, tc := range []struct {
		name     string
		patterns string
		want     []string
	}{
		{"a literal directory prefix", `['src/**/*.tsx', 'lib/ui/*.vue']`, []string{"docs/flows", "lib/ui", "src"}},
		{"one literal file", `['app/Main.tsx']`, []string{"app", "docs/flows"}},
		{"a prefix under another", `['src/**/*.tsx', 'src/views/*.vue']`, []string{"docs/flows", "src"}},
		{"** from the root", `['src/*.tsx', '**/*.tsx']`, []string{"."}},
		{"a wildcard at the top", `['*.tsx']`, []string{"."}},
		{"a wildcard in the first directory", `['s*/x.tsx']`, []string{"."}},
		{"a brace group in the first directory", `['{src,lib}/x.tsx']`, []string{"."}},
		{"a character class in the first directory", `['[sl]rc/x.tsx']`, []string{"."}},
		{"an absolute glob", `['/src/**/*.tsx']`, []string{"."}},
		{"a pattern climbing out", `['../src/*.tsx']`, []string{"."}},
		{"a backslash", `['src\\x/*.tsx']`, []string{"."}},
		{"a dot element", `['./src/*.tsx']`, []string{"."}},
		{"no patterns", `[]`, []string{"docs/flows"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := "version: 1\nplatforms:\n  web:\n    roots: ['.']\n    screenFiles: " + tc.patterns + "\n"
			got, err := Scope(Files{"starboard.yaml": cfg})
			require.NoError(t, err)
			assert.Equal(t, tc.want, got.Walk)
		})
	}
}

func TestScopeWithAWholeWalkNamesNothing(t *testing.T) {
	cfg := "version: 1\nplatforms:\n  web:\n    roots: ['.']\n    screenFiles: ['**/*.tsx']\nvocabularies:\n  requires:\n    file: caps.json\n    select: .x[]\n"
	got, err := Scope(Files{"starboard.yaml": cfg})
	require.NoError(t, err)
	assert.Equal(t, []string{"."}, got.Walk)
	assert.Equal(t, []string{}, got.Named, "every file is listed already")
}

func TestScopeWalksARootHoldingTheContentRootOnce(t *testing.T) {
	cfg := "version: 1\ncontent: app/design\nplatforms:\n  web:\n    roots: [app, app/src]\n    screenFiles: ['**/*.tsx']\n"
	got, err := Scope(Files{"starboard.yaml": cfg})
	require.NoError(t, err)
	assert.Equal(t, []string{"app"}, got.Walk)
}

func TestScopeWithContentDotWalksFlowsAndGeneratedAndNamesTheRegistry(t *testing.T) {
	got, err := Scope(Files{"starboard.yaml": "version: 1\ncontent: .\n"})
	require.NoError(t, err)
	assert.Equal(t, []string{"flows", "generated"}, got.Walk)
	assert.Equal(t, []string{"screens.yaml"}, got.Named)
}

// hostView is what a host lists of f by following Scope: starboard.yaml,
// every file under Walk and each file in Named, asked again once the
// content root is in, as its screens name more files.
func hostView(t *testing.T, f Files) Files {
	t.Helper()
	out := Files{"starboard.yaml": f["starboard.yaml"]}
	for range 2 {
		res, err := Scope(out)
		require.NoError(t, err)
		for name, data := range f {
			if slices.ContainsFunc(res.Walk, func(w string) bool { return w == "." || under(name, w) }) ||
				slices.Contains(res.Named, name) {
				out[name] = data
			}
		}
	}
	return out
}

// buildOutput is what a project folder holds besides the project: build
// output, a virtual environment, installed packages and version control.
var buildOutput = Files{
	"dist/bundle.tsx":               "x",
	"target/debug/MainView.swift":   "x",
	".venv/lib/site.py":             "x",
	"node_modules/pkg/Button.tsx":   "x",
	"app/node_modules/pkg/Card.tsx": "x",
	".git/HEAD":                     "ref: refs/heads/main\n",
}

const scopedConfig = `version: 1
platforms:
  web:
    formFactors: [web-wide]
    roots: ['.']
    screenFiles: ['src/**/*.tsx']
  kit:
    formFactors: [web-wide]
    roots: [app]
    screenFiles: ['**/*.tsx']
  ios:
    formFactors: [phone]
    roots: ['.']
    screenFiles: ['ios/**/*View.swift']
vocabularies:
  requires:
    file: caps.json
    select: .capabilities[].name
areas: [home]
`

const scopedRegistry = `screens:
  home.main:
    title: Home
    area: home
    purpose: Start here.
    files:
      web: [src/Home.tsx, dist/Home.tsx, dist/Gone.tsx]
      ios: [ios/HomeView.swift]
    screenshots:
      web: shots/home.png
      ios: shots/gone.png
    layout:
      - {region: title, kind: text, label: Home, requires: edit}
`

// TestScopedListingLintsAsTheWholeFolder pins lint parity: linting only
// what a host lists by Scope finds what linting the whole folder (as the
// CLI does) finds, on every test project with build output added and on
// a project whose roots and named files reach in and out of it.
func TestScopedListingLintsAsTheWholeFolder(t *testing.T) {
	all := projects(t)
	all["scoped"] = Files{
		"starboard.yaml":           scopedConfig,
		"docs/flows/screens.yaml":  scopedRegistry,
		"caps.json":                `{"capabilities": [{"name": "edit"}]}`,
		"src/Home.tsx":             "x",
		"src/Other.tsx":            "x",
		"app/Card.tsx":             "x",
		"ios/HomeView.swift":       "x",
		"dist/Home.tsx":            "x",
		"shots/home.png":           "x",
		"docs/flows/flows/home.md": "---\ntitle: Home\n---\n\n1. Open @home.main.\n",
	}
	// The fallback: a root of "." globbed with ** reaches build output too.
	all["whole"] = Files{
		"starboard.yaml":          strings.Replace(scopedConfig, "['src/**/*.tsx']", "['**/*.tsx']", 1),
		"docs/flows/screens.yaml": scopedRegistry,
		"src/Home.tsx":            "x",
	}
	// starboard.yaml that does not parse, and one naming an invalid content root.
	all["unparsable"] = Files{"starboard.yaml": "version: [1\n", "src/App.tsx": "x"}
	all["bad-content"] = Files{
		"starboard.yaml": strings.Replace(scopedConfig, "version: 1\n", "version: 1\ncontent: ../out\n", 1),
		"caps.json":      `{"capabilities": [{"name": "edit"}]}`,
		"src/Other.tsx":  "x",
		"app/Card.tsx":   "x",
	}
	pruned := 0
	for name, f := range all {
		t.Run(name, func(t *testing.T) {
			full := Files{}
			maps.Copy(full, f)
			maps.Copy(full, buildOutput)
			view := hostView(t, full)
			if _, ok := view["dist/bundle.tsx"]; !ok {
				pruned++
			}
			want, err := Lint(full, true)
			require.NoError(t, err)
			got, err := Lint(view, true)
			require.NoError(t, err)
			assert.Equal(t, want, got)
			if name == "scoped" {
				var found []string
				for _, d := range got.Diagnostics {
					found = append(found, d.Rule+" "+d.File+" "+d.Path)
				}
				// Not vacuous: the named files outside the walk count, and
				// so do installed packages under a root, as the CLI globs them.
				assert.Subset(t, found, []string{
					"file-missing docs/flows/screens.yaml screens.home.main.files.web[2]",
					"screenshot-missing docs/flows/screens.yaml screens.home.main.screenshots.ios",
					"unregistered-screen-file app/node_modules/pkg/Card.tsx ",
					"unregistered-screen-file src/Other.tsx ",
				})
			}
		})
	}
	assert.Equal(t, len(all)-1, pruned, "every project but the whole one prunes dist/")

	f := hostView(t, Files{"starboard.yaml": scopedConfig, "docs/flows/screens.yaml": scopedRegistry, "dist/Home.tsx": "x", "dist/bundle.tsx": "x"})
	assert.Contains(t, f, "dist/Home.tsx", "a screen's file outside the walk is listed by name")
	assert.NotContains(t, f, "dist/bundle.tsx")
}
