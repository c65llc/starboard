// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package cli is the starboard command line. Commands describes every
// command and flag; Run parses a command line against it and runs it. The
// exit status is 0 when the command succeeds cleanly, 1 for findings (lint
// errors, warnings under --strict, files fmt --check would change), and 2
// for a usage error, a missing project, or a command that could not run.
package cli

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"maps"
	"slices"
	"strings"
	"text/tabwriter"

	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/format"
	"github.com/c65llc/starboard/internal/lint"
	"github.com/c65llc/starboard/internal/osfs"
	"github.com/c65llc/starboard/internal/project"
	"github.com/c65llc/starboard/internal/scaffold"
	"github.com/c65llc/starboard/internal/schema"
	"github.com/c65llc/starboard/internal/version"
)

// The exit statuses Run returns.
const (
	ExitOK       = 0
	ExitFindings = 1
	ExitUsage    = 2
)

// Flag is one command-line flag. A flag with an Arg takes a value and, for
// now, is always repeatable; one without is a boolean.
type Flag struct {
	Name    string // without the leading dashes
	Arg     string // the value's placeholder; empty for a boolean flag
	Repeat  bool   // whether it may be given more than once
	Summary string
}

// synopsis is the flag as a usage line shows it, such as "[--dir D]".
func (f Flag) synopsis() string {
	s := "[--" + f.Name
	if f.Arg != "" {
		s += " " + f.Arg
	}
	s += "]"
	if f.Repeat {
		s += "..."
	}
	return s
}

// Command is one starboard command.
type Command struct {
	Name    string
	Args    string // the positional arguments as the usage shows them; empty for none
	Summary string
	Flags   []Flag
}

// Synopsis is the command as its usage line shows it after
// "starboard [--dir D] ", such as "lint [--json] [--strict]".
func (c Command) Synopsis() string {
	parts := []string{c.Name}
	for _, f := range c.Flags {
		parts = append(parts, f.synopsis())
	}
	if c.Args != "" {
		parts = append(parts, c.Args)
	}
	return strings.Join(parts, " ")
}

// GlobalFlags come before the command.
var GlobalFlags = []Flag{
	{Name: "dir", Arg: "D", Summary: "work in directory D (default: the working directory)"},
}

// Commands is every command, in the order the usage lists them.
var Commands = []Command{
	{
		Name:    "init",
		Summary: "Write a new project: starboard.yaml, docs/flows and a .gitattributes line.",
		Flags: []Flag{{
			Name: "platform", Arg: "P", Repeat: true,
			Summary: "add platform P; ios, android and web get suggested settings",
		}},
	},
	{
		Name:    "fmt",
		Summary: "Rewrite the project's files in canonical form, listing each one.",
		Flags:   []Flag{{Name: "check", Summary: "list the files fmt would change, change nothing, and exit 1 if any"}},
	},
	{
		Name:    "lint",
		Summary: "Check the project and report its errors and warnings.",
		Flags: []Flag{
			{Name: "json", Summary: "print the findings as a versioned JSON report"},
			{Name: "strict", Summary: "exit 1 on warnings as well as errors"},
		},
	},
	{
		Name:    "schema",
		Args:    "<config|screens>",
		Summary: "Print the JSON Schema for starboard.yaml (config) or screens.yaml (screens).",
	},
	{
		Name:    "version",
		Summary: "Print starboard's version.",
	},
}

// handlers run each command by name.
var handlers = map[string]func(*invocation) int{
	"init":    runInit,
	"fmt":     runFmt,
	"lint":    runLint,
	"schema":  runSchema,
	"version": runVersion,
}

// invocation is one parsed command line.
type invocation struct {
	cmd            Command
	dir            string
	args           []string
	bools          map[string]*bool
	lists          map[string]*[]string
	stdout, stderr io.Writer
}

// listValue is a flag that collects every value it is given.
type listValue struct{ values *[]string }

func (l listValue) String() string {
	if l.values == nil { // the zero value, which flag may make to print a default
		return ""
	}
	return strings.Join(*l.values, ",")
}

func (l listValue) Set(s string) error {
	*l.values = append(*l.values, s)
	return nil
}

// stickyWriter remembers the first error a write returns, and fails every
// write after it.
type stickyWriter struct {
	w   io.Writer
	err error
}

func (s *stickyWriter) Write(p []byte) (int, error) {
	if s.err != nil {
		return 0, s.err
	}
	n, err := s.w.Write(p)
	s.err = err
	return n, err
}

