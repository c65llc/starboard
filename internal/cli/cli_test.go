// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package cli

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
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
	code := Run(args, strings.NewReader(""), &stdout, &stderr)
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

func TestRules(t *testing.T) {
	code, out, errOut := run("rules")
	assert.Equal(t, 0, code)
	assert.Empty(t, errOut)
	lines := strings.Split(strings.TrimSuffix(out, "\n"), "\n")
	rules := lint.Rules()
	require.Len(t, lines, len(rules)+1)
	assert.Regexp(t, `^RULE +KIND +DEFAULT +SUMMARY$`, lines[0])
	for i, r := range rules {
		assert.Regexp(t, `^`+regexp.QuoteMeta(r.ID)+` +`+r.Kind()+` +`+string(r.Default)+` +`+regexp.QuoteMeta(r.Summary)+`$`, lines[i+1])
	}

	code, out, errOut = run("rules", "--json")
	assert.Equal(t, 0, code)
	assert.Empty(t, errOut)
	var report struct {
		Version int
		Rules   []map[string]string
	}
	require.NoError(t, json.Unmarshal([]byte(out), &report))
	assert.Equal(t, 1, report.Version)
	require.Len(t, report.Rules, len(rules))
	for i, r := range rules {
		assert.Equal(t, map[string]string{
			"id": r.ID, "kind": r.Kind(), "default": string(r.Default), "summary": r.Summary,
			"docs": "https://starboard.c65llc.com/rules/" + r.ID + "/",
		}, report.Rules[i])
	}
	assert.True(t, strings.HasPrefix(out, "{\n  \"version\": 1,\n  \"rules\": [\n    {\n      \"id\": "), out)

	code, out, errOut = run("rules", "extra")
	assert.Equal(t, 2, code)
	assert.Empty(t, out)
	assert.Contains(t, errOut, "rules takes no arguments")
	assert.Contains(t, errOut, "usage: starboard [--dir D] rules [--json]\n")
}

func TestRulesWriteError(t *testing.T) {
	for _, args := range [][]string{{"rules"}, {"rules", "--json"}} {
		var stderr bytes.Buffer
		code := Run(args, strings.NewReader(""), errWriter{}, &stderr)
		assert.Equal(t, 2, code, args)
		assert.Contains(t, stderr.String(), "writing output", args)
	}
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
		{[]string{"lint", "--bogus"}, "usage: starboard [--dir D] lint [--json] [--fix] [--strict]"},
		{[]string{"init", "--platform"}, "flag needs an argument: -platform"},
		{[]string{"render", "a.b", "--bogus"}, "flag provided but not defined: -bogus"},
		{[]string{"render", "a.b", "-o", "x", "-o", "y"}, "-o given more than once"},
		{[]string{"schema", "config", "extra"}, "schema takes one argument"},
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
			if c.Hidden {
				assert.NotContains(t, out, "\n  "+c.Name+" ", c.Name)
				continue
			}
			if len(c.Subcommands) == 0 {
				assert.Contains(t, out, "\n  "+c.Name+" ", c.Name)
				assert.Contains(t, out, c.Summary, c.Name)
			}
			for _, sub := range c.Subcommands {
				assert.Contains(t, out, "\n  "+c.Name+" "+sub.Name+" ", sub.Name)
				assert.Contains(t, out, sub.Summary, sub.Name)
			}
		}
		assert.Contains(t, out, "--dir D")
	}
	code, out, _ := run("lint", "--help")
	assert.Equal(t, 0, code)
	assert.Contains(t, out, "usage: starboard [--dir D] lint [--json] [--fix] [--strict]\n")
	assert.Contains(t, out, "--strict")
	assert.Contains(t, out, "--json")
}

