// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package main

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"strconv"
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
		Cmds:                map[string]func(*testscript.TestScript, bool, []string){"exits": exits, "crlf": crlf},
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