// Run runs the command line args, which exclude the program name, and
// returns the exit status. If writing to stdout fails, the command's output
// is incomplete, so Run reports the error and returns 2.
func Run(args []string, stdout, stderr io.Writer) int {
	out := &stickyWriter{w: stdout}
	code := dispatch(args, out, stderr)
	if out.err != nil {
		_, _ = fmt.Fprintf(stderr, "starboard: writing output: %v\n", out.err)
		return ExitUsage
	}
	return code
}

func dispatch(args []string, stdout, stderr io.Writer) int {
	global := flag.NewFlagSet("starboard", flag.ContinueOnError)
	global.SetOutput(io.Discard)
	dir := global.String("dir", ".", "")
	if err := global.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			usage(stdout)
			return ExitOK
		}
		_, _ = fmt.Fprintf(stderr, "starboard: %v\n", err)
		usage(stderr)
		return ExitUsage
	}
	rest := global.Args()
	if len(rest) == 0 {
		usage(stderr)
		return ExitUsage
	}
	if rest[0] == "help" {
		usage(stdout)
		return ExitOK
	}
	i := slices.IndexFunc(Commands, func(c Command) bool { return c.Name == rest[0] })
	if i < 0 {
		_, _ = fmt.Fprintf(stderr, "starboard: unknown command %s\n", rest[0])
		usage(stderr)
		return ExitUsage
	}
	inv := &invocation{
		cmd: Commands[i], dir: *dir, stdout: stdout, stderr: stderr,
		bools: map[string]*bool{}, lists: map[string]*[]string{},
	}
	fs := flag.NewFlagSet(inv.cmd.Name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	for _, f := range inv.cmd.Flags {
		if f.Arg == "" {
			inv.bools[f.Name] = fs.Bool(f.Name, false, f.Summary)
			continue
		}
		values := new([]string)
		inv.lists[f.Name] = values
		fs.Var(listValue{values}, f.Name, f.Summary)
	}
	if err := fs.Parse(rest[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			commandUsage(stdout, inv.cmd)
			return ExitOK
		}
		return inv.usageError("%v", err)
	}
	inv.args = fs.Args()
	return handlers[inv.cmd.Name](inv)
}

// usage writes the full usage.
func usage(w io.Writer) {
	var b strings.Builder
	b.WriteString("Usage: starboard [--dir D] <command> [flags]\n\nCommands:\n")
	tw := tabwriter.NewWriter(&b, 0, 0, 2, ' ', 0)
	for _, c := range Commands {
		_, _ = fmt.Fprintf(tw, "  %s\t%s\n", c.Synopsis(), c.Summary)
	}
	_ = tw.Flush()
	b.WriteString("\nFlags:\n")
	writeFlags(&b, GlobalFlags)
	b.WriteString("\nExit status: 0 clean, 1 findings, 2 usage error or no project.\n")
	_, _ = io.WriteString(w, b.String())
}

// commandUsage writes one command's usage line and its flags.
func commandUsage(w io.Writer, c Command) {
	var b strings.Builder
	_, _ = fmt.Fprintf(&b, "usage: starboard [--dir D] %s\n", c.Synopsis())
	if len(c.Flags) > 0 {
		b.WriteString("\n")
		writeFlags(&b, c.Flags)
	}
	_, _ = io.WriteString(w, b.String())
}

// writeFlags writes one aligned line per flag.
func writeFlags(w io.Writer, flags []Flag) {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	for _, f := range flags {
		name := "--" + f.Name
		if f.Arg != "" {
			name += " " + f.Arg
		}
		_, _ = fmt.Fprintf(tw, "  %s\t%s\n", name, f.Summary)
	}
	_ = tw.Flush()
}

// usageError reports a usage error and the command's usage line.
func (inv *invocation) usageError(format string, args ...any) int {
	_, _ = fmt.Fprintf(inv.stderr, "starboard %s: %s\n", inv.cmd.Name, fmt.Sprintf(format, args...))
	_, _ = fmt.Fprintf(inv.stderr, "usage: starboard [--dir D] %s\n", inv.cmd.Synopsis())
	return ExitUsage
}

// fail reports an error that stopped the command.
func (inv *invocation) fail(err error) int {
	_, _ = fmt.Fprintf(inv.stderr, "starboard: %v\n", err)
	return ExitUsage
}

