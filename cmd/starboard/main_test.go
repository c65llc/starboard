// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package main

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/rogpeppe/go-internal/testscript"
)

// TestMain makes this test binary double as the starboard command, which
// the scripts run with exec.
func TestMain(m *testing.M) {
	testscript.Main(m, map[string]func(){"starboard": main})
}

// TestScripts runs testdata/script/*.txtar against the real binary.
func TestScripts(t *testing.T) {
	testscript.Run(t, testscript.Params{
		Dir:                 "testdata/script",
		RequireExplicitExec: true,
		Cmds: map[string]func(*testscript.TestScript, bool, []string){
			"exits": exits, "crlf": crlf, "verifydocs": verifyDocs, "cpdir": cpdir,
		},
		Setup: func(env *testscript.Env) error {
			// Under -race, a race-instrumented process sleeps for a second
			// as it exits (the race runtime's atexit_sleep_ms, so other
			// threads can report), and every starboard a script runs is
			// this test binary: docs_examples alone runs one page's
			// commands in sequence and took ~35 s on that sleep. Races are
			// still detected and still fail the command (exit status 66).
			env.Setenv("GORACE", strings.TrimSpace(os.Getenv("GORACE")+" atexit_sleep_ms=0"))
			// REPO is the repository root, for scripts that read docs/ or examples/.
			repo, err := filepath.Abs(filepath.Join("..", ".."))
			env.Setenv("REPO", repo)
			return err
		},
	})
}

// exits runs a command, like exec, and requires its exit status to be the
// given number: "exits 2 starboard lint".
func exits(ts *testscript.TestScript, neg bool, args []string) {
	if neg || len(args) < 2 {
		ts.Fatalf("usage: exits status command [args...]")
	}
	want, err := strconv.Atoi(args[0])
	if err != nil {
		ts.Fatalf("exits: bad status %q", args[0])
	}
	got := 0
	if err := ts.Exec(args[1], args[2:]...); err != nil {
		var ee *exec.ExitError
		if !errors.As(err, &ee) {
			ts.Fatalf("exits: %v", err)
		}
		got = ee.ExitCode()
	}
	if got != want {
		ts.Fatalf("exit status %d, want %d", got, want)
	}
}

// crlf rewrites each file with CRLF line endings, as a Windows checkout with
// core.autocrlf=true does: "crlf starboard.yaml docs/flows/screens.yaml".
func crlf(ts *testscript.TestScript, neg bool, args []string) {
	if neg || len(args) == 0 {
		ts.Fatalf("usage: crlf file...")
	}
	for _, name := range args {
		data := ts.ReadFile(name)
		out := bytes.ReplaceAll(bytes.ReplaceAll([]byte(data), []byte("\r\n"), []byte("\n")), []byte("\n"), []byte("\r\n"))
		ts.Check(os.WriteFile(ts.MkAbs(name), out, 0o644)) //nolint:gosec // G306: an ordinary test file
	}
}

// cpdir copies a directory tree, such as an example project, to a new
// directory: "cpdir $REPO/examples/travel-app app".
func cpdir(ts *testscript.TestScript, neg bool, args []string) {
	if neg || len(args) != 2 {
		ts.Fatalf("usage: cpdir src dst")
	}
	ts.Check(os.CopyFS(ts.MkAbs(args[1]), os.DirFS(ts.MkAbs(args[0]))))
}
