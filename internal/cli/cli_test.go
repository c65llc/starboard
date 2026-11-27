// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package cli

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/lint"
	"github.com/c65llc/starboard/internal/version"
)

// run runs the command line and returns its exit status and output.
func run(args ...string) (int, string, string) {
	var stdout, stderr bytes.Buffer
	code := Run(args, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

// write creates files under dir from a map of slash path to content.
func write(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	for name, content := range files {
		p := filepath.Join(dir, filepath.FromSlash(name))
		require.NoError(t, os.MkdirAll(filepath.Dir(p), 0o750))
		require.NoError(t, os.WriteFile(p, []byte(content), 0o600))
	}
}

func read(t *testing.T, dir, name string) string {
	t.Helper()
	data, err := fs.ReadFile(os.DirFS(dir), name)
	require.NoError(t, err)
	return string(data)
}

func TestVersion(t *testing.T) {
	code, out, errOut := run("version")
	assert.Equal(t, 0, code)
	assert.Equal(t, "starboard "+version.Version+"\n", out)
	assert.Empty(t, errOut)

	code, out, errOut = run("version", "extra")
	assert.Equal(t, 2, code)
	assert.Empty(t, out)
	assert.Contains(t, errOut, "version takes no arguments")
	assert.Contains(t, errOut, "usage: starboard [--dir D] version\n")
}

func TestSchema(t *testing.T) {
	for _, name := range []string{"config", "screens"} {
		code, out, errOut := run("schema", name)
		assert.Equal(t, 0, code)
		assert.Contains(t, out, `"$id": "https://starboard.c65llc.com/schema/v1/`+name+`.json"`)
		assert.True(t, json.Valid([]byte(out)))
		assert.Empty(t, errOut)
	}
	code, out, errOut := run("schema", "flows")
	assert.Equal(t, 2, code)
	assert.Empty(t, out)
	assert.Contains(t, errOut, "unknown schema flows; use config or screens")

	for _, args := range [][]string{{"schema"}, {"schema", "config", "screens"}} {
		code, _, errOut = run(args...)
		assert.Equal(t, 2, code)
		assert.Contains(t, errOut, "schema takes one argument")
		assert.Contains(t, errOut, "usage: starboard [--dir D] schema <config|screens>\n")
	}
}

func TestUsageErrors(t *testing.T) {
	cases := []struct {
		args []string
		want string
	}{
		{nil, "Usage: starboard [--dir D] <command> [flags]"},
		{[]string{"nope"}, "unknown command nope"},
		{[]string{"--bogus", "version"}, "flag provided but not defined: -bogus"},
		{[]string{"--dir"}, "flag needs an argument: -dir"},
		{[]string{"lint", "--bogus"}, "usage: starboard [--dir D] lint [--json] [--strict]"},
		{[]string{"init", "--platform"}, "flag needs an argument: -platform"},
	}
	for _, tc := range cases {
		code, out, errOut := run(tc.args...)
		assert.Equal(t, 2, code, "%v", tc.args)
		assert.Empty(t, out, "%v", tc.args)
		assert.Contains(t, errOut, tc.want, "%v", tc.args)
	}
	_, _, errOut := run("nope")
	assert.Contains(t, errOut, "Usage: starboard", "an unknown command prints the full usage")
}

func TestHelp(t *testing.T) {
	for _, args := range [][]string{{"--help"}, {"-h"}, {"help"}} {
		code, out, errOut := run(args...)
		assert.Equal(t, 0, code, "%v", args)
		assert.Empty(t, errOut)
		assert.True(t, strings.HasPrefix(out, "Usage: starboard [--dir D] <command> [flags]\n"), "%v", args)
		for _, c := range Commands {
			assert.Contains(t, out, "\n  "+c.Name+" ", c.Name)
			assert.Contains(t, out, c.Summary, c.Name)
		}
		assert.Contains(t, out, "--dir D")
	}
	code, out, _ := run("lint", "--help")
	assert.Equal(t, 0, code)
	assert.Contains(t, out, "usage: starboard [--dir D] lint [--json] [--strict]\n")
	assert.Contains(t, out, "--strict")
	assert.Contains(t, out, "--json")
}

// TestCommandsTable: every command in the table runs, and the table
// describes it the way the usage prints it.
func TestCommandsTable(t *testing.T) {
	var names []string
	for _, c := range Commands {
		names = append(names, c.Name)
		assert.NotEmpty(t, c.Summary, c.Name)
		_, ok := handlers[c.Name]
		assert.True(t, ok, "no handler for %s", c.Name)
		for _, f := range c.Flags {
			assert.NotEmpty(t, f.Summary, "%s --%s", c.Name, f.Name)
			// Run collects every value flag as a list.
			assert.Equal(t, f.Arg != "", f.Repeat, "%s --%s: a flag with a value must be Repeat", c.Name, f.Name)
		}
	}
	assert.Equal(t, []string{"init", "fmt", "lint", "schema", "version"}, names)
	assert.Len(t, handlers, len(Commands))
	assert.Equal(t, "init [--platform P]...", Commands[0].Synopsis())
	assert.Equal(t, "schema <config|screens>", Commands[3].Synopsis())
	assert.Equal(t, "version", Commands[4].Synopsis())
	assert.Empty(t, listValue{}.String())
	assert.Equal(t, "a,b", listValue{&[]string{"a", "b"}}.String())
}

func TestInit(t *testing.T) {
	dir := t.TempDir()
	code, out, errOut := run("--dir", dir, "init", "--platform", "ios")
	assert.Equal(t, 0, code, errOut)
	assert.Equal(t, ".gitattributes\ndocs/flows/README.md\ndocs/flows/flows/example.md\ndocs/flows/screens.yaml\nstarboard.yaml\n", out)
	assert.Contains(t, read(t, dir, "starboard.yaml"), "ios:")

	code, out, errOut = run("--dir", dir, "lint", "--strict")
	assert.Equal(t, 0, code, out)
	assert.Equal(t, "0 errors, 0 warnings\n", out)
	assert.Empty(t, errOut)

	code, out, _ = run("--dir", dir, "fmt", "--check")
	assert.Equal(t, 0, code)
	assert.Empty(t, out)

	code, out, errOut = run("--dir", dir, "init")
	assert.Equal(t, 2, code)
	assert.Empty(t, out)
	assert.Equal(t, "starboard: starboard.yaml already exists\n", errOut)

	code, _, errOut = run("--dir", filepath.Join(dir, "missing"), "init")
	assert.Equal(t, 2, code)
	assert.True(t, strings.HasPrefix(errOut, "starboard: "), errOut)
	assert.NoDirExists(t, filepath.Join(dir, "missing"))

	code, _, errOut = run("--dir", t.TempDir(), "init", "--platform", "iOS")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "platform names are lowercase letters")

	code, _, errOut = run("--dir", t.TempDir(), "init", "extra")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "init takes no arguments")
}

