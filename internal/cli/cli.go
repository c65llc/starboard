// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package cli is the starboard command line. Commands describes every
// command and flag; Run parses a command line against it and runs it. The
// exit status is 0 when the command succeeds cleanly, 1 for findings (lint
// errors, warnings under --strict, files fmt --check or generate --check
// would change, a project fmt or generate finds errors in, or files fmt
// cannot format), and 2 for a usage error, a missing project, or a command
// that could not run. The hidden hook commands follow their agent's
// convention instead: hook claude-code exits 2 to hand findings back to
// Claude Code.
package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"maps"
	"path"
	"slices"
	"strings"
	"text/tabwriter"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/format"
	"github.com/c65llc/starboard/internal/generate"
	"github.com/c65llc/starboard/internal/lint"
	"github.com/c65llc/starboard/internal/mcp"
	"github.com/c65llc/starboard/internal/osfs"
	"github.com/c65llc/starboard/internal/project"
	"github.com/c65llc/starboard/internal/registry"
	"github.com/c65llc/starboard/internal/render"
	"github.com/c65llc/starboard/internal/scaffold"
	"github.com/c65llc/starboard/internal/schema"
	"github.com/c65llc/starboard/internal/skills"
	"github.com/c65llc/starboard/internal/version"
	skillsfs "github.com/c65llc/starboard/skills"
)

// The exit statuses Run returns.
const (
	ExitOK       = 0
	ExitFindings = 1
	ExitUsage    = 2
)

// Flag is one command-line flag. A flag with an Arg takes a value; one
// without is a boolean. A value flag without Repeat may be given once.
type Flag struct {
	Name    string // without the leading dashes
	Arg     string // the value's placeholder; empty for a boolean flag
	Repeat  bool   // whether it may be given more than once
	Summary string
}

// dashed is the flag's name as usage writes it: "-o" for a one-letter
// name, else "--name".
func (f Flag) dashed() string {
	if len(f.Name) == 1 {
		return "-" + f.Name
	}
	return "--" + f.Name
}

// spelling is the flag and its placeholder, such as "--dir D".
func (f Flag) spelling() string {
	s := f.dashed()
	if f.Arg != "" {
		s += " " + f.Arg
	}
	return s
}

// synopsis is the flag as a usage line shows it, such as "[--dir D]".
func (f Flag) synopsis() string {
	s := "[" + f.spelling() + "]"
	if f.Repeat {
		s += "..."
	}
	return s
}

// Command is one starboard command. A command with Subcommands is a group,
// such as skills: it runs only as one of them ("skills install"), and has
// no flags or arguments of its own. Groups do not nest. A Hidden command
// runs but is left out of the usage.
type Command struct {
	Name        string
	Args        string // the positional arguments as the usage shows them; empty for none
	Summary     string
	Flags       []Flag
	Subcommands []Command
	Hidden      bool
}

