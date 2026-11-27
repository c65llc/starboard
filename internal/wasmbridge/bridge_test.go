// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package wasmbridge

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/rogpeppe/go-internal/txtar"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/core"
)

// trip is core/testdata/trip.txtar as Files.
func trip(t *testing.T) core.Files {
	t.Helper()
	a, err := txtar.ParseFile(filepath.Join("..", "..", "core", "testdata", "trip.txtar"))
	require.NoError(t, err)
	f := core.Files{}
	for _, file := range a.Files {
		f[file.Name] = string(file.Data)
	}
	return f
}

// call runs Call with args marshalled and returns the decoded envelope.
func call(t *testing.T, fn string, args any) (ok bool, value json.RawMessage, msg string) {
	t.Helper()
	in, err := json.Marshal(args)
	require.NoError(t, err)
	var out struct {
		OK    bool            `json:"ok"`
		Value json.RawMessage `json:"value"`
		Error string          `json:"error"`
	}
	require.NoError(t, json.Unmarshal([]byte(Call(fn, string(in))), &out))
	return out.OK, out.Value, out.Error
}

// want marshals v as core's result would be on the wire.
func want(t *testing.T, v any, err error) string {
	t.Helper()
	require.NoError(t, err)
	b, err := json.Marshal(v)
	require.NoError(t, err)
	return string(b)
}

func TestNamesAreTheBridge(t *testing.T) {
	assert.Equal(t, []string{"lint", "format", "generate", "fix", "render", "model", "walkthrough", "edit"}, Names)
}

func TestEachFunctionMatchesCore(t *testing.T) {
	f := trip(t)
	lint, lerr := core.Lint(f, true)
	format, ferr := core.Format(f)
	gen, gerr := core.Generate(f)
	fix, xerr := core.Fix(f)
	svg, rerr := core.Render(f, "trip.timeline", "phone")
	model, merr := core.Model(f)
	walk, werr := core.Walkthrough(f, "add-activity", "phone")
	ops := []core.EditOp{{Op: "set", Screen: "trip.timeline", Key: "title", Value: "Days"}}
	edit, eerr := core.Edit(f, ops)

	cases := []struct {
		fn   string
		args map[string]any
		want string
	}{
		{"lint", map[string]any{"files": f, "strict": true}, want(t, lint, lerr)},
		{"format", map[string]any{"files": f}, want(t, format, ferr)},
		{"generate", map[string]any{"files": f}, want(t, gen, gerr)},
		{"fix", map[string]any{"files": f}, want(t, fix, xerr)},
		{"render", map[string]any{"files": f, "screen": "trip.timeline", "formFactor": "phone"}, want(t, svg, rerr)},
		{"model", map[string]any{"files": f}, want(t, model, merr)},
		{"walkthrough", map[string]any{"files": f, "flow": "add-activity", "formFactor": "phone"}, want(t, walk, werr)},
		{"edit", map[string]any{"files": f, "ops": ops}, want(t, edit, eerr)},
	}
	for _, c := range cases {
		t.Run(c.fn, func(t *testing.T) {
			ok, value, msg := call(t, c.fn, c.args)
			require.True(t, ok, msg)
			assert.JSONEq(t, c.want, string(value))
		})
	}
}

func TestLintStrictDefaultsToFalse(t *testing.T) {
	f := trip(t)
	res, err := core.Lint(f, false)
	ok, value, _ := call(t, "lint", map[string]any{"files": f})
	require.True(t, ok)
	assert.JSONEq(t, want(t, res, err), string(value))
}

func TestCoreErrorIsAnErrorEnvelope(t *testing.T) {
	ok, value, msg := call(t, "render", map[string]any{"files": trip(t), "screen": "nope", "formFactor": "phone"})
	assert.False(t, ok)
	assert.Nil(t, value)
	assert.Contains(t, msg, "unknown screen: nope")

	ok, _, msg = call(t, "lint", map[string]any{"files": map[string]string{}})
	assert.False(t, ok)
	assert.Contains(t, msg, "starboard.yaml")
}

func TestBadInputIsAnErrorEnvelope(t *testing.T) {
	for name, tc := range map[string]struct{ fn, arg, want string }{
		"unknown function": {"explode", `{}`, `unknown function "explode"`},
		"not JSON":         {"lint", `{`, "lint: invalid arguments"},
		"unknown field":    {"lint", `{"files":{},"strikt":true}`, `unknown field "strikt"`},
		"trailing data":    {"model", `{"files":{}} {}`, "model: invalid arguments"},
		"wrong type":       {"render", `{"files":{},"screen":3}`, "render: invalid arguments"},
	} {
		t.Run(name, func(t *testing.T) {
			var out map[string]any
			require.NoError(t, json.Unmarshal([]byte(Call(tc.fn, tc.arg)), &out))
			assert.Equal(t, false, out["ok"])
			assert.Contains(t, out["error"], tc.want)
		})
	}
}

// Every function refuses an argument it does not take.
func TestEveryFunctionRefusesUnknownFields(t *testing.T) {
	for _, fn := range Names {
		ok, _, msg := call(t, fn, map[string]any{"files": map[string]string{}, "bogus": 1})
		assert.False(t, ok, fn)
		assert.Contains(t, msg, fn+`: invalid arguments: json: unknown field "bogus"`)
	}
}

func TestPanicIsAnErrorEnvelope(t *testing.T) {
	saved := funcs["model"]
	t.Cleanup(func() { funcs["model"] = saved })
	funcs["model"] = func([]byte) (any, error) { panic("boom") }

	ok, _, msg := call(t, "model", map[string]any{"files": map[string]string{}})
	assert.False(t, ok)
	assert.Equal(t, "model: internal error: boom", msg)
}

func TestUnencodableValueIsAnErrorEnvelope(t *testing.T) {
	saved := funcs["model"]
	t.Cleanup(func() { funcs["model"] = saved })
	funcs["model"] = func([]byte) (any, error) { return func() {}, nil }

	ok, _, msg := call(t, "model", map[string]any{})
	assert.False(t, ok)
	assert.Contains(t, msg, "model: encoding the result")
}
