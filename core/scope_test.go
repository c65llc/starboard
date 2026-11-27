// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package core

import (
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
	assert.Equal(t, ScopeResult{Content: "docs/flows", Read: []string{}, Present: []string{}}, got)
}

func TestScopeIgnoresInvalidRootsAndVocabularies(t *testing.T) {
	cfg := "version: 1\ncontent: ../out\nplatforms:\n  web:\n    roots: ['../up']\nvocabularies:\n  requires:\n    file: ../caps.json\n    select: .x[]\n"
	got, err := Scope(folder(cfg, "", "docs/flows/x.md"))
	require.NoError(t, err)
	assert.Equal(t, ScopeResult{Content: "docs/flows", Read: []string{}, Present: []string{}}, got)
}

func TestScopeErrors(t *testing.T) {
	_, err := Scope(Files{"x.txt": ""})
	require.ErrorIs(t, err, ErrNoProject)
	_, err = Scope(Files{"starboard.yaml": "version: 1\n", "../x": ""})
	require.ErrorIs(t, err, ErrInvalidPath)
}