// Synopsis is the command as its usage line shows it after
// "starboard [--dir D] ", such as "lint [--json] [--fix] [--strict]".
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
		Summary: "Write a new project: starboard.yaml, docs/flows and .gitattributes lines.",
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
			{Name: "fix", Summary: "first format the sources and regenerate <content>/generated, listing each file"},
			{Name: "strict", Summary: "exit 1 on warnings as well as errors"},
		},
	},
	{
		Name:    "rules",
		Summary: "List every lint rule: its ID, kind, default severity and summary.",
		Flags:   []Flag{{Name: "json", Summary: "print the rules as a versioned JSON report, each with its documentation page"}},
	},
	{
		Name:    "generate",
		Summary: "Write <content>/generated: the app map, the screen catalog and the wireframes.",
		Flags: []Flag{{
			Name:    "check",
			Summary: "list what generate would write or remove, change nothing, and exit 1 if anything",
		}},
	},
	{
		Name:    "render",
		Args:    "<screen-id>",
		Summary: "Print one screen's wireframe SVG.",
		Flags: []Flag{
			{Name: "form-factor", Arg: "F", Summary: "draw form factor F (default: the screen's first)"},
			{Name: "o", Arg: "FILE", Summary: "write the SVG to FILE, an .svg path relative to the working directory or absolute, instead of stdout"},
		},
	},
	{
		Name:    "schema",
		Args:    "<config|screens>",
		Summary: "Print the JSON Schema for starboard.yaml (config) or screens.yaml (screens).",
	},
	{
		Name:    "mcp",
		Summary: "Serve the project to coding agents over MCP on stdin and stdout.",
		Flags:   []Flag{{Name: "read-only", Summary: "leave out the tools that write files"}},
	},
	{
		Name:    "skills",
		Summary: "Install Starboard's agent skills and print hook and MCP configuration.",
		Subcommands: []Command{
			{
				Name:    "install",
				Summary: "Install the skills for each agent the project uses, or each --agent.",
				Flags: []Flag{
					{
						Name: "agent", Arg: "A", Repeat: true,
						Summary: "install for agent A: claude-code, cursor, copilot, codex, gemini or aider",
					},
					{Name: "dry-run", Summary: "list what install would write or stage, and change nothing"},
				},
			},
			{Name: "list", Summary: "List the skills this release carries."},
			{
				Name:    "hooks",
				Args:    "<agent|pre-commit>",
				Summary: "Print configuration that runs fmt and lint after edits; edits nothing.",
			},
			{
				Name:    "mcp",
				Args:    "<agent>",
				Summary: "Print MCP client configuration that starts starboard mcp; edits nothing.",
				Flags:   []Flag{{Name: "read-only", Summary: "start the server with --read-only"}},
			},
		},
	},
	{
		Name:    "version",
		Summary: "Print starboard's version.",
	},
	{
		Name:    "hook",
		Summary: "Run an agent hook.",
		Hidden:  true,
		Subcommands: []Command{{
			Name:    "claude-code",
			Summary: "Check the file a Claude Code edit names on stdin; exit 2 with the findings.",
		}},
	},
}

// handlers run each command by name.
var handlers = map[string]func(*invocation) int{
	"init":     runInit,
	"fmt":      runFmt,
	"lint":     runLint,
	"rules":    runRules,
	"generate": runGenerate,
	"render":   runRender,
	"schema":   runSchema,
	"mcp":      runMCP,
	"version":  runVersion,

	"skills install":   runSkillsInstall,
	"skills list":      runSkillsList,
	"skills hooks":     runSkillsHooks,
	"skills mcp":       runSkillsMCP,
	"hook claude-code": runHookClaudeCode,
}

// invocation is one parsed command line.
type invocation struct {
	cmd            Command
	dir            string
	args           []string
	bools          map[string]*bool
	lists          map[string]*[]string
	stdin          io.Reader
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
// returns the exit status. Only mcp and the hidden hook commands read
// stdin. If
// writing to stdout fails, the command's output is incomplete, so Run
// reports the error and returns 2.
func Run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	out := &stickyWriter{w: stdout}
	code := dispatch(args, stdin, out, stderr)
	if out.err != nil {
		_, _ = fmt.Fprintf(stderr, "starboard: writing output: %v\n", out.err)
		return ExitUsage
	}
	return code
}