// TestCommandsTable: every command in the table runs, and the table
// describes it the way the usage prints it.
func TestCommandsTable(t *testing.T) {
	var names []string
	leaves := 0
	check := func(name string, c Command) {
		leaves++
		assert.NotEmpty(t, c.Summary, name)
		_, ok := handlers[name]
		assert.True(t, ok, "no handler for %s", name)
		for _, f := range c.Flags {
			assert.NotEmpty(t, f.Summary, "%s --%s", name, f.Name)
			assert.False(t, f.Arg == "" && f.Repeat, "%s --%s: a boolean flag cannot repeat", name, f.Name)
		}
	}
	for _, c := range Commands {
		names = append(names, c.Name)
		assert.NotEmpty(t, c.Summary, c.Name)
		if len(c.Subcommands) == 0 {
			check(c.Name, c)
			continue
		}
		assert.Empty(t, c.Flags, "a group has no flags of its own")
		assert.Empty(t, c.Args, "a group has no arguments of its own")
		for _, sub := range c.Subcommands {
			assert.Empty(t, sub.Subcommands, "groups do not nest")
			check(c.Name+" "+sub.Name, sub)
		}
	}
	assert.Equal(t, []string{"init", "fmt", "lint", "rules", "generate", "render", "schema", "skills", "version", "hook"}, names)
	assert.Len(t, handlers, leaves)
	assert.True(t, Commands[9].Hidden)
	assert.Equal(t, "init [--platform P]...", Commands[0].Synopsis())
	assert.Equal(t, "rules [--json]", Commands[3].Synopsis())
	assert.Equal(t, "generate [--check]", Commands[4].Synopsis())
	assert.Equal(t, "render [--form-factor F] [-o FILE] <screen-id>", Commands[5].Synopsis())
	assert.Equal(t, "schema <config|screens>", Commands[6].Synopsis())
	assert.Equal(t, "version", Commands[8].Synopsis())
	assert.Empty(t, listValue{}.String())
	assert.Equal(t, "a,b", listValue{&[]string{"a", "b"}}.String())
}

func TestInit(t *testing.T) {
	dir := t.TempDir()
	code, out, errOut := run("--dir", dir, "init", "--platform", "ios")
	assert.Equal(t, 0, code, errOut)
	assert.Equal(t, ".gitattributes\ndocs/flows/README.md\ndocs/flows/flows/example.md\n"+
		"docs/flows/generated/app-map.md\ndocs/flows/generated/screens.md\n"+
		"docs/flows/generated/wireframes/home.main.phone.svg\n"+
		"docs/flows/screens.yaml\nstarboard.yaml\n", out)
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
	for _, args := range [][]string{{"lint"}, {"lint", "--json"}, {"fmt"}, {"fmt", "--check"}, {"generate"}, {"generate", "--check"}, {"render", "a.b"}} {
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

// TestFmtLoadErrors: fmt reports the load's errors and exits 1, with
// --check or without, while still formatting the files it can.
func TestFmtLoadErrors(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, map[string]string{
		"starboard.yaml":          unformattedConfig,
		"docs/flows/screens.yaml": "screens:\n  home.main: [\n",
	})
	code, out, errOut := run("--dir", dir, "fmt", "--check")
	assert.Equal(t, 1, code)
	assert.Equal(t, "starboard.yaml\n", out)
	assert.Contains(t, errOut, "docs/flows/screens.yaml:2: error yaml-syntax: ")
	assert.NotContains(t, errOut, "cannot format", "the load already reports it")

	code, out, errOut = run("--dir", dir, "fmt")
	assert.Equal(t, 1, code)
	assert.Equal(t, "starboard.yaml\n", out)
	assert.Contains(t, errOut, "error yaml-syntax: ")
	assert.Equal(t, "version: 1\nareas: [home]\n", read(t, dir, "starboard.yaml"))
}

// TestFmtCannotFormat: a file the formatter refuses is named on stderr and
// makes fmt exit 1.
func TestFmtCannotFormat(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, map[string]string{
		"starboard.yaml":          "version: 1\nareas: [home]\n",
		"docs/flows/screens.yaml": "[[[]#\n]#\n]\n",
	})
	for _, args := range [][]string{{"fmt", "--check"}, {"fmt"}} {
		code, out, errOut := run(append([]string{"--dir", dir}, args...)...)
		assert.Equal(t, 1, code, "%v", args)
		assert.Empty(t, out)
		assert.Contains(t, errOut, "cannot format docs/flows/screens.yaml: formatting would drop a comment: #\n")
	}
	assert.Equal(t, "[[[]#\n]#\n]\n", read(t, dir, "docs/flows/screens.yaml"))
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
	for _, args := range [][]string{{"lint"}, {"fmt"}, {"generate"}, {"render", "x.y"}} {
		code, out, errOut := run(append([]string{"--dir", dir}, args...)...)
		cmd := args[0]
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
	assert.Equal(t, "docs/flows/screens.yaml:2: warn missing-purpose: home.main has no purpose; say in a sentence what the screen is for (screens.home.main.purpose)\n"+
		"docs/flows/screens.yaml:2: warn orphan-screen: no flow references home.main (screens.home.main)\n"+
		"docs/flows/screens.yaml:2: warn unreachable-screen: no other screen links to home.main, it is not presentation: root, and no flow starts there (screens.home.main)\n"+
		"docs/flows/screens.yaml:5: error unknown-presentation: unknown presentation modal; use root, push, tab, sheet, dialog, window or route (screens.home.main.presentation)\n"+
		"1 error, 3 warnings\n", out)
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
	code := Run([]string{"--dir", dir, "lint", "--json"}, nil, errWriter{}, &stderr)
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

// TestGenerateErrors: a file generate cannot write, or cannot remove,
// stops it with exit 2.
func TestGenerateErrors(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("directory permissions are not enforced here")
	}
	for _, locked := range []string{"docs/flows/generated", "docs/flows/generated/wireframes"} {
		dir := t.TempDir()
		write(t, dir, map[string]string{
			"starboard.yaml":                                "version: 1\nareas: [home]\n",
			"docs/flows/screens.yaml":                       "screens:\n  home.main:\n    title: Home\n    area: home\n    presentation: root\n",
			"docs/flows/generated/wireframes/old.phone.svg": "x\n",
		})
		d := filepath.Join(dir, filepath.FromSlash(locked))
		require.NoError(t, os.Chmod(d, 0o500))       //nolint:gosec // G302: a directory needs x to be read; this one must refuse writes
		t.Cleanup(func() { _ = os.Chmod(d, 0o700) }) //nolint:gosec // G302: restore the directory so TempDir can remove it
		code, _, errOut := run("--dir", dir, "generate")
		assert.Equal(t, 2, code, locked)
		assert.True(t, strings.HasPrefix(errOut, "starboard: "), errOut)
		assert.FileExists(t, filepath.Join(dir, "docs", "flows", "generated", "wireframes", "old.phone.svg"))
	}
}

func TestGenerateUnreadable(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("directory permissions are not enforced here")
	}
	dir := t.TempDir()
	write(t, dir, map[string]string{
		"starboard.yaml":                                "version: 1\nareas: [home]\n",
		"docs/flows/screens.yaml":                       "screens:\n  home.main:\n    title: Home\n    area: home\n    presentation: root\n",
		"docs/flows/generated/wireframes/old.phone.svg": "x\n",
	})
	sub := filepath.Join(dir, "docs", "flows", "generated", "wireframes")
	require.NoError(t, os.Chmod(sub, 0))           //nolint:gosec // G302: an unreadable directory
	t.Cleanup(func() { _ = os.Chmod(sub, 0o700) }) //nolint:gosec // G302: restore the directory so TempDir can remove it
	for _, args := range [][]string{{"generate"}, {"generate", "--check"}} {
		code, out, errOut := run(append([]string{"--dir", dir}, args...)...)
		assert.Equal(t, 2, code, "%v", args)
		assert.Empty(t, out)
		assert.True(t, strings.HasPrefix(errOut, "starboard: "), errOut)
	}
	assert.NoFileExists(t, filepath.Join(dir, "docs", "flows", "generated", "app-map.md"))
}

