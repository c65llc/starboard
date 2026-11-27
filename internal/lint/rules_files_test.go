// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package lint

import (
	"io/fs"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/project"
)

// coverage is a starboard.yaml whose platforms section is platforms, a block
// starting on line 3.
func coverage(platforms string) string {
	return "version: 1\nplatforms:\n" + platforms + `areas: [trip, activity]
vocabularies:
  requires:
    file: caps.json
    select: .capabilities[].name
`
}

func TestRule_file_missing(t *testing.T) {
	runRule(t, "file-missing", []ruleCase{
		{
			name:  "missing file",
			files: map[string]string{"a.swift": ""},
			want:  []at{{screensYML, 2, "screens.trip.timeline.files.ios[0]"}},
		},
		{
			name: "proposed on that platform is skipped",
			files: map[string]string{screensYML: screen + `    status: { ios: proposed }
    files:
      ios: [gone.swift]
      web: [gone.tsx]
`},
			want: []at{{screensYML, 2, "screens.a.one.files.web[0]"}},
		},
		{
			name:  "proposed everywhere is skipped",
			files: map[string]string{screensYML: screen + "    status: proposed\n    files: { ios: [gone.swift], web: [gone.tsx] }\n"},
		},
		{
			name: "files for a platform the screen is not on are still checked",
			files: map[string]string{screensYML: screen + `    platforms: [ios]
    platformNote: ios only
    files: { web: [gone.tsx] }
`},
			want: []at{{screensYML, 2, "screens.a.one.files.web[0]"}},
		},
		{
			name:  "a directory is not a file",
			files: map[string]string{screensYML: screen + "    files: { ios: [a.swift, src] }\n", "src/x.swift": "x"},
			want:  []at{{screensYML, 2, "screens.a.one.files.ios[1]"}},
		},
		{
			name:  "an invalid path is left to path-invalid",
			files: map[string]string{screensYML: screen + "    files: { ios: [../x.swift] }\n"},
		},
		{
			name: "missing root and a root that is a file",
			files: map[string]string{cfgFile: coverage(`  ios:
    formFactors: [phone]
    roots: [gone, a.swift, src, /abs]
    screenFiles: ["*View.swift"]
  web:
    formFactors: [web-wide]
`), "src/x.txt": "x"},
			want: []at{
				{cfgFile, 5, "platforms.ios.roots[0]"},
				{cfgFile, 5, "platforms.ios.roots[1]"},
			},
		},
	})
}

func TestRule_screenshot_missing(t *testing.T) {
	runRule(t, "screenshot-missing", []ruleCase{
		{
			name:  "missing screenshot",
			files: map[string]string{"a.png": ""},
			want:  []at{{screensYML, 2, "screens.trip.timeline.screenshots.ios"}},
		},
		{
			name:  "proposed screens are not exempt",
			files: map[string]string{screensYML: screen + "    status: proposed\n    screenshots: { ios: gone.png }\n"},
			want:  []at{{screensYML, 2, "screens.a.one.screenshots.ios"}},
		},
		{
			name:  "a directory is not a screenshot",
			files: map[string]string{screensYML: screen + "    screenshots: { ios: a.png, web: shots }\n", "shots/x.png": "x"},
			want:  []at{{screensYML, 2, "screens.a.one.screenshots.web"}},
		},
		{
			name:  "an invalid path is left to path-invalid",
			files: map[string]string{screensYML: screen + "    screenshots: { ios: /abs.png }\n"},
		},
	})
}

// coverageConfig gives ios a nested pattern and web two patterns that
// both match XScreen.kt.
var coverageConfig = coverage(`  ios:
    formFactors: [phone]
    roots: [src/ios]
    screenFiles: ["**/*View.swift"]
  web:
    formFactors: [web-wide]
    roots: [src/web, src/web]
    screenFiles: ["*Screen.kt", "*.kt"]
`)

func TestRule_unregistered_screen_file(t *testing.T) {
	claimed := screen + "    files: { ios: [src/ios/CView.swift] }\n" +
		"unmapped:\n  - { path: src/ios/DView.swift, reason: a control inside a.one }\n"
	runRule(t, "unregistered-screen-file", []ruleCase{
		{
			name: "nested matches, claimed, unmapped and non-matching files",
			files: map[string]string{
				cfgFile:                            coverageConfig,
				screensYML:                         claimed,
				"src/ios/AView.swift":              "a",
				"src/ios/deep/nested/BView.swift":  "b",
				"src/ios/CView.swift":              "c",
				"src/ios/DView.swift":              "d",
				"src/ios/Helper.swift":             "h",
				"src/ios/DirView.swift/inside.txt": "a directory never counts",
				"src/web/XScreen.kt":               "x",
				"src/web/sub/YScreen.kt":           "* does not span directories",
			},
			want: []at{
				{"src/ios/AView.swift", 0, ""},
				{"src/ios/deep/nested/BView.swift", 0, ""},
				{"src/web/XScreen.kt", 0, ""},
			},
		},
		{
			name: "a platform without screenFiles has no reverse coverage",
			files: map[string]string{cfgFile: coverage(`  ios:
    formFactors: [phone]
    roots: [src]
  web:
    formFactors: [web-wide]
`), "src/AView.swift": "a"},
		},
		{
			name: "the project root as a root",
			files: map[string]string{cfgFile: coverage(`  ios:
    formFactors: [phone]
    roots: [.]
    screenFiles: ["*View.swift"]
  web:
    formFactors: [web-wide]
`), "TopView.swift": "t", "sub/LowView.swift": "l"},
			want: []at{{"TopView.swift", 0, ""}},
		},
		{
			name: "missing roots and invalid patterns are not globbed",
			files: map[string]string{cfgFile: coverage(`  ios:
    formFactors: [phone]
    roots: [gone, a.swift, ../up, src]
    screenFiles: ["../*View.swift", "[bad", "*View.swift"]
  web:
    formFactors: [web-wide]
`), "src/AView.swift": "a"},
			want: []at{{"src/AView.swift", 0, ""}},
		},
	})
}