// TestDefaultDir: without --dir, commands work in the working directory,
// and fmt and lint find the project from a subdirectory.
func TestDefaultDir(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	code, _, errOut := run("init")
	require.Equal(t, 0, code, errOut)
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "docs", "flows", "deeper"), 0o750))
	t.Chdir(filepath.Join(dir, "docs", "flows", "deeper"))
	code, out, _ := run("lint")
	assert.Equal(t, 0, code)
	assert.Equal(t, "0 errors, 0 warnings\n", out)
}

func TestNoProject(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, map[string]string{"sub/README.md": "x\n"})
	for _, args := range [][]string{{"lint"}, {"lint", "--json"}, {"fmt"}, {"fmt", "--check"}} {
		for _, d := range []string{dir, filepath.Join(dir, "sub")} {
			code, out, errOut := run(append([]string{"--dir", d}, args...)...)
			assert.Equal(t, 2, code, "%v", args)
			assert.Empty(t, out)
			assert.Equal(t, "starboard: no starboard.yaml found; run `starboard init`\n", errOut)
		}
	}
	// A --dir that does not exist does not walk up to a parent's project.
	write(t, dir, map[string]string{"starboard.yaml": "version: 1\n"})
	code, out, errOut := run("--dir", filepath.Join(dir, "missing"), "lint")
	assert.Equal(t, 2, code)
	assert.Empty(t, out)
	assert.True(t, strings.HasPrefix(errOut, "starboard: "), errOut)
}

