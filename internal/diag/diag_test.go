// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package diag

import (
	"bytes"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSortStable(t *testing.T) {
	ds := []Diagnostic{
		{Rule: "b", File: "screens.yaml", Line: 3, Path: "p", Message: "m"},
		{Rule: "a", File: "starboard.yaml", Line: 1},
		{Rule: "b", File: "screens.yaml", Line: 3, Path: "a", Message: "z"},
		{Rule: "a", File: "screens.yaml", Line: 3, Path: "z"},
		{Rule: "b", File: "screens.yaml", Line: 3, Path: "a", Message: "y"},
		{Rule: "z", File: "screens.yaml", Line: 2},
	}
	Sort(ds)
	want := []Diagnostic{
		{Rule: "z", File: "screens.yaml", Line: 2},
		{Rule: "a", File: "screens.yaml", Line: 3, Path: "z"},
		{Rule: "b", File: "screens.yaml", Line: 3, Path: "a", Message: "y"},
		{Rule: "b", File: "screens.yaml", Line: 3, Path: "a", Message: "z"},
		{Rule: "b", File: "screens.yaml", Line: 3, Path: "p", Message: "m"},
		{Rule: "a", File: "starboard.yaml", Line: 1},
	}
	assert.Equal(t, want, ds)

	// Sorting an already sorted slice changes nothing.
	again := append([]Diagnostic(nil), ds...)
	Sort(again)
	assert.Equal(t, ds, again)
}

func TestWriteText(t *testing.T) {
	ds := []Diagnostic{
		{Rule: "orphan-screen", Severity: Warn, File: "screens.yaml", Path: "screens.home", Line: 12, Message: "no flow references home"},
		{Rule: "config-invalid", Severity: Error, File: "starboard.yaml", Line: 0, Message: "version is required"},
		{Rule: "file-missing", Severity: Error, File: "screens.yaml", Path: "screens.a.files[0]", Line: 4, Message: "a.swift does not exist"},
	}
	var buf bytes.Buffer
	WriteText(&buf, ds)
	want := "screens.yaml:4: error file-missing: a.swift does not exist (screens.a.files[0])\n" +
		"screens.yaml:12: warn orphan-screen: no flow references home (screens.home)\n" +
		"starboard.yaml: error config-invalid: version is required\n"
	assert.Equal(t, want, buf.String())
	// The caller's slice is not reordered.
	assert.Equal(t, "orphan-screen", ds[0].Rule)
}

func TestWriteJSONShape(t *testing.T) {
	ds := []Diagnostic{
		{Rule: "orphan-screen", Severity: Warn, File: "screens.yaml", Path: "screens.home", Line: 12, Message: "no flow references <home>"},
		{Rule: "not-formatted", Severity: Error, File: "screens.yaml", Message: "file is not formatted", Fix: &Fix{Description: "run starboard fmt"}},
		{Rule: "file-missing", Severity: Error, File: "screens.yaml", Path: "screens.a.files[0]", Line: 4, Message: "a.swift does not exist"},
	}
	var buf bytes.Buffer
	require.NoError(t, WriteJSON(&buf, ds))
	want := `{
  "version": 1,
  "errors": [
    {
      "rule": "not-formatted",
      "severity": "error",
      "file": "screens.yaml",
      "path": "",
      "message": "file is not formatted",
      "fix": {
        "description": "run starboard fmt"
      }
    },
    {
      "rule": "file-missing",
      "severity": "error",
      "file": "screens.yaml",
      "path": "screens.a.files[0]",
      "line": 4,
      "message": "a.swift does not exist"
    }
  ],
  "warnings": [
    {
      "rule": "orphan-screen",
      "severity": "warn",
      "file": "screens.yaml",
      "path": "screens.home",
      "line": 12,
      "message": "no flow references <home>"
    }
  ]
}
`
	assert.Equal(t, want, buf.String())
}

func TestWriteJSONEmpty(t *testing.T) {
	var buf bytes.Buffer
	require.NoError(t, WriteJSON(&buf, nil))
	assert.Equal(t, "{\n  \"version\": 1,\n  \"errors\": [],\n  \"warnings\": []\n}\n", buf.String())
}

func TestWriteJSONSkipsOff(t *testing.T) {
	var buf bytes.Buffer
	require.NoError(t, WriteJSON(&buf, []Diagnostic{{Rule: "orphan-screen", Severity: Off}}))
	assert.Equal(t, "{\n  \"version\": 1,\n  \"errors\": [],\n  \"warnings\": []\n}\n", buf.String())
}

type failWriter struct{}

func (failWriter) Write([]byte) (int, error) { return 0, errors.New("boom") }

func TestWriteJSONPropagatesWriteError(t *testing.T) {
	assert.EqualError(t, WriteJSON(failWriter{}, nil), "boom")
}

func TestRuleTables(t *testing.T) {
	assert.Len(t, CorrectnessRules, 29)
	for _, id := range []string{"config-invalid", "yaml-syntax", "yaml-alias-not-allowed", "generated-stale", "not-formatted"} {
		assert.True(t, CorrectnessRules[id], id)
	}
	assert.Equal(t, map[string]Severity{
		"unreachable-screen":      Warn,
		"orphan-screen":           Warn,
		"missing-purpose":         Warn,
		"label-too-long":          Warn,
		"flow-ref-not-in-diagram": Warn,
		"duplicate-edge":          Warn,
		"deep-nesting":            Warn,
		"edge-parity":             Warn,
		"step-without-ref":        Warn,
	}, QualityRules)
	for id := range QualityRules {
		assert.False(t, CorrectnessRules[id], "%s is in both tables", id)
	}
}
