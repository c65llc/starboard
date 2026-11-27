// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/rogpeppe/go-internal/testscript"

	"github.com/c65llc/starboard/internal/flows"
)

// The documentation's command-line examples are checked by verifydocs,
// which docs_examples.txtar runs over docs/. A fenced block may be preceded
// (blank lines aside) by one of these markers:
//
//   - <!-- verified: SOURCE [in DIR] [mkdir DIR]... [exit N] --> before a
//     ```bash block: every line of the block, less blank lines, # comments
//     and trailing " # comments", is one starboard command, or several
//     joined by " && ". They run in a working directory made from SOURCE:
//     "empty", or examples/<name> copied from the repository (into DIR, when
//     "in DIR" is given; each "mkdir DIR" makes a directory first). Each
//     command must exit 0, except the block's last, which must exit N
//     (default 0). No shell runs them: quotes, pipes, redirection and
//     variables are refused.
//   - <!-- output --> before a block that follows a verified block on the
//     same page: the verified block's stdout must be exactly its content.
//   - <!-- verified-file: SOURCE PATH --> before any block: its content is
//     written to PATH in SOURCE's working directory.
//   - <!-- verified-contents: SOURCE PATH --> before any block: PATH in
//     SOURCE's working directory must hold exactly its content, then.
//   - <!-- verified-remove: SOURCE PATH -->, on its own: PATH is removed
//     from SOURCE's working directory, as the page tells the reader to.
//
// One page's blocks with the same SOURCE (and "in DIR") share one working
// directory, in page order, so a page can init a project, write a file and
// lint it. Every other shell block's starboard command, and every yaml
// block's "args:" line taken as a starboard command line, must appear
// verbatim in some verified block: an unverified example is a copy of a
// verified one.

var (
	markerRE = regexp.MustCompile(`^\s*<!--\s*(verified|verified-file|verified-contents|verified-remove|output)(?::\s*(.*?))?\s*-->\s*$`)
	argsRE   = regexp.MustCompile(`^\s*(?:-\s+)?args:\s*(.+?)\s*$`)
	unsafeRE = regexp.MustCompile("[|<>;$'\"`*?(){}\\\\]")
)

// shellLangs are the fence languages read as shell.
var shellLangs = map[string]bool{"bash": true, "sh": true, "shell": true, "console": true}

// docBlock is one fenced block of a page and the marker before it.
type docBlock struct {
	file   string
	line   int // the opening fence's line
	lang   string
	marker string // the marker's name, such as "verified" or "output"; "" for none
	args   string
	lines  []string
	output *docBlock // for a verified block, the output block after it
}

// docsReport collects what verifydocs found.
type docsReport struct {
	problems         []string
	blocks, commands int
	files            int
}

func (r *docsReport) problemf(file string, line int, format string, args ...any) {
	r.problems = append(r.problems, fmt.Sprintf("%s:%d: %s", file, line, fmt.Sprintf(format, args...)))
}