func TestRenderUnreadableConfig(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, map[string]string{"starboard.yaml": "version: [1\n"})
	code, out, errOut := run("--dir", dir, "render", "a.b")
	assert.Equal(t, 1, code)
	assert.Empty(t, out)
	assert.Contains(t, errOut, "starboard.yaml:1: error yaml-syntax: ")
}

// TestFlagsAfterArgs: flags may follow the positional arguments, and a
// "--" ends the flags.
func TestFlagsAfterArgs(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, map[string]string{
		"starboard.yaml":          "version: 1\nplatforms:\n  ios:\n    formFactors: [phone]\nareas: [home]\n",
		"docs/flows/screens.yaml": "screens:\n  home.main:\n    title: Home\n    area: home\n    presentation: root\n",
	})
	code, out, errOut := run("--dir", dir, "render", "home.main", "--form-factor", "tablet")
	assert.Equal(t, 0, code, errOut)
	assert.Contains(t, out, "<title>Home — tablet</title>")
	code, _, errOut = run("--dir", dir, "render", "--", "--form-factor")
	assert.Equal(t, 2, code)
	assert.Equal(t, "starboard render: unknown screen --form-factor\n", errOut)
}

const renderConfig = "version: 1\nplatforms:\n  ios:\n    formFactors: [phone]\n  cli: {}\nareas: [home]\n"

const renderScreens = "screens:\n  home.main:\n    title: Home\n    area: home\n    presentation: root\n" +
	"  cli.only:\n    title: CLI\n    area: home\n    presentation: push\n    platforms: [cli]\n    platformNote: terminal\n"