func TestRule_unmapped_and_claimed(t *testing.T) {
	line := strings.Count(baseScreens, "\n") + 2
	runRule(t, "unmapped-and-claimed", []ruleCase{
		{
			name: "claimed and unmapped",
			files: map[string]string{screensYML: baseScreens + `unmapped:
  - { path: a.swift, reason: shared }
  - { path: other.swift, reason: a helper }
`},
			want: []at{{screensYML, line, "unmapped[0].path"}},
		},
	})
}

func TestFileClaimedTwiceIsFine(t *testing.T) {
	files := with(map[string]string{
		cfgFile: coverageConfig,
		screensYML: `screens:
  a.one:
    title: A
    area: trip
    presentation: root
    files: { ios: [src/ios/AView.swift] }
  a.two:
    title: B
    area: trip
    presentation: sheet
    files: { ios: [src/ios/AView.swift], web: [src/web/XScreen.kt] }
`,
		"src/ios/AView.swift": "a",
		"src/web/XScreen.kt":  "x",
	})
	p := mkProject(t, files)
	res := Run(p, nil, Options{})
	for _, d := range res.Diagnostics {
		assert.NotContains(t, fileRules, d.Rule, "%+v", d)
	}
}

var fileRules = []string{
	"path-invalid", "file-missing", "screenshot-missing",
	"unregistered-screen-file", "unmapped-and-claimed",
}

// pathInvalidConfig puts a bad root, bad patterns and a bad vocabulary file
// on the lines TestPathInvalid pins.
const pathInvalidConfig = `version: 1
platforms:
  ios:
    formFactors: [phone]
    roots:
      - ok
      - /abs
    screenFiles:
      - "**/*View.swift"
      - "../*.swift"
      - '\x'
      - "/lead/*"
      - "[bad"
      - "src/{..,x}/*"
      - "src/{../..,x}/*"
      - "{/etc,x}/*"
      - "a..b*"
  web:
    formFactors: [web-wide]
areas: [trip, activity]
vocabularies:
  requires:
    file: ../x.json
    select: .capabilities[].name
`

const pathInvalidScreens = `screens:
  a.one:
    title: A
    area: trip
    presentation: root
    files:
      ios: ["../etc/passwd", /abs, 'a\b', ok.swift]
    screenshots:
      web: ../shot.png
unmapped:
  - { path: ../u.swift, reason: r }
  - { path: 'u\v.swift', reason: r }
`

var pathInvalidWant = []at{
	{screensYML, 2, "screens.a.one.files.ios[0]"},
	{screensYML, 2, "screens.a.one.files.ios[1]"},
	{screensYML, 2, "screens.a.one.files.ios[2]"},
	{screensYML, 2, "screens.a.one.screenshots.web"},
	{screensYML, 11, "unmapped[0].path"},
	{screensYML, 12, "unmapped[1].path"},
	{cfgFile, 7, "platforms.ios.roots[1]"},
	{cfgFile, 10, "platforms.ios.screenFiles[1]"},
	{cfgFile, 11, "platforms.ios.screenFiles[2]"},
	{cfgFile, 12, "platforms.ios.screenFiles[3]"},
	{cfgFile, 13, "platforms.ios.screenFiles[4]"},
	{cfgFile, 14, "platforms.ios.screenFiles[5]"},
	{cfgFile, 15, "platforms.ios.screenFiles[6]"},
	{cfgFile, 16, "platforms.ios.screenFiles[7]"},
	{cfgFile, 17, "platforms.ios.screenFiles[8]"},
	{cfgFile, 23, "vocabularies.requires.file"},
}

func TestRule_path_invalid(t *testing.T) {
	runRule(t, "path-invalid", []ruleCase{
		{
			name:  "every kind of path",
			files: map[string]string{cfgFile: pathInvalidConfig, screensYML: pathInvalidScreens},
			want:  pathInvalidWant,
		},
	})
}

// recordingFS is an fs.FS that records every name passed to Open. It has
// only Open, so fs.Stat, fs.ReadDir and fs.ReadFile all go through it.
type recordingFS struct {
	fsys fs.FS
	mu   sync.Mutex
	seen []string
}