// verifyDocs is the verifydocs command: "verifydocs ROOT DIR...". ROOT is
// the repository, where examples/ is; each DIR is searched for .md pages.
// It prints a summary to stdout; with !, it expects problems and prints
// them to stderr.
func verifyDocs(ts *testscript.TestScript, neg bool, args []string) {
	if len(args) < 2 {
		ts.Fatalf("usage: verifydocs ROOT DIR...")
	}
	root := ts.MkAbs(args[0])
	var pages []string
	for _, dir := range args[1:] {
		dir = ts.MkAbs(dir)
		ts.Check(filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err == nil && !d.IsDir() && strings.HasSuffix(path, ".md") {
				pages = append(pages, path)
			}
			return err
		}))
	}
	slices.Sort(pages)
	rep := &docsReport{}
	blocksByPage := make([][]*docBlock, len(pages))
	verified := map[string]bool{}
	for i, page := range pages {
		data, err := os.ReadFile(page) //nolint:gosec // G304: a documentation page the script names
		ts.Check(err)
		name := page // relative to the repository, else to $WORK
		for _, base := range []string{root, ts.Getenv("WORK")} {
			if rel, err := filepath.Rel(base, page); err == nil && !strings.HasPrefix(rel, "..") {
				name = filepath.ToSlash(rel)
				break
			}
		}
		blocksByPage[i] = parseDocBlocks(name, string(data), rep)
		for _, b := range blocksByPage[i] {
			if b.marker == "verified" {
				for _, c := range commandLines(b) {
					verified[c.text] = true
					for _, part := range c.parts {
						verified[part] = true
					}
				}
			}
		}
	}
	base, err := os.MkdirTemp(ts.Getenv("WORK"), "docs-examples-")
	ts.Check(err)
	r := newRunner(ts)
	// Pages share nothing, so they run in parallel; their problems are
	// merged in page order, so the report is the same on every run.
	reports := make([]docsReport, len(blocksByPage))
	var wg sync.WaitGroup
	sem := make(chan struct{}, runtime.GOMAXPROCS(0))
	for i, blocks := range blocksByPage {
		wg.Go(func() {
			sem <- struct{}{}
			defer func() { <-sem }()
			runPage(r, root, filepath.Join(base, strconv.Itoa(i)), blocks, &reports[i])
			checkCopies(blocks, verified, &reports[i])
		})
	}
	wg.Wait()
	for _, pr := range reports {
		rep.problems = append(rep.problems, pr.problems...)
		rep.blocks += pr.blocks
		rep.commands += pr.commands
		rep.files++
	}
	switch {
	case neg && len(rep.problems) == 0:
		ts.Fatalf("verifydocs found no problems")
	case neg:
		_, _ = fmt.Fprintln(ts.Stderr(), strings.Join(rep.problems, "\n"))
	case len(rep.problems) > 0:
		ts.Fatalf("%d problems:\n%s", len(rep.problems), strings.Join(rep.problems, "\n"))
	}
	_, _ = fmt.Fprintf(ts.Stdout(), "verified %d blocks, %d commands, in %d pages\n", rep.blocks, rep.commands, rep.files)
}

// parseDocBlocks finds a page's fenced blocks and their markers, and
// attaches each output block to the verified block before it.
func parseDocBlocks(file, src string, rep *docsReport) []*docBlock {
	lines := strings.Split(strings.ReplaceAll(src, "\r\n", "\n"), "\n")
	var blocks []*docBlock
	var lastVerified *docBlock
	marker, markerArgs, markerLine := "", "", 0
	for i := 0; i < len(lines); i++ {
		l := lines[i]
		if m := markerRE.FindStringSubmatch(l); m != nil {
			if m[1] == "verified-remove" { // stands alone: no block follows
				blocks = append(blocks, &docBlock{file: file, line: i + 1, marker: m[1], args: m[2]})
				continue
			}
			marker, markerArgs, markerLine = m[1], m[2], i+1
			continue
		}
		fence, info, ok := flows.OpenFence(l)
		if !ok {
			if strings.TrimSpace(l) != "" && marker != "" {
				rep.problemf(file, markerLine, "<!-- %s --> is not followed by a fenced block", marker)
				marker = ""
			}
			continue
		}
		indent := len(l) - len(strings.TrimLeft(l, " "))
		b := &docBlock{file: file, line: i + 1, lang: info, marker: marker, args: markerArgs}
		for i++; i < len(lines) && !flows.IsFenceClose(lines[i], fence); i++ {
			c := lines[i]
			if n := len(c) - len(strings.TrimLeft(c, " ")); n >= indent {
				c = c[indent:]
			} else {
				c = strings.TrimLeft(c, " ")
			}
			b.lines = append(b.lines, c)
		}
		switch b.marker {
		case "verified":
			if b.lang != "bash" {
				rep.problemf(file, b.line, "a verified block must be ```bash, not %q", b.lang)
			}
			lastVerified = b
		case "output":
			if lastVerified == nil || lastVerified.output != nil {
				rep.problemf(file, b.line, "<!-- output --> does not follow a verified block")
			} else {
				lastVerified.output = b
			}
		}
		blocks = append(blocks, b)
		marker = ""
	}
	if marker != "" {
		rep.problemf(file, markerLine, "<!-- %s --> is not followed by a fenced block", marker)
	}
	return blocks
}

// commandLine is one line of a shell block: its text, less comments, and
// the commands it joins with &&.
type commandLine struct {
	line  int
	text  string
	parts []string
}

// commandLines returns a shell block's command lines.
func commandLines(b *docBlock) []commandLine {
	var out []commandLine
	for i, l := range b.lines {
		l = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(l), "$ "))
		if l == "" || strings.HasPrefix(l, "#") {
			continue
		}
		if j := strings.Index(l, " #"); j >= 0 {
			l = strings.TrimSpace(l[:j])
		}
		var parts []string
		for p := range strings.SplitSeq(l, "&&") {
			parts = append(parts, strings.TrimSpace(p))
		}
		out = append(out, commandLine{line: b.line + 1 + i, text: l, parts: parts})
	}
	return out
}