func TestGenerateAndRender(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, map[string]string{"starboard.yaml": renderConfig, "docs/flows/screens.yaml": renderScreens})

	code, out, errOut := run("--dir", dir, "generate", "--check")
	assert.Equal(t, 1, code, errOut)
	assert.Equal(t, "would write docs/flows/generated/app-map.md\nwould write docs/flows/generated/screens.md\n"+
		"would write docs/flows/generated/wireframes/home.main.phone.svg\n", out)
	assert.NoDirExists(t, filepath.Join(dir, "docs", "flows", "generated"))
	code, _, _ = run("--dir", dir, "generate")
	assert.Equal(t, 0, code)
	code, out, _ = run("--dir", dir, "generate", "--check")
	assert.Equal(t, 0, code)
	assert.Empty(t, out)
	code, _, errOut = run("--dir", dir, "generate", "x")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "generate takes no arguments")

	svg := read(t, dir, "docs/flows/generated/wireframes/home.main.phone.svg")
	code, out, errOut = run("--dir", dir, "render", "home.main")
	assert.Equal(t, 0, code, errOut)
	assert.Equal(t, svg, out)

	// -o is the person's own path: relative to the working directory, not
	// the project, or absolute; it must name an .svg file.
	cwd := t.TempDir()
	require.NoError(t, os.Mkdir(filepath.Join(cwd, "out"), 0o750))
	t.Chdir(cwd)
	code, out, _ = run("--dir", filepath.Join(dir, "docs"), "render", "home.main", "-o", "out/home.svg")
	assert.Equal(t, 0, code)
	assert.Equal(t, "wrote out/home.svg\n", out)
	assert.Equal(t, svg, read(t, cwd, "out/home.svg"))
	assert.NoFileExists(t, filepath.Join(dir, "out", "home.svg"))

	abs := filepath.Join(t.TempDir(), "abs.svg")
	code, out, _ = run("--dir", dir, "render", "home.main", "-o", abs)
	assert.Equal(t, 0, code)
	assert.Equal(t, "wrote "+abs+"\n", out)
	assert.Equal(t, svg, read(t, filepath.Dir(abs), "abs.svg"))

	cfg := read(t, dir, "starboard.yaml")
	for _, bad := range []string{filepath.Join(dir, "starboard.yaml"), "out/home.png", "out/svg"} {
		code, out, errOut = run("--dir", dir, "render", "home.main", "-o", bad)
		assert.Equal(t, 2, code, bad)
		assert.Empty(t, out)
		assert.Contains(t, errOut, "starboard render: -o must name an .svg file\n", bad)
	}
	assert.Equal(t, cfg, read(t, dir, "starboard.yaml"), "never overwritten")

	code, _, errOut = run("--dir", dir, "render", "home.main", "-o", filepath.Join(cwd, "missing", "x.svg"))
	assert.Equal(t, 2, code)
	assert.True(t, strings.HasPrefix(errOut, "starboard: "), errOut)

	for _, tc := range []struct {
		args []string
		want string
	}{
		{[]string{"nope.x"}, "starboard render: unknown screen nope.x\n"},
		{[]string{"cli.only"}, "starboard render: cli.only has no form factor; pass --form-factor\n"},
		{[]string{"home.main", "--form-factor", "watch"},
			"starboard render: unknown form factor watch; use desktop, phone, tablet, web-narrow or web-wide\n"},
	} {
		code, out, errOut := run(append([]string{"--dir", dir, "render"}, tc.args...)...)
		assert.Equal(t, 2, code, "%v", tc.args)
		assert.Empty(t, out)
		assert.Equal(t, tc.want, errOut)
	}
	code, _, errOut = run("--dir", dir, "render")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "render takes one screen ID")
}

func TestOrList(t *testing.T) {
	assert.Empty(t, orList(nil))
	assert.Equal(t, "a", orList([]string{"a"}))
	assert.Equal(t, "a or b", orList([]string{"a", "b"}))
	assert.Equal(t, "a, b or c", orList([]string{"a", "b", "c"}))
}

func TestHelpShowsShortFlag(t *testing.T) {
	code, out, _ := run("render", "--help")
	assert.Equal(t, 0, code)
	assert.Contains(t, out, "usage: starboard [--dir D] render [--form-factor F] [-o FILE] <screen-id>\n")
	assert.Contains(t, out, "  -o FILE ")
}