func TestEmptyProject(t *testing.T) {
	for _, registry := range []string{"", "screens: {}\n", "-"} {
		dir := t.TempDir()
		files := map[string]string{"starboard.yaml": "version: 1\n"}
		if registry != "-" {
			files["docs/flows/screens.yaml"] = registry
		}
		write(t, dir, files)
		code, out, errOut := run("--dir", dir, "lint", "--strict")
		assert.Equal(t, 0, code, "%q", registry)
		assert.Equal(t, "0 errors, 0 warnings\n", out)
		assert.Empty(t, errOut)

		code, out, _ = run("--dir", dir, "lint", "--json")
		assert.Equal(t, 0, code)
		assert.Equal(t, "{\n  \"version\": 1,\n  \"errors\": [],\n  \"warnings\": []\n}\n", out)

		code, out, _ = run("--dir", dir, "fmt", "--check")
		assert.Equal(t, 0, code)
		assert.Empty(t, out)
	}
}

const unformattedConfig = "version:   1\nareas:\n  - home\n"

func TestFmt(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, map[string]string{
		"starboard.yaml":          unformattedConfig,
		"docs/flows/screens.yaml": "screens:\n  home.main:\n    presentation: root\n    title: Home\n    area: home\n",
	})
	code, out, errOut := run("--dir", dir, "fmt", "--check")
	assert.Equal(t, 1, code)
	assert.Equal(t, "docs/flows/screens.yaml\nstarboard.yaml\n", out)
	assert.Empty(t, errOut)
	assert.Equal(t, unformattedConfig, read(t, dir, "starboard.yaml"), "--check writes nothing")

	code, out, _ = run("--dir", filepath.Join(dir, "docs"), "fmt")
	assert.Equal(t, 0, code)
	assert.Equal(t, "docs/flows/screens.yaml\nstarboard.yaml\n", out)
	assert.Equal(t, "version: 1\nareas: [home]\n", read(t, dir, "starboard.yaml"))

	code, out, _ = run("--dir", dir, "fmt", "--check")
	assert.Equal(t, 0, code)
	assert.Empty(t, out)

	code, _, errOut = run("--dir", dir, "fmt", "extra")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "fmt takes no arguments")
}

func TestFmtUnreadableConfig(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, map[string]string{"starboard.yaml": "version: [1\n"})
	code, out, errOut := run("--dir", dir, "fmt")
	assert.Equal(t, 1, code)
	assert.Empty(t, out)
	assert.Contains(t, errOut, "starboard.yaml:1: error yaml-syntax: ")
}

func TestFmtWriteError(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("directory permissions are not enforced here")
	}
	dir := t.TempDir()
	write(t, dir, map[string]string{"starboard.yaml": unformattedConfig})
	require.NoError(t, os.Chmod(dir, 0o500))       //nolint:gosec // G302: a directory needs x to be read; this one must refuse writes
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) }) //nolint:gosec // G302: restore the directory so TempDir can remove it
	code, out, errOut := run("--dir", dir, "fmt")
	assert.Equal(t, 2, code)
	assert.Empty(t, out)
	assert.True(t, strings.HasPrefix(errOut, "starboard: "), errOut)
}