func (r *recordingFS) Open(name string) (fs.File, error) {
	r.mu.Lock()
	r.seen = append(r.seen, name)
	r.mu.Unlock()
	return r.fsys.Open(name)
}

func TestPathInvalid(t *testing.T) {
	mem := project.MemFS{}
	for name, data := range with(map[string]string{
		cfgFile:                pathInvalidConfig,
		screensYML:             pathInvalidScreens,
		"ok/AView.swift":       "a",
		"ok/src/x/BView.swift": "b",
		"ok.swift":             "o",
	}) {
		mem[name] = []byte(data)
	}
	rec := &recordingFS{fsys: mem}
	p, ds, err := project.Load(rec)
	require.NoError(t, err)
	require.Empty(t, ds)

	res := Run(p, ds, Options{})
	var got []at
	for _, d := range res.Diagnostics {
		if d.Rule == "path-invalid" {
			got = append(got, at{d.File, d.Line, d.Path})
		}
	}
	assert.Equal(t, pathInvalidWant, got)

	require.NotEmpty(t, rec.seen)
	assert.True(t, slices.Contains(rec.seen, "ok"), "the valid root was globbed: %q", rec.seen)
	for _, name := range rec.seen {
		assert.NotContains(t, name, "..", "opened %q", name)
		assert.NotContains(t, name, `\`, "opened %q", name)
		assert.False(t, strings.HasPrefix(name, "/"), "opened %q", name)
		for _, bad := range []string{"etc/passwd", "abs", "x.json", "shot.png", "u.swift", "lead"} {
			assert.NotContains(t, name, bad, "opened %q", name)
		}
	}
}

// TestFileFindingsSorted pins that a rule's own output is already in a
// stable order, so reporting is byte-stable before diag.Sort.
func TestFileFindingsSorted(t *testing.T) {
	p := mkProject(t, with(map[string]string{cfgFile: coverageConfig,
		"src/ios/b/BView.swift": "b", "src/ios/AView.swift": "a", "src/web/XScreen.kt": "x"}))
	ds := rule(t, "unregistered-screen-file").Run(p, nil)
	sorted := slices.Clone(ds)
	diag.Sort(sorted)
	assert.Equal(t, sorted, ds)
	assert.Len(t, ds, 3)
}

// deniedFS refuses every Open with a permission error.
type deniedFS struct{}

func (deniedFS) Open(name string) (fs.File, error) {
	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrPermission}
}

func TestFileProblemAndItemLine(t *testing.T) {
	assert.Contains(t, fileProblem(deniedFS{}, "a.swift"), "cannot be read")
	assert.Equal(t, "does not exist", fileProblem(project.MemFS{}, "a.swift"))
	assert.Empty(t, fileProblem(project.MemFS{"a.swift": nil}, "a.swift"))

	src := []byte("platforms:\n  ios:\n    roots: [a, b]\n")
	assert.Equal(t, 3, itemLine(src, 1, "platforms", "ios", "roots"))
	assert.Zero(t, itemLine(src, 2, "platforms", "ios", "roots"))
	assert.Zero(t, itemLine(src, 0, "platforms", "web", "roots"))
}

// brokenDirFS is a MemFS whose directory broken cannot be listed.
type brokenDirFS struct{ project.MemFS }

func (b brokenDirFS) Open(name string) (fs.File, error) {
	if name == "src/broken" {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrPermission}
	}
	return b.MemFS.Open(name)
}

// ReadDir hides MemFS's own ReadDir so listing goes through Open.
func (b brokenDirFS) ReadDir(name string) ([]fs.DirEntry, error) {
	if name == "src/broken" {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrPermission}
	}
	return fs.ReadDir(b.MemFS, name)
}

func TestGlobErrorIsFileMissing(t *testing.T) {
	mem := project.MemFS{}
	for name, data := range with(map[string]string{
		cfgFile: coverage(`  ios:
    formFactors: [phone]
    roots: [ok, src]
    screenFiles: ["**/*View.swift"]
  web:
    formFactors: [web-wide]
`),
		"ok/a.txt":               "a",
		"src/AView.swift":        "a",
		"src/broken/BView.swift": "b",
	}) {
		mem[name] = []byte(data)
	}
	p, ds, err := project.Load(brokenDirFS{mem})
	require.NoError(t, err)
	require.Empty(t, ds)
	got := rule(t, "file-missing").Run(p, nil)
	require.Len(t, got, 1)
	assert.Equal(t, at{cfgFile, 5, "platforms.ios.roots[1]"}, at{got[0].File, got[0].Line, got[0].Path})
	assert.Contains(t, got[0].Message, "permission denied")
}

func TestValidPattern(t *testing.T) {
	for _, ok := range []string{"*View.swift", "**/*.{tsx,svelte}", "{a,b}/**/*.kt", "+page.svelte"} {
		assert.True(t, validPattern(ok), ok)
	}
	for _, bad := range []string{"", "/lead/*", "a//b", "./x", "a..b*", "src/{..,x}/*", "{/etc,x}/*",
		"{a/b,c}", `a\b`, "[bad"} {
		assert.False(t, validPattern(bad), bad)
	}
}
