// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package scaffold writes a new Starboard project: starboard.yaml, the
// content root's README, a registry with one example screen, one example
// flow, the pages generate writes for them, and the .gitattributes line
// that keeps generated files byte-exact.
// Everything it writes lints clean and is already in canonical form.
package scaffold

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"regexp"
	"slices"
	"strings"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/generate"
	"github.com/c65llc/starboard/internal/project"
)

// GitAttributesLine is the .gitattributes entry that stops autocrlf from
// changing generated files, so their freshness check holds on every OS.
const GitAttributesLine = "docs/flows/generated/** -text"

// gitAttributes is the .gitattributes file's name.
const gitAttributes = ".gitattributes"

var (
	// ErrExists is returned when a file Init would write is already there.
	// Nothing is written.
	ErrExists = errors.New("already exists")
	// ErrPlatformName is returned for a platform name that is not lowercase
	// letters, digits and hyphens starting with a letter.
	ErrPlatformName = errors.New("platform names are lowercase letters, digits and hyphens, starting with a letter")
)

// platformName is the form of a platform name Init accepts.
var platformName = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

// Options configure Init. Platforms are the platform names, in order; a
// repeated name is written once.
type Options struct {
	Platforms []string
}

// known are the suggested settings for the platforms Init recognises. Other
// platforms get an empty entry.
var known = map[string]string{
	"ios":     "    formFactors: [phone]\n    screenFiles: ['**/*View.swift']\n",
	"android": "    formFactors: [phone]\n    screenFiles: ['**/*Screen.kt']\n",
	"web":     "    formFactors: [web-narrow, web-wide]\n    screenFiles: ['**/*.{tsx,svelte,vue}']\n",
}

// Init writes a new project into w and returns the paths it wrote, sorted.
// It refuses, writing nothing, when starboard.yaml or any of the content
// files already exists (ErrExists) or a platform name is malformed
// (ErrPlatformName). GitAttributesLine is appended to .gitattributes, which
// is created if absent and left alone if it already holds the line.
func Init(w project.WriteFS, opts Options) ([]string, error) {
	var platforms []string
	for _, p := range opts.Platforms {
		if !platformName.MatchString(p) {
			return nil, fmt.Errorf("%w: %q", ErrPlatformName, p)
		}
		if !slices.Contains(platforms, p) {
			platforms = append(platforms, p)
		}
	}
	files := map[string]string{
		config.FileName:                             configFile(platforms),
		config.DefaultContent + "/README.md":        readme,
		config.DefaultContent + "/screens.yaml":     screens,
		config.DefaultContent + "/flows/example.md": flow,
	}
	names := slices.Sorted(maps.Keys(files))
	// starboard.yaml first, so an existing project is reported as such.
	for _, name := range append([]string{config.FileName}, names...) {
		switch _, err := fs.Stat(w, name); {
		case err == nil:
			return nil, fmt.Errorf("%s %w", name, ErrExists)
		case !errors.Is(err, fs.ErrNotExist):
			return nil, err
		}
	}
	attrs, appendAttrs, err := gitAttributesWith(w)
	if err != nil {
		return nil, err
	}
	for _, name := range names {
		if err := w.WriteFile(name, []byte(files[name])); err != nil {
			return nil, err
		}
	}
	if appendAttrs {
		if err := w.WriteFile(gitAttributes, attrs); err != nil {
			return nil, err
		}
		names = append(names, gitAttributes)
	}
	// The new project's generated pages, so it lints clean from the start.
	p, _, err := project.Load(w)
	if err != nil {
		return nil, err
	}
	gen := generate.All(p)
	for _, name := range slices.Sorted(maps.Keys(gen)) {
		if err := w.WriteFile(name, gen[name]); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	slices.Sort(names)
	return names, nil
}

// gitAttributesWith returns .gitattributes with GitAttributesLine appended,
// and whether it needs writing: false when a line already says the same,
// ignoring surrounding spaces and the gap between pattern and attribute.
func gitAttributesWith(w fs.FS) ([]byte, bool, error) {
	data, err := fs.ReadFile(w, gitAttributes)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, false, err
	}
	want := strings.Fields(GitAttributesLine)
	for line := range strings.Lines(string(data)) {
		if slices.Equal(strings.Fields(line), want) {
			return nil, false, nil
		}
	}
	out := bytes.Clone(data)
	if len(out) > 0 && out[len(out)-1] != '\n' {
		out = append(out, '\n')
	}
	return append(out, GitAttributesLine+"\n"...), true, nil
}

// configFile is starboard.yaml with an entry per platform.
func configFile(platforms []string) string {
	var b strings.Builder
	b.WriteString("version: 1\n")
	if len(platforms) > 0 {
		b.WriteString("platforms:\n")
		for _, p := range platforms {
			if settings, ok := known[p]; ok {
				b.WriteString("  " + p + ":\n" + settings)
			} else {
				b.WriteString("  " + p + ": {}\n")
			}
		}
	}
	b.WriteString("areas: [home]\n")
	return b.String()
}

const screens = `screens:
  home.main:
    title: Home
    area: home
    purpose: The first screen people see. Replace it with one of your own.
    presentation: root
    status: proposed
    layout:
      - {region: title, kind: header, label: App name}
      - {region: start, kind: primary-action, label: Get started}
`

const flow = "---\n" +
	"id: example\n" +
	"title: An example flow\n" +
	"status: proposed\n" +
	"actors: [person]\n" +
	"entry: home.main\n" +
	"---\n" +
	"\n" +
	"# An example flow\n" +
	"\n" +
	"**Goal:** show how a flow reads. Replace this flow with one of your own.\n" +
	"\n" +
	"```mermaid\n" +
	"flowchart TD\n" +
	"  A[\"@home.main\"] -->|\"@home.main#start\"| B[Started]\n" +
	"```\n" +
	"\n" +
	"## Steps\n" +
	"\n" +
	"1. Open the app on @home.main.\n" +
	"2. Tap @home.main#start.\n"

const readme = "# Flows\n" +
	"\n" +
	"This directory is the app's screen and flow reference, kept by\n" +
	"[Starboard](https://starboard.c65llc.com).\n" +
	"\n" +
	"- `screens.yaml` registers every screen: its area, purpose, presentation,\n" +
	"  status, source files and a wireframe layout of named regions.\n" +
	"- `flows/` holds one Markdown file per user flow: front matter, a goal, a\n" +
	"  Mermaid diagram and numbered steps. Screens and regions are written as\n" +
	"  `@screen.id` and `@screen.id#region`.\n" +
	"- `generated/` is written by `starboard generate`. Never edit it by hand.\n" +
	"\n" +
	"## Changing the reference\n" +
	"\n" +
	"1. Edit `screens.yaml` or a flow.\n" +
	"2. Run `starboard fmt` to put the files in canonical form.\n" +
	"3. Run `starboard lint` and fix what it reports.\n" +
	"\n" +
	"To check that every screen file is registered, list each platform's source\n" +
	"directories under `roots` in `starboard.yaml`; its `screenFiles` patterns are\n" +
	"matched inside them.\n"