func TestLoadError(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("file permissions are not enforced here")
	}
	dir := t.TempDir()
	write(t, dir, map[string]string{"starboard.yaml": "version: 1\n", "docs/flows/screens.yaml": ""})
	require.NoError(t, os.Chmod(filepath.Join(dir, "docs", "flows", "screens.yaml"), 0))
	for _, cmd := range []string{"lint", "fmt"} {
		code, out, errOut := run("--dir", dir, cmd)
		assert.Equal(t, 2, code, cmd)
		assert.Empty(t, out)
		assert.True(t, strings.HasPrefix(errOut, "starboard: "), errOut)
	}
}

func TestLint(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, map[string]string{
		"starboard.yaml":          "version: 1\nareas: [home]\n",
		"docs/flows/screens.yaml": "screens:\n  home.main:\n    title: Home\n    area: home\n    presentation: modal\n",
	})
	code, out, errOut := run("--dir", dir, "lint")
	assert.Equal(t, 1, code)
	assert.Equal(t, "docs/flows/screens.yaml:5: error unknown-presentation: unknown presentation modal; use root, push, tab, sheet, dialog, window or route (screens.home.main.presentation)\n1 error, 0 warnings\n", out)
	assert.Empty(t, errOut)

	code, out, _ = run("--dir", dir, "lint", "--json", "--strict")
	assert.Equal(t, 1, code)
	var report struct {
		Version          int
		Errors, Warnings []diag.Diagnostic
	}
	require.NoError(t, json.Unmarshal([]byte(out), &report))
	assert.Equal(t, 1, report.Version)
	require.Len(t, report.Errors, 1)
	assert.Equal(t, "unknown-presentation", report.Errors[0].Rule)

	code, _, errOut = run("--dir", dir, "lint", "extra")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "lint takes no arguments")
}

func TestLintUnreadableConfig(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, map[string]string{"starboard.yaml": "version: [1\n"})
	code, out, _ := run("--dir", dir, "lint")
	assert.Equal(t, 1, code)
	assert.Contains(t, out, "starboard.yaml:1: error yaml-syntax: ")
	assert.Contains(t, out, "1 error, 0 warnings\n")
}

func TestLintExit(t *testing.T) {
	cases := []struct {
		errors, warnings int
		strict           bool
		want             int
	}{
		{0, 0, false, 0},
		{0, 0, true, 0},
		{0, 2, false, 0},
		{0, 2, true, 1},
		{1, 0, false, 1},
		{1, 3, true, 1},
	}
	for _, tc := range cases {
		got := lintExit(lint.Result{Errors: tc.errors, Warnings: tc.warnings}, tc.strict)
		assert.Equal(t, tc.want, got, "%+v", tc)
	}
}

func TestSummary(t *testing.T) {
	assert.Equal(t, "0 errors, 0 warnings", summary(lint.Result{}))
	assert.Equal(t, "1 error, 1 warning", summary(lint.Result{Errors: 1, Warnings: 1}))
	assert.Equal(t, "2 errors, 3 warnings", summary(lint.Result{Errors: 2, Warnings: 3}))
}

// errWriter fails every write.
type errWriter struct{}

func (errWriter) Write([]byte) (int, error) { return 0, os.ErrClosed }

func TestLintJSONWriteError(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, map[string]string{"starboard.yaml": "version: 1\n"})
	var stderr bytes.Buffer
	code := Run([]string{"--dir", dir, "lint", "--json"}, errWriter{}, &stderr)
	assert.Equal(t, 2, code)
	assert.Equal(t, "starboard: writing output: "+os.ErrClosed.Error()+"\n", stderr.String())

	// The first failure sticks: later writes are not attempted.
	w := &stickyWriter{w: errWriter{}}
	_, err := w.Write([]byte("a"))
	require.ErrorIs(t, err, os.ErrClosed)
	n, err := w.Write([]byte("b"))
	assert.Zero(t, n)
	require.ErrorIs(t, err, os.ErrClosed)
}