// runner runs the starboard command that testscript puts on PATH, with
// the script's sandboxed home and temporary directories.
type runner struct {
	bin string
	env []string
}

func newRunner(ts *testscript.TestScript) runner {
	bin, err := exec.LookPath("starboard")
	ts.Check(err)
	env := os.Environ()
	for _, k := range []string{"HOME", "USERPROFILE", "TMPDIR", "TMP", "TEMP", "GORACE"} {
		if v := ts.Getenv(k); v != "" {
			env = append(env, k+"="+v)
		}
	}
	return runner{bin: bin, env: env}
}

// run runs starboard with args in dir, and returns its stdout, its stderr
// and its exit status.
func (r runner) run(dir string, args []string) (stdout, stderr string, code int, err error) {
	var out, errOut strings.Builder
	cmd := exec.Command(r.bin, args...) //nolint:gosec // G204: the documented command, run by the test
	cmd.Dir, cmd.Env, cmd.Stdout, cmd.Stderr = dir, r.env, &out, &errOut
	if err := cmd.Run(); err != nil {
		var ee *exec.ExitError
		if !errors.As(err, &ee) {
			return "", "", 0, err
		}
		code = ee.ExitCode()
	}
	return out.String(), errOut.String(), code, nil
}

// session is one working directory a page's verified blocks share.
type session struct{ dir string }

// runPage runs a page's verified blocks and writes its verified files.
func runPage(r runner, root, work string, blocks []*docBlock, rep *docsReport) {
	sessions := map[string]*session{}
	open := func(opts blockOptions) (*session, error) {
		key := opts.source + " in " + opts.in
		if s := sessions[key]; s != nil {
			return s, nil
		}
		dir := filepath.Join(work, strconv.Itoa(len(sessions)))
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return nil, err
		}
		for _, m := range opts.mkdirs {
			if err := os.MkdirAll(filepath.Join(dir, filepath.FromSlash(m)), 0o750); err != nil {
				return nil, err
			}
		}
		if opts.source != "empty" {
			if err := copyTree(filepath.Join(root, filepath.FromSlash(opts.source)), filepath.Join(dir, filepath.FromSlash(opts.in))); err != nil {
				return nil, err
			}
		}
		s := &session{dir: dir}
		sessions[key] = s
		return s, nil
	}
	for _, b := range blocks {
		switch b.marker {
		case "verified-file", "verified-contents", "verified-remove":
			fields := strings.Fields(b.args)
			if len(fields) != 2 {
				rep.problemf(b.file, b.line, "%s takes SOURCE PATH, not %q", b.marker, b.args)
				continue
			}
			opts, err := parseOptions(fields[0], root)
			if err != nil {
				rep.problemf(b.file, b.line, "%v", err)
				continue
			}
			s, err := open(opts)
			if err != nil {
				rep.problemf(b.file, b.line, "%v", err)
				continue
			}
			path := filepath.Join(s.dir, filepath.FromSlash(fields[1]))
			content := strings.Join(b.lines, "\n") + "\n"
			switch b.marker {
			case "verified-file":
				err := os.MkdirAll(filepath.Dir(path), 0o750)
				if err == nil {
					err = os.WriteFile(path, []byte(content), 0o600)
				}
				if err != nil {
					rep.problemf(b.file, b.line, "%v", err)
				}
			case "verified-contents":
				got, err := os.ReadFile(path) //nolint:gosec // G304: a file in the page's working directory
				if err != nil {
					rep.problemf(b.file, b.line, "cannot read %s: %v", fields[1], errors.Unwrap(err))
				} else if string(got) != content {
					rep.problemf(b.file, b.line, "%s differs from the block:\n--- got\n%s--- want\n%s", fields[1], got, content)
				}
			case "verified-remove":
				if err := os.Remove(path); err != nil {
					rep.problemf(b.file, b.line, "cannot remove %s: %v", fields[1], errors.Unwrap(err))
				}
			}
		case "verified":
			opts, err := parseOptions(b.args, root)
			if err != nil {
				rep.problemf(b.file, b.line, "%v", err)
				continue
			}
			s, err := open(opts)
			if err != nil {
				rep.problemf(b.file, b.line, "%v", err)
				continue
			}
			runBlock(r, s, b, opts, rep)
		}
	}
}

// blockOptions are a verified marker's words.
type blockOptions struct {
	source, in string
	mkdirs     []string
	exit       int
}

