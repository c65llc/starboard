// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// These tests compare core with the CLI. They are an external test package
// because the CLI imports core (through internal/mcp), so an in-package
// test importing the CLI would be an import cycle.
package core_test

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rogpeppe/go-internal/txtar"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	. "github.com/c65llc/starboard/core" //nolint:revive // the tests read as core's own
	"github.com/c65llc/starboard/internal/cli"
	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/diag"
)

// archive reads a txtar archive as Files.
func archive(t testing.TB, name string) Files {
	t.Helper()
	a, err := txtar.ParseFile(name)
	require.NoError(t, err)
	f := Files{}
	for _, file := range a.Files {
		f[file.Name] = string(file.Data)
	}
	return f
}

// projects are every test project: each CLI script archive that holds a
// starboard.yaml, plus core/testdata.
func projects(t *testing.T) map[string]Files {
	t.Helper()
	names, err := filepath.Glob(filepath.Join("..", "cmd", "starboard", "testdata", "script", "*.txtar"))
	require.NoError(t, err)
	more, err := filepath.Glob(filepath.Join("testdata", "*.txtar"))
	require.NoError(t, err)
	out := map[string]Files{}
	for _, name := range append(names, more...) {
		if f := archive(t, name); f[config.FileName] != "" {
			out[filepath.Base(name)] = f
		}
	}
	require.GreaterOrEqual(t, len(out), 8, "the CLI scripts should give several projects")
	return out
}

// writeTree writes f under a new temporary directory and returns it.
func writeTree(t *testing.T, f Files) string {
	t.Helper()
	dir := t.TempDir()
	for name, data := range f {
		full := filepath.Join(dir, filepath.FromSlash(name))
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o750))
		require.NoError(t, os.WriteFile(full, []byte(data), 0o600))
	}
	return dir
}

// readTree reads every file under dir as Files.
func readTree(t *testing.T, dir string) Files {
	t.Helper()
	f := Files{}
	require.NoError(t, filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := os.ReadFile(p) //nolint:gosec // a path under the test's own temporary directory
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		f[filepath.ToSlash(rel)] = string(data)
		return nil
	}))
	return f
}

// starboard runs the CLI in-process and returns its exit status and stdout.
func starboard(t *testing.T, args ...string) (int, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := cli.Run(args, strings.NewReader(""), &stdout, &stderr)
	return code, stdout.String()
}

// cliReport is the document `starboard lint --json` writes.
type cliReport struct {
	Version  int               `json:"version"`
	Errors   []diag.Diagnostic `json:"errors"`
	Warnings []diag.Diagnostic `json:"warnings"`
}

func bySeverity(ds []diag.Diagnostic, sev diag.Severity) []diag.Diagnostic {
	out := []diag.Diagnostic{}
	for _, d := range ds {
		if d.Severity == sev {
			out = append(out, d)
		}
	}
	return out
}

func marshal(t *testing.T, v any) string {
	t.Helper()
	data, err := json.Marshal(v)
	require.NoError(t, err)
	return string(data)
}

// TestLintMatchesCLI checks core.Lint against `starboard lint --json` on
// the same files. The CLI's document splits the findings into errors and
// warnings, so each list is compared, byte for byte as JSON, with the
// findings of that severity, and the counts and pass/fail with the exit
// status, with and without --strict.
func TestLintMatchesCLI(t *testing.T) {
	for name, f := range projects(t) {
		t.Run(name, func(t *testing.T) {
			dir := writeTree(t, f)
			for _, strict := range []bool{false, true} {
				args := []string{"--dir", dir, "lint", "--json"}
				if strict {
					args = append(args, "--strict")
				}
				code, out := starboard(t, args...)
				var want cliReport
				require.NoError(t, json.Unmarshal([]byte(out), &want), out)

				got, err := Lint(f, strict)
				require.NoError(t, err)
				assert.Equal(t, marshal(t, want.Errors), marshal(t, bySeverity(got.Diagnostics, diag.Error)))
				assert.Equal(t, marshal(t, want.Warnings), marshal(t, bySeverity(got.Diagnostics, diag.Warn)))
				assert.Len(t, got.Diagnostics, got.Errors+got.Warnings)
				assert.Equal(t, len(want.Errors), got.Errors)
				assert.Equal(t, len(want.Warnings), got.Warnings)
				assert.Equal(t, code == cli.ExitOK, got.Passed, "strict=%v", strict)
			}
		})
	}
}

// TestFixMatchesCLI applies core.Fix's changes to the files and compares
// the result with the tree `starboard lint --fix` leaves.
func TestFixMatchesCLI(t *testing.T) {
	for name, f := range projects(t) {
		t.Run(name, func(t *testing.T) {
			dir := writeTree(t, f)
			starboard(t, "--dir", dir, "lint", "--fix")
			want := readTree(t, dir)

			got := maps.Clone(f)
			ch, err := Fix(f)
			if err != nil {
				require.ErrorIs(t, err, ErrNotLoaded)
				assert.Equal(t, FixResult{}, ch)
			}
			maps.Copy(got, ch.Write)
			for _, name := range ch.Remove {
				delete(got, name)
			}
			assert.Equal(t, want, got)
		})
	}
}

// TestEditThenLintSameAsCLI checks that Edit's diagnostics are those
// `starboard lint --json` gives for the edited files.
func TestEditThenLintSameAsCLI(t *testing.T) {
	f := archive(t, filepath.Join("testdata", "edit", "project.txtar"))
	got, err := Edit(f, []EditOp{
		{Op: "set", Screen: "trip.timeline", Path: "layout[2]", Key: "kind", Value: "rocket"},
		{Op: "set", Screen: "trip.timeline", Path: "layout[1].item", Key: "to", Value: "nope.screen"},
	})
	require.NoError(t, err)
	maps.Copy(f, got.Files)
	code, out := starboard(t, "--dir", writeTree(t, f), "lint", "--json")
	var want cliReport
	require.NoError(t, json.Unmarshal([]byte(out), &want), out)
	assert.NotEqual(t, 0, code)
	assert.Equal(t, marshal(t, want.Errors), marshal(t, bySeverity(got.Diagnostics, diag.Error)))
	assert.Equal(t, marshal(t, want.Warnings), marshal(t, bySeverity(got.Diagnostics, diag.Warn)))
	assert.Len(t, got.Diagnostics, len(want.Errors)+len(want.Warnings))
	assert.Contains(t, marshal(t, got.Diagnostics), "rocket", "the edit's own problem is reported")
	assert.Contains(t, marshal(t, got.Diagnostics), "nope.screen")
}