// noArgs reports a usage error, and returns false, if the command was
// given arguments.
func (inv *invocation) noArgs() bool {
	if len(inv.args) == 0 {
		return true
	}
	inv.usageError("%s takes no arguments", inv.cmd.Name)
	return false
}

// load finds the project from the directory and loads it. The directory
// must exist: a missing one is an error, never a walk up to a parent. The
// caller closes the returned Dir.
func (inv *invocation) load() (*osfs.Dir, *project.Project, []diag.Diagnostic, error) {
	start, err := osfs.Open(inv.dir)
	if err != nil {
		return nil, nil, nil, err
	}
	_ = start.Close()
	root, err := osfs.FindRoot(inv.dir)
	if err != nil {
		return nil, nil, nil, err
	}
	d, err := osfs.Open(root)
	if err != nil {
		return nil, nil, nil, err
	}
	p, ds, err := project.Load(d)
	if err != nil {
		_ = d.Close()
		return nil, nil, nil, err
	}
	return d, p, ds, nil
}

func runInit(inv *invocation) int {
	if !inv.noArgs() {
		return ExitUsage
	}
	d, err := osfs.Open(inv.dir)
	if err != nil {
		return inv.fail(err)
	}
	defer func() { _ = d.Close() }()
	written, err := scaffold.Init(d, scaffold.Options{Platforms: *inv.lists["platform"]})
	if errors.Is(err, scaffold.ErrPlatformName) {
		return inv.usageError("%v", err)
	}
	if err != nil {
		return inv.fail(err)
	}
	for _, name := range written {
		_, _ = fmt.Fprintln(inv.stdout, name)
	}
	return ExitOK
}

func runFmt(inv *invocation) int {
	if !inv.noArgs() {
		return ExitUsage
	}
	d, p, ds, err := inv.load()
	if err != nil {
		return inv.fail(err)
	}
	defer func() { _ = d.Close() }()
	if p == nil { // starboard.yaml could not be read, so nothing can be formatted
		diag.WriteText(inv.stderr, ds)
		return ExitFindings
	}
	check := *inv.bools["check"]
	changed := format.Project(p)
	for _, name := range slices.Sorted(maps.Keys(changed)) {
		if !check {
			if err := d.WriteFile(name, changed[name]); err != nil {
				return inv.fail(err)
			}
		}
		_, _ = fmt.Fprintln(inv.stdout, name)
	}
	if check && len(changed) > 0 {
		return ExitFindings
	}
	return ExitOK
}

func runLint(inv *invocation) int {
	if !inv.noArgs() {
		return ExitUsage
	}
	d, p, ds, err := inv.load()
	if err != nil {
		return inv.fail(err)
	}
	defer func() { _ = d.Close() }()
	strict := *inv.bools["strict"]
	res := lint.Run(p, ds, lint.Options{Strict: strict})
	if *inv.bools["json"] {
		_ = diag.WriteJSON(inv.stdout, res.Diagnostics) // a write error is Run's to report
	} else {
		diag.WriteText(inv.stdout, res.Diagnostics)
		_, _ = fmt.Fprintln(inv.stdout, summary(res))
	}
	return lintExit(res, strict)
}

// lintExit is lint's exit status: 1 for any error, or for any warning
// under --strict.
func lintExit(res lint.Result, strict bool) int {
	if res.Errors > 0 || (strict && res.Warnings > 0) {
		return ExitFindings
	}
	return ExitOK
}

// summary is lint's last line of text output, such as "1 error, 2 warnings".
func summary(res lint.Result) string {
	count := func(n int, word string) string {
		if n == 1 {
			return "1 " + word
		}
		return fmt.Sprintf("%d %ss", n, word)
	}
	return count(res.Errors, "error") + ", " + count(res.Warnings, "warning")
}

func runSchema(inv *invocation) int {
	if len(inv.args) != 1 {
		return inv.usageError("schema takes one argument")
	}
	data, ok := schema.Get(inv.args[0])
	if !ok {
		return inv.usageError("unknown schema %s; use %s", inv.args[0], strings.Join(schema.Names, " or "))
	}
	_, _ = inv.stdout.Write(data)
	return ExitOK
}

func runVersion(inv *invocation) int {
	if !inv.noArgs() {
		return ExitUsage
	}
	_, _ = fmt.Fprintf(inv.stdout, "starboard %s\n", version.Version)
	return ExitOK
}