// TestBrokenProjectKeepsGenerated: with an error in loading, generate
// refuses rather than delete the wireframes of screens it cannot read, and
// lint does not check freshness.
func TestBrokenProjectKeepsGenerated(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, map[string]string{"starboard.yaml": renderConfig, "docs/flows/screens.yaml": renderScreens})
	code, _, errOut := run("--dir", dir, "generate")
	require.Equal(t, 0, code, errOut)
	write(t, dir, map[string]string{"docs/flows/screens.yaml": "screens: [\n"})

	for _, args := range [][]string{{"generate"}, {"generate", "--check"}} {
		code, out, errOut := run(append([]string{"--dir", dir}, args...)...)
		assert.Equal(t, 1, code, "%v", args)
		assert.Empty(t, out)
		assert.Contains(t, errOut, "docs/flows/screens.yaml:")
		assert.Contains(t, errOut, "error yaml-syntax: ")
	}
	assert.FileExists(t, filepath.Join(dir, "docs", "flows", "generated", "wireframes", "home.main.phone.svg"))

	code, out, _ := run("--dir", dir, "lint")
	assert.Equal(t, 1, code)
	assert.Contains(t, out, "error yaml-syntax: ")
	assert.NotContains(t, out, "generated-stale")
}

// fixProject is a project that is clean once formatted and generated.
var fixProject = map[string]string{
	"starboard.yaml":          "areas: [home]\nversion: 1\n",
	"docs/flows/screens.yaml": "screens:\n  home.main:\n    title: Home\n    area: home\n    purpose: p\n    presentation: root\n",
	"docs/flows/flows/a.md":   "---\nid: a\ntitle: A\nstatus: shipped\nentry: home.main\n---\n\n## Steps\n\n1. Open @home.main.\n",
}

func TestStrictCountsWarnings(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, fixProject)
	write(t, dir, map[string]string{"docs/flows/flows/a.md": "---\nid: a\ntitle: A\nstatus: shipped\nentry: home.main\n---\n\n## Steps\n\n1. Wave.\n"})
	code, out, _ := run("--dir", dir, "lint", "--fix")
	assert.Equal(t, 0, code, out)
	assert.Contains(t, out, "warn step-without-ref: ")
	assert.Contains(t, out, "0 errors, 1 warning\n")
	code, _, _ = run("--dir", dir, "lint", "--strict")
	assert.Equal(t, 1, code)
}

func TestLintFix(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, fixProject)
	code, out, errOut := run("--dir", dir, "lint", "--fix")
	assert.Equal(t, 0, code, out)
	assert.Empty(t, errOut)
	assert.Equal(t, "wrote docs/flows/generated/app-map.md\nwrote docs/flows/generated/screens.md\nwrote starboard.yaml\n0 errors, 0 warnings\n", out)
	assert.Equal(t, "version: 1\nareas: [home]\n", read(t, dir, "starboard.yaml"))

	code, out, _ = run("--dir", dir, "lint", "--strict")
	assert.Equal(t, 0, code)
	assert.Equal(t, "0 errors, 0 warnings\n", out)
}

func TestLintFixRefuses(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, fixProject)
	write(t, dir, map[string]string{"docs/flows/screens.yaml": "screens: [\n"})
	code, out, errOut := run("--dir", dir, "lint", "--fix")
	assert.Equal(t, 1, code)
	assert.Empty(t, out)
	assert.Contains(t, errOut, "error yaml-syntax: ")
	assert.Equal(t, fixProject["starboard.yaml"], read(t, dir, "starboard.yaml"))

	write(t, dir, map[string]string{"starboard.yaml": "version: [1\n"})
	code, _, errOut = run("--dir", dir, "lint", "--fix")
	assert.Equal(t, 1, code)
	assert.Contains(t, errOut, "starboard.yaml:1: error yaml-syntax: ")
}

// TestLintFixErrors: a file lint --fix cannot write or remove stops it
// with exit 2.
func TestLintFixErrors(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("directory permissions are not enforced here")
	}
	for _, tc := range []struct {
		locked string
		extra  map[string]string
	}{
		{locked: "."}, // starboard.yaml cannot be rewritten
		{locked: "docs/flows/generated", extra: map[string]string{
			"docs/flows/generated/x.md": "x\n", "starboard.yaml": "version: 1\nareas: [home]\n"}},
		{locked: "docs/flows/generated/wireframes", extra: map[string]string{
			"docs/flows/generated/wireframes/old.phone.svg": "x\n", "starboard.yaml": "version: 1\nareas: [home]\n"}},
	} {
		dir := t.TempDir()
		write(t, dir, fixProject)
		write(t, dir, tc.extra)
		d := filepath.Join(dir, filepath.FromSlash(tc.locked))
		require.NoError(t, os.Chmod(d, 0o500))       //nolint:gosec // G302: a directory needs x to be read; this one must refuse writes
		t.Cleanup(func() { _ = os.Chmod(d, 0o700) }) //nolint:gosec // G302: restore the directory so TempDir can remove it
		code, _, errOut := run("--dir", dir, "lint", "--fix")
		assert.Equal(t, 2, code, tc.locked)
		assert.True(t, strings.HasPrefix(errOut, "starboard: "), errOut)
	}
}
