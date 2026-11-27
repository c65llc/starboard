// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package selector

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func decode(t *testing.T, s string) any {
	t.Helper()
	var v any
	require.NoError(t, json.Unmarshal([]byte(s), &v))
	return v
}

func TestSelectorCapabilities(t *testing.T) {
	s, err := Compile(".capabilities[].name")
	require.NoError(t, err)
	got, err := s.Strings(decode(t, `{"capabilities":[{"name":"a"},{"name":"b"}]}`))
	require.NoError(t, err)
	assert.Equal(t, []string{"a", "b"}, got)
}

func TestSelectorForms(t *testing.T) {
	tests := []struct {
		name, expr, doc string
		want            []string
	}{
		{"single field", ".name", `{"name":"x"}`, []string{"x"}},
		{"top-level array", ".list[]", `{"list":["a","b"]}`, []string{"a", "b"}},
		{"nested arrays", ".a[].b[]", `{"a":[{"b":["x","y"]},{"b":["z"]}]}`, []string{"x", "y", "z"}},
		{"empty array", ".a[]", `{"a":[]}`, []string{}},
		{"ident chars", ".my_key-2", `{"my_key-2":"v"}`, []string{"v"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, err := Compile(tt.expr)
			require.NoError(t, err)
			got, err := s.Strings(decode(t, tt.doc))
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestSelectorRejects(t *testing.T) {
	for _, expr := range []string{".a | .b", "a", ".a[0]", "", ".", "..a", ".a[", ".a[]x", ".1a", ".a.", ".a []"} {
		t.Run(expr, func(t *testing.T) {
			_, err := Compile(expr)
			assert.Error(t, err)
		})
	}
}

func TestSelectorStringsErrors(t *testing.T) {
	tests := []struct{ name, expr, doc, msg string }{
		{"not an object", ".a", `["x"]`, "not an object"},
		{"missing field", ".a", `{"b":"x"}`, "no field a"},
		{"not an array", ".a[]", `{"a":"x"}`, "not an array"},
		{"not a string", ".a[]", `{"a":["x",1]}`, "not a string"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, err := Compile(tt.expr)
			require.NoError(t, err)
			_, err = s.Strings(decode(t, tt.doc))
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.msg)
		})
	}
}

func TestSelectorString(t *testing.T) {
	s, err := Compile(".capabilities[].name")
	require.NoError(t, err)
	assert.Equal(t, ".capabilities[].name", s.String())
}