func dispatch(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
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
	cmd := Commands[i]
	if len(cmd.Subcommands) > 0 {
		var code int
		if cmd, code = subcommand(cmd, rest[1:], stdout, stderr); cmd.Name == "" {
			return code
		}
		rest = rest[1:]
	}
	inv := &invocation{
		cmd: cmd, dir: *dir, stdin: stdin, stdout: stdout, stderr: stderr,
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
	// Flags may come after the arguments: parse, take one argument, and
	// parse what follows it, until the arguments run out or a "--" ends
	// the flags.
	for args := rest[1:]; ; {
		if err := fs.Parse(args); err != nil {
			if errors.Is(err, flag.ErrHelp) {
				commandUsage(stdout, inv.cmd)
				return ExitOK
			}
			return inv.usageError("%v", err)
		}
		left := fs.Args()
		if n := len(args) - len(left); n > 0 && args[n-1] == "--" {
			inv.args = append(inv.args, left...)
			break
		}
		if len(left) == 0 {
			break
		}
		inv.args = append(inv.args, left[0])
		args = left[1:]
	}
	for _, f := range inv.cmd.Flags {
		if f.Arg != "" && !f.Repeat && len(*inv.lists[f.Name]) > 1 {
			return inv.usageError("%s given more than once", f.dashed())
		}
	}
	return handlers[inv.cmd.Name](inv)
}

// subcommand resolves the group cmd's subcommand from args, the words after
// the group's name, and returns it named in full ("skills install"). When
// there is none to run it prints the group's usage, and returns a Command
// with no name and the exit status: 0 for help, 2 for a missing or unknown
// subcommand.
func subcommand(cmd Command, args []string, stdout, stderr io.Writer) (Command, int) {
	names := make([]string, len(cmd.Subcommands))
	for i, s := range cmd.Subcommands {
		names[i] = s.Name
	}
	if len(args) > 0 && slices.Contains([]string{"help", "-h", "-help", "--help"}, args[0]) {
		groupUsage(stdout, cmd)
		return Command{}, ExitOK
	}
	problem := "missing subcommand"
	if len(args) > 0 {
		if i := slices.Index(names, args[0]); i >= 0 {
			sub := cmd.Subcommands[i]
			sub.Name = cmd.Name + " " + sub.Name
			return sub, ExitOK
		}
		problem = "unknown subcommand " + args[0]
	}
	_, _ = fmt.Fprintf(stderr, "starboard %s: %s; use %s\n", cmd.Name, problem, orList(names))
	groupUsage(stderr, cmd)
	return Command{}, ExitUsage
}

// groupUsage writes a group's usage line and its subcommands.
func groupUsage(w io.Writer, cmd Command) {
	var b strings.Builder
	_, _ = fmt.Fprintf(&b, "usage: starboard [--dir D] %s <subcommand>\n\nSubcommands:\n", cmd.Name)
	tw := tabwriter.NewWriter(&b, 0, 0, 2, ' ', 0)
	for _, s := range cmd.Subcommands {
		_, _ = fmt.Fprintf(tw, "  %s\t%s\n", s.Synopsis(), s.Summary)
	}
	_ = tw.Flush()
	_, _ = io.WriteString(w, b.String())
}

// usage writes the full usage.
func usage(w io.Writer) {
	var b strings.Builder
	b.WriteString("Usage: starboard [--dir D] <command> [flags]\n\nCommands:\n")
	tw := tabwriter.NewWriter(&b, 0, 0, 2, ' ', 0)
	for _, c := range Commands {
		if c.Hidden {
			continue
		}
		if len(c.Subcommands) == 0 {
			_, _ = fmt.Fprintf(tw, "  %s\t%s\n", c.Synopsis(), c.Summary)
		}
		for _, s := range c.Subcommands {
			_, _ = fmt.Fprintf(tw, "  %s %s\t%s\n", c.Name, s.Synopsis(), s.Summary)
		}
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
		_, _ = fmt.Fprintf(tw, "  %s\t%s\n", f.spelling(), f.Summary)
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
	d, _, err := inv.root()
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

// root finds the project root from the directory, which must exist, and
// opens it. The caller closes the returned Dir.
func (inv *invocation) root() (*osfs.Dir, string, error) {
	start, err := osfs.Open(inv.dir)
	if err != nil {
		return nil, "", err
	}
	_ = start.Close()
	root, err := osfs.FindRoot(inv.dir)
	if err != nil {
		return nil, "", err
	}
	d, err := osfs.Open(root)
	if err != nil {
		return nil, "", err
	}
	return d, root, nil
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
	// The load's errors are reported, and fail the run, but every file that
	// can be formatted still is: formatting is per file.
	diag.WriteText(inv.stderr, errorsOnly(ds))
	changed, failed := format.Project(p)
	for _, name := range slices.Sorted(maps.Keys(changed)) {
		if !check {
			if err := d.WriteFile(name, changed[name]); err != nil {
				return inv.fail(err)
			}
		}
		_, _ = fmt.Fprintln(inv.stdout, name)
	}
	for _, name := range slices.Sorted(maps.Keys(failed)) {
		_, _ = fmt.Fprintf(inv.stderr, "cannot format %s: %v\n", name, failed[name])
	}
	if hasErrors(ds) || len(failed) > 0 || (check && len(changed) > 0) {
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
	strict, asJSON := *inv.bools["strict"], *inv.bools["json"]
	if *inv.bools["fix"] {
		// Refuse a project that did not load cleanly, as generate does.
		if p == nil || hasErrors(ds) {
			diag.WriteText(inv.stderr, errorsOnly(ds))
			return ExitFindings
		}
		var done []string
		p, ds, done, err = fix(d, p)
		if err != nil {
			return inv.fail(err)
		}
		list := inv.stdout
		if asJSON { // keep stdout one JSON document
			list = inv.stderr
		}
		for _, line := range done {
			_, _ = fmt.Fprintln(list, line)
		}
	}
	// Freshness is checked only against a project that loaded without
	// errors: a broken one would generate too little.
	var generated map[string][]byte
	if p != nil && !hasErrors(ds) {
		generated = generate.All(p)
	}
	res := lint.Run(p, ds, lint.Options{Strict: strict, Generated: generated})
	if asJSON {
		_ = diag.WriteJSON(inv.stdout, res.Diagnostics) // a write error is Run's to report
	} else {
		diag.WriteText(inv.stdout, res.Diagnostics)
		_, _ = fmt.Fprintln(inv.stdout, summary(res))
	}
	return lintExit(res, strict)
}

// fix applies lint's safe fixes to the project in d and reloads it. The
// sources are formatted and reloaded first, so that generation reads the
// formatted files; then the generated files are written and removed. It
// returns the reloaded project and its diagnostics, and one "wrote <path>"
// or "removed <path>" line per file, sorted by path.
func fix(d *osfs.Dir, p *project.Project) (*project.Project, []diag.Diagnostic, []string, error) {
	verbs := map[string]string{}
	write := func(files map[string][]byte) error {
		for _, name := range slices.Sorted(maps.Keys(files)) {
			if err := d.WriteFile(name, files[name]); err != nil {
				return err
			}
			verbs[name] = "wrote"
		}
		return nil
	}
	formatted, _ := format.Project(p) // what it cannot format, lint reports as not-formatted
	if err := write(formatted); err != nil {
		return nil, nil, nil, err
	}
	p, ds, err := project.Load(d)
	if err != nil {
		return nil, nil, nil, err
	}
	if p != nil && !hasErrors(ds) { // formatting never breaks a project, but never generate from one
		ch := lint.Fix(p)
		if err := write(ch.Write); err != nil {
			return nil, nil, nil, err
		}
		for _, name := range ch.Remove {
			if err := d.Remove(name); err != nil {
				return nil, nil, nil, err
			}
			verbs[name] = "removed"
		}
		if p, ds, err = project.Load(d); err != nil {
			return nil, nil, nil, err
		}
	}
	var lines []string
	for _, name := range slices.Sorted(maps.Keys(verbs)) {
		lines = append(lines, verbs[name]+" "+name)
	}
	return p, ds, lines, nil
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

func runGenerate(inv *invocation) int {
	if !inv.noArgs() {
		return ExitUsage
	}
	d, p, ds, err := inv.load()
	if err != nil {
		return inv.fail(err)
	}
	defer func() { _ = d.Close() }()
	// Refuse a project that did not load cleanly: generating from what was
	// read would remove the pages of everything that was not.
	if p == nil || hasErrors(ds) {
		diag.WriteText(inv.stderr, errorsOnly(ds))
		return ExitFindings
	}
	check := *inv.bools["check"]
	gen := generate.All(p)
	changes, err := generate.Diff(p, gen)
	if err != nil {
		return inv.fail(err)
	}
	for _, ch := range changes {
		remove := ch.Kind == generate.Extra
		var verb string
		switch {
		case check && remove:
			verb = "would remove"
		case check:
			verb = "would write"
		case remove:
			verb, err = "removed", d.Remove(ch.Path)
		default:
			verb, err = "wrote", d.WriteFile(ch.Path, gen[ch.Path])
		}
		if err != nil {
			return inv.fail(err)
		}
		_, _ = fmt.Fprintln(inv.stdout, verb, ch.Path)
	}
	if check && len(changes) > 0 {
		return ExitFindings
	}
	return ExitOK
}

// hasErrors reports whether any of ds is an error.
func hasErrors(ds []diag.Diagnostic) bool {
	return slices.ContainsFunc(ds, func(d diag.Diagnostic) bool { return d.Severity == diag.Error })
}

// errorsOnly is ds without the findings below error.
func errorsOnly(ds []diag.Diagnostic) []diag.Diagnostic {
	var out []diag.Diagnostic
	for _, d := range ds {
		if d.Severity == diag.Error {
			out = append(out, d)
		}
	}
	return out
}

// value is the value of the flag name, or "" when it was not given.
func (inv *invocation) value(name string) string {
	if v := *inv.lists[name]; len(v) > 0 {
		return v[len(v)-1]
	}
	return ""
}

// renderError reports a render argument that names nothing usable.
func (inv *invocation) renderError(format string, args ...any) int {
	_, _ = fmt.Fprintf(inv.stderr, "starboard render: %s\n", fmt.Sprintf(format, args...))
	return ExitUsage
}

func runRender(inv *invocation) int {
	if len(inv.args) != 1 {
		return inv.usageError("render takes one screen ID")
	}
	// -o is a path the person typed, so it is theirs to place anywhere; the
	// .svg suffix keeps a slip from overwriting starboard.yaml or a source.
	if out := inv.value("o"); out != "" && !strings.HasSuffix(strings.ToLower(out), ".svg") {
		return inv.renderError("-o must name an .svg file")
	}
	d, p, ds, err := inv.load()
	if err != nil {
		return inv.fail(err)
	}
	defer func() { _ = d.Close() }()
	if p == nil {
		diag.WriteText(inv.stderr, ds)
		return ExitFindings
	}
	id := inv.args[0]
	s, ok := p.Registry.Screens[id]
	if !ok {
		return inv.renderError("unknown screen %s", id)
	}
	ff := inv.value("form-factor")
	if ff == "" {
		ffs := generate.FormFactors(p, s)
		if len(ffs) == 0 {
			return inv.renderError("%s has no form factor; pass --form-factor", id)
		}
		ff = ffs[0]
	}
	size, ok := p.Config.FormFactors[ff]
	if !ok {
		names := slices.Sorted(maps.Keys(p.Config.FormFactors))
		return inv.renderError("unknown form factor %s; use %s", ff, orList(names))
	}
	svg := render.Wireframe(s, ff, size)
	out := inv.value("o")
	if out == "" {
		_, _ = inv.stdout.Write(svg)
		return ExitOK
	}
	if err := osfs.WriteFileAt(out, svg); err != nil {
		return inv.fail(err)
	}
	_, _ = fmt.Fprintln(inv.stdout, "wrote", out)
	return ExitOK
}

// orList joins names as "a, b or c".
func orList(names []string) string {
	if len(names) < 2 {
		return strings.Join(names, "")
	}
	return strings.Join(names[:len(names)-1], ", ") + " or " + names[len(names)-1]
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

// runRules lists every lint rule, sorted by ID, as a table or, with
// --json, as {"version":1,"rules":[…]}. It needs no project.
func runRules(inv *invocation) int {
	if !inv.noArgs() {
		return ExitUsage
	}
	if *inv.bools["json"] {
		_ = lint.WriteRulesJSON(inv.stdout) // a write error is Run's to report
		return ExitOK
	}
	rules := lint.Rules()
	tw := tabwriter.NewWriter(inv.stdout, 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintln(tw, "RULE\tKIND\tDEFAULT\tSUMMARY")
	for _, r := range rules {
		_, _ = fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", r.ID, r.Kind(), r.Default, r.Summary)
	}
	_ = tw.Flush()
	return ExitOK
}

func runVersion(inv *invocation) int {
	if !inv.noArgs() {
		return ExitUsage
	}
	_, _ = fmt.Fprintf(inv.stdout, "starboard %s\n", version.String())
	return ExitOK
}

func runSkillsList(inv *invocation) int {
	if !inv.noArgs() {
		return ExitUsage
	}
	tw := tabwriter.NewWriter(inv.stdout, 0, 0, 2, ' ', 0)
	for _, s := range skillsfs.All() {
		_, _ = fmt.Fprintf(tw, "%s\t%s\n", s.Name, s.Description)
	}
	_ = tw.Flush()
	return ExitOK
}

func runSkillsHooks(inv *invocation) int {
	if len(inv.args) != 1 {
		return inv.usageError("skills hooks takes one argument")
	}
	text, err := skills.Hooks(inv.args[0])
	if err != nil {
		return inv.usageError("%v", err)
	}
	_, _ = io.WriteString(inv.stdout, text)
	_, _ = fmt.Fprintln(inv.stderr, skills.HookNote(inv.args[0]))
	return ExitOK
}

// runMCP serves the project over MCP until stdin ends. The protocol owns
// stdout; stderr gets one line naming the project, then one per tool call.
func runMCP(inv *invocation) int {
	if !inv.noArgs() {
		return ExitUsage
	}
	d, root, err := inv.root()
	if err != nil {
		return inv.fail(err)
	}
	defer func() { _ = d.Close() }()
	readOnly := *inv.bools["read-only"]
	mode := ""
	if readOnly {
		mode = " (read-only)"
	}
	_, _ = fmt.Fprintf(inv.stderr, "starboard mcp: serving %s%s\n", root, mode)
	if err := mcp.Serve(inv.stdin, inv.stdout, inv.stderr, d, mcp.Options{ReadOnly: readOnly, Version: version.String()}); err != nil {
		return inv.fail(err)
	}
	return ExitOK
}

func runSkillsMCP(inv *invocation) int {
	if len(inv.args) != 1 {
		return inv.usageError("skills mcp takes one argument")
	}
	text, err := skills.MCPConfig(inv.args[0], *inv.bools["read-only"])
	if err != nil {
		return inv.usageError("%v", err)
	}
	_, _ = io.WriteString(inv.stdout, text)
	_, _ = fmt.Fprintln(inv.stderr, skills.MCPNote(inv.args[0]))
	return ExitOK
}

func runSkillsInstall(inv *invocation) int {
	if !inv.noArgs() {
		return ExitUsage
	}
	var agents []skills.Agent
	for _, name := range *inv.lists["agent"] {
		a, err := skills.ParseAgent(name)
		if err != nil {
			return inv.usageError("%v", err)
		}
		agents = append(agents, a)
	}
	d, _, err := inv.root()
	if err != nil {
		return inv.fail(err)
	}
	defer func() { _ = d.Close() }()
	if len(agents) == 0 {
		agents = skills.Detect(d)
		if len(agents) == 0 {
			return inv.fail(errors.New("no agents detected: pass --agent"))
		}
		names := make([]string, len(agents))
		for i, a := range agents {
			names[i] = string(a)
		}
		_, _ = fmt.Fprintf(inv.stdout, "agents: %s (detected)\n", strings.Join(names, ", "))
	}
	dry := *inv.bools["dry-run"]
	res, err := skills.Install(d, agents, skillsfs.All(), dry)
	if err != nil {
		return inv.fail(err)
	}
	wrote, staged := "wrote", "staged"
	if dry {
		wrote, staged = "would write", "would stage"
	}
	for _, p := range res.Written {
		_, _ = fmt.Fprintln(inv.stdout, wrote, p)
	}
	for _, p := range res.Staged {
		_, _ = fmt.Fprintf(inv.stdout, "%s %s as %s/%s\n", staged, p, skills.PendingDir, p)
	}
	removed := "removed"
	if dry {
		removed = "would remove"
	}
	for _, p := range res.Removed {
		_, _ = fmt.Fprintf(inv.stdout, "%s %s (no longer shipped)\n", removed, p)
	}
	for _, p := range res.Retired {
		_, _ = fmt.Fprintf(inv.stdout, "no longer shipped: %s (edited; delete it yourself)\n", p)
	}
	line := fmt.Sprintf("%d written, %d unchanged, %d staged", len(res.Written), len(res.Unchanged), len(res.Staged))
	if n := len(res.Removed); n > 0 {
		line += fmt.Sprintf(", %d removed", n)
	}
	if dry {
		line += " (dry run)"
	}
	_, _ = fmt.Fprintln(inv.stdout, line)
	if n := len(res.Staged); n > 0 {
		subject := "1 file was"
		if n > 1 {
			subject = fmt.Sprintf("%d files were", n)
		}
		_, _ = fmt.Fprintf(inv.stderr, "warning: %s edited or not installed by Starboard, so it was kept; "+
			"merge its new version from %s/ by hand\n", subject, skills.PendingDir)
	}
	return ExitOK
}

// hookInput is the part of Claude Code's PostToolUse input the hook reads.
type hookInput struct {
	Cwd       string `json:"cwd"`
	ToolInput struct {
		FilePath string `json:"file_path"`
	} `json:"tool_input"`
}

// runHookClaudeCode checks the file a Claude Code edit named. It exits 0,
// quietly, unless the file is part of the project's reference
// (starboard.yaml, the registry, a flow file, a vocabulary file or a
// generated page); then it runs fmt and lint --json, and on a failure
// writes what they reported to stderr and
// exits 2, which Claude Code feeds back to the model. The project is the
// one holding the edited file, else the one holding the input's cwd (or
// --dir), against which a relative path is resolved. Input it cannot
// decode is noted on stderr and passed; no file or no project is not the
// hook's business: exit 0.
func runHookClaudeCode(inv *invocation) int {
	if !inv.noArgs() {
		return ExitUsage
	}
	var in hookInput
	if err := json.NewDecoder(inv.stdin).Decode(&in); err != nil {
		_, _ = fmt.Fprintf(inv.stderr, "starboard hook: cannot read the hook input (%v); not checked\n", err)
		return ExitOK
	}
	if in.ToolInput.FilePath == "" {
		return ExitOK
	}
	cwd := inv.dir
	if in.Cwd != "" {
		cwd = in.Cwd
	}
	root, rel, ok := osfs.ProjectFile(cwd, in.ToolInput.FilePath)
	if !ok {
		return ExitOK
	}
	d, err := osfs.Open(root)
	if err != nil {
		return ExitOK
	}
	p, _, _ := project.Load(d)
	_ = d.Close()
	if !isReference(rel, p) {
		return ExitOK
	}
	var out, errOut bytes.Buffer
	if inv.then(runFmt, root, &out, &errOut, map[string]bool{"check": false}) != ExitOK {
		_, _ = fmt.Fprintf(inv.stderr, "starboard fmt reported problems after this edit; fix them:\n%s", errOut.String())
		return ExitUsage
	}
	out.Reset()
	errOut.Reset()
	if inv.then(runLint, root, &out, &errOut, map[string]bool{"json": true, "fix": false, "strict": false}) != ExitOK {
		_, _ = fmt.Fprintf(inv.stderr, "starboard lint found problems after this edit; fix them:\n%s%s", out.String(), errOut.String())
		return ExitUsage
	}
	return ExitOK
}

// then runs another command's handler in dir, with the boolean flags
// bools, writing to stdout and stderr. (Calling dispatch here would make
// handlers refer to itself.)
func (inv *invocation) then(run func(*invocation) int, dir string, stdout, stderr io.Writer, bools map[string]bool) int {
	next := &invocation{dir: dir, stdout: stdout, stderr: stderr, bools: map[string]*bool{}}
	for name, v := range bools {
		next.bools[name] = &v
	}
	return run(next)
}

// isReference reports whether the project-relative path rel is one of the
// reference's files: starboard.yaml always, and, when the project loaded,
// its registry, a flow file, a vocabulary file, or a file under
// <content>/generated/ (so lint's generated-stale catches a hand-edit).
func isReference(rel string, p *project.Project) bool {
	if rel == config.FileName {
		return true
	}
	if p == nil {
		return false
	}
	content := path.Clean(p.Config.Content)
	if rel == path.Join(content, registry.FileName) ||
		(path.Dir(rel) == path.Join(content, "flows") && strings.HasSuffix(rel, ".md")) ||
		strings.HasPrefix(rel, path.Join(content, "generated")+"/") {
		return true
	}
	for _, v := range p.Config.Vocabularies {
		if path.Clean(v.File) == rel {
			return true
		}
	}
	return false
}