// parseOptions reads "SOURCE [in DIR] [mkdir DIR]... [exit N]".
func parseOptions(args, root string) (blockOptions, error) {
	fields := strings.Fields(args)
	if len(fields) == 0 {
		return blockOptions{}, errors.New("verified needs a SOURCE: empty or examples/<name>")
	}
	opts := blockOptions{source: fields[0]}
	if opts.source != "empty" {
		if !strings.HasPrefix(opts.source, "examples/") {
			return opts, fmt.Errorf("unknown SOURCE %q: use empty or examples/<name>", opts.source)
		}
		if info, err := os.Stat(filepath.Join(root, filepath.FromSlash(opts.source))); err != nil || !info.IsDir() {
			return opts, fmt.Errorf("SOURCE %s is not a directory in the repository", opts.source)
		}
	}
	for rest := fields[1:]; len(rest) > 0; rest = rest[2:] {
		if len(rest) < 2 {
			return opts, fmt.Errorf("%s needs a value", rest[0])
		}
		switch rest[0] {
		case "in":
			opts.in = rest[1]
		case "mkdir":
			opts.mkdirs = append(opts.mkdirs, rest[1])
		case "exit":
			n, err := strconv.Atoi(rest[1])
			if err != nil {
				return opts, fmt.Errorf("bad exit status %q", rest[1])
			}
			opts.exit = n
		default:
			return opts, fmt.Errorf("unknown option %q: use in, mkdir or exit", rest[0])
		}
	}
	return opts, nil
}

// runBlock runs one verified block's commands in its session.
func runBlock(r runner, s *session, b *docBlock, opts blockOptions, rep *docsReport) {
	rep.blocks++
	lines := commandLines(b)
	if len(lines) == 0 {
		rep.problemf(b.file, b.line, "a verified block has no commands")
		return
	}
	var stdout strings.Builder
	for li, cl := range lines {
		for pi, part := range cl.parts {
			if unsafeRE.MatchString(part) {
				rep.problemf(b.file, cl.line, "%q: only plain starboard commands can be verified", part)
				return
			}
			words := strings.Fields(part)
			if len(words) == 0 || words[0] != "starboard" {
				rep.problemf(b.file, cl.line, "%q is not a starboard command", part)
				return
			}
			rep.commands++
			want := 0
			if li == len(lines)-1 && pi == len(cl.parts)-1 {
				want = opts.exit
			}
			out, errOut, got, err := r.run(s.dir, words[1:])
			if err != nil {
				rep.problemf(b.file, cl.line, "%s: %v", part, err)
				return
			}
			stdout.WriteString(out)
			if got != want {
				rep.problemf(b.file, cl.line, "%s: exit status %d, want %d\nstdout:\n%sstderr:\n%s",
					part, got, want, out, errOut)
				return
			}
		}
	}
	if b.output != nil {
		want := strings.Join(b.output.lines, "\n") + "\n"
		if stdout.String() != want {
			rep.problemf(b.file, b.output.line, "the output block differs from the commands' stdout:\n--- got\n%s--- want\n%s", stdout.String(), want)
		}
	}
}

// checkCopies reports each unverified example of a starboard command that
// no verified block holds verbatim.
func checkCopies(blocks []*docBlock, verified map[string]bool, rep *docsReport) {
	for _, b := range blocks {
		switch {
		case b.marker != "":
			continue
		case shellLangs[b.lang]:
			for _, cl := range commandLines(b) {
				ok := verified[cl.text] || !slices.ContainsFunc(cl.parts, func(p string) bool {
					return isStarboard(p) && !verified[p]
				})
				if !ok {
					rep.problemf(b.file, cl.line, "%q is not in any verified block", cl.text)
				}
			}
		case b.lang == "yaml" || b.lang == "yml":
			for i, l := range b.lines {
				if m := argsRE.FindStringSubmatch(l); m != nil {
					cmd := "starboard " + strings.Trim(m[1], `"'`)
					if !verified[cmd] {
						rep.problemf(b.file, b.line+1+i, "args %q: %q is not in any verified block", m[1], cmd)
					}
				}
			}
		}
	}
}

// isStarboard reports whether a command line runs starboard.
func isStarboard(s string) bool {
	return s == "starboard" || strings.HasPrefix(s, "starboard ")
}

// copyTree copies the directory src to dst.
func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o750)
		}
		data, err := os.ReadFile(path) //nolint:gosec // G304: a file of an example project
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o600) //nolint:gosec // G703: target is inside the test's own work directory
	})
}
