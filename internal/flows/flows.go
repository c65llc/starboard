// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package flows parses a user-flow document: Markdown with YAML front matter,
// @screen.id references in the text and in a Mermaid diagram, and numbered
// steps under a Steps heading. It reads the Markdown line by line; it is not
// a Markdown parser, only as much of one as the flow format needs.
package flows

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"go.yaml.in/yaml/v3"

	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/registry"
	"github.com/c65llc/starboard/internal/yamlx"
)

// file names the flow in diagnostics until the caller, which knows the
// project-relative path, rewrites it.
const file = "flow.md"

// invalid is the rule every front matter problem is reported under, except
// anchors and aliases, which keep yaml-alias-not-allowed.
const invalid = "flow-frontmatter-invalid"

// Ref is one @screen.id or @screen.id#region reference. Line is 1-based in
// the whole file. InDiagram is true inside a ```mermaid block.
type Ref struct {
	Screen, Region string
	Line           int
	InDiagram      bool
}

// Step is one item of the list under the Steps heading. Number is its
// 1-based position, whatever number the Markdown gives it. Text is the item's
// own text, wrapped lines joined with a space. Ref is the first reference in
// Text, or nil. Branches are the item's nested bullets as raw text.
type Step struct {
	Number   int
	Text     string
	Ref      *Ref
	Branches []string
	Line     int
}

// Flow is a parsed flow document. Refs holds every reference in document
// order. FrontMatterLines are the lines of the opening and closing ---, or
// zero when the front matter is missing or never closed.
type Flow struct {
	ID, Title, Status, Entry string
	Actors, Platforms        []string
	Refs                     []Ref
	Steps                    []Step
	HasDiagram               bool
	FrontMatterLines         [2]int
}

// Screens is every screen f names: its entry, then each reference's screen
// (prose, steps, branches and diagram alike), each once, in document order.
// It is what "used in flows" means, for the CLI's catalog and for the app.
func (f *Flow) Screens() []string {
	out := []string{}
	add := func(id string) {
		if id != "" && !slices.Contains(out, id) {
			out = append(out, id)
		}
	}
	add(f.Entry)
	for _, r := range f.Refs {
		add(r.Screen)
	}
	return out
}

// RefPattern finds references. The leading group stops e-mail addresses
// (and @ or . run-ons) from matching; submatch 2 is the screen ID and
// submatch 3 the region.
var RefPattern = regexp.MustCompile(`(^|[^\w@.])@([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)(?:#([a-z][a-z0-9-]*))?`)

var (
	headingRE = regexp.MustCompile(`^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$`)
	orderedRE = regexp.MustCompile(`^ {0,3}\d+[.)](?:[ \t]+(.*))?$`)
	bulletRE  = regexp.MustCompile(`^[ \t]*[-*+][ \t]+(.*)$`)
	fenceRE   = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})[ \t]*(\\S*)")
	lineNumRE = regexp.MustCompile(`line (\d+)`)
)

// BOM is the UTF-8 byte order mark, which Parse ignores at the start.
const BOM = "\uFEFF"

// Parse reads a flow document. It always returns a Flow, filled in as far as
// the document allows. References and steps are scanned even when the front
// matter is missing or broken, except when it is opened and never closed:
// then the whole file is taken as front matter and there is no body. CRLF
// line endings are read as LF, and a leading byte order mark is ignored.
func Parse(data []byte) (*Flow, []diag.Diagnostic) {
	src := strings.TrimPrefix(strings.ReplaceAll(string(data), "\r\n", "\n"), BOM)
	lines := strings.Split(src, "\n")
	f := &Flow{}
	var ds []diag.Diagnostic

	body := 0 // index of the first body line
	switch end := closingDelimiter(lines); {
	case !IsDelimiter(lines[0]):
		ds = append(ds, invalidAt(1, "", "%s must start with front matter between --- lines", file))
	case end < 0:
		ds = append(ds, invalidAt(1, "", "front matter opened on line 1 is never closed with ---"))
		body = len(lines)
	default:
		f.FrontMatterLines = [2]int{1, end + 1}
		ds = append(ds, f.frontMatter(strings.Join(lines[1:end], "\n"))...)
		body = end + 1
	}

	b := bodyScanner{f: f}
	for i := body; i < len(lines); i++ {
		b.line(lines[i], i+1)
	}
	b.endStep()
	diag.Sort(ds)
	return f, ds
}

// IsDelimiter reports whether line is a front matter delimiter, ---.
func IsDelimiter(line string) bool {
	return strings.TrimRight(line, " \t") == "---"
}

// closingDelimiter returns the index of the --- that closes the front
// matter, or -1.
func closingDelimiter(lines []string) int {
	for i := 1; i < len(lines); i++ {
		if IsDelimiter(lines[i]) {
			return i
		}
	}
	return -1
}

func invalidAt(line int, path, format string, args ...any) diag.Diagnostic {
	return diag.Diagnostic{
		Rule: invalid, Severity: diag.Error, File: file, Path: path, Line: line,
		Message: fmt.Sprintf(format, args...),
	}
}

var required = []string{"id", "title", "status", "entry"}

// Keys are the front matter keys a flow may set, in the order a new flow
// writes them.
var Keys = []string{"id", "title", "status", "entry", "actors", "platforms"}

// IDPattern is the form of a new flow's ID, which is also its file's stem.
var IDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

var allowed = func() map[string]bool {
	m := map[string]bool{}
	for _, k := range Keys {
		m[k] = true
	}
	return m
}()

// frontMatter fills f from the YAML between the delimiters. The YAML starts
// on line 2, so every line it reports is shifted by one.
func (f *Flow) frontMatter(text string) []diag.Diagnostic {
	root, ds := yamlx.Decode([]byte(text), file)
	if root == nil {
		for i := range ds {
			if ds[i].Rule == "yaml-syntax" {
				ds[i].Rule = invalid
			}
		}
		return shift(ds)
	}
	p := yamlx.Parser{File: file, Invalid: invalid}
	if !yamlx.IsNull(root) && root.Kind != yaml.MappingNode {
		p.Invalidf(root, "", "front matter must be a mapping")
		return shift(p.Diags)
	}
	entries, _ := p.Mapping(root, "", allowed)
	seen := map[string]bool{}
	for _, e := range entries {
		seen[e.Key] = true
		switch e.Key {
		case "actors":
			f.Actors = yamlx.Values(p.StrList(e.V, e.Field))
		case "platforms":
			f.Platforms = yamlx.Values(p.StrList(e.V, e.Field))
		default:
			f.scalar(&p, e)
		}
	}
	ds = shift(p.Diags)
	for _, k := range required {
		if !seen[k] {
			ds = append(ds, invalidAt(1, k, "front matter must set %s", k))
		}
	}
	return ds
}

// scalar sets one of the four required string keys.
func (f *Flow) scalar(p *yamlx.Parser, e yamlx.Entry) {
	s, ok := p.Str(e.V, e.Field)
	if !ok {
		return
	}
	switch e.Key {
	case "id":
		f.ID = s
	case "title":
		f.Title = s
	case "status":
		if s != "shipped" && s != "proposed" {
			p.Invalidf(e.V, e.Field, "status must be shipped or proposed, not %s", s)
			return
		}
		f.Status = s
	case "entry":
		if !registry.IDPattern.MatchString(s) {
			p.Invalidf(e.V, e.Field, "entry must be a screen ID such as trip.timeline, not %s", s)
			return
		}
		f.Entry = s
	}
}

// shift moves front matter diagnostics from YAML lines to file lines, in
// the Line field and in any "line N" the message quotes.
func shift(ds []diag.Diagnostic) []diag.Diagnostic {
	for i := range ds {
		if ds[i].Line > 0 {
			ds[i].Line++
		} else {
			ds[i].Line = 1
		}
		ds[i].Message = lineNumRE.ReplaceAllStringFunc(ds[i].Message, func(m string) string {
			n, _ := strconv.Atoi(lineNumRE.FindStringSubmatch(m)[1])
			return "line " + strconv.Itoa(n+1)
		})
	}
	return ds
}

// The states of the Steps scan.
const (
	stepsBefore   = iota // no Steps heading yet
	stepsAwaiting        // under the heading, before its first ordered list
	stepsIn              // inside the list
	stepsDone            // the list has ended, or the heading had none
)

// bodyScanner walks the body one line at a time, tracking fences, collecting
// references and building the steps.
type bodyScanner struct {
	f *Flow

	fence   string // the open fence's run of ` or ~, or ""
	diagram bool   // the open fence is ```mermaid

	steps     int   // stepsBefore … stepsDone
	cur       *Step // the step being built
	inBranch  bool  // the last line added went to a branch
	afterGap  bool  // a blank line came since the last list line
	stepIndex int   // number of steps so far
}

func (b *bodyScanner) line(text string, n int) {
	if b.fence != "" {
		if IsFenceClose(text, b.fence) {
			b.fence, b.diagram = "", false
			return
		}
		if b.diagram {
			b.collect(text, n, true)
		}
		return
	}
	if fence, info, ok := OpenFence(text); ok {
		b.fence = fence
		b.diagram = strings.EqualFold(info, "mermaid")
		b.f.HasDiagram = b.f.HasDiagram || b.diagram
		if b.steps == stepsIn && !indented(text) {
			b.endList()
		}
		return
	}
	refs := b.collect(text, n, false)
	b.step(text, n, refs)
}

// OpenFence reports whether text opens a fenced code block, and returns the
// fence's run of ` or ~ and the first word of its info string. A backtick
// fence whose info string holds a backtick is not a fence (CommonMark).
func OpenFence(text string) (fence, info string, ok bool) {
	m := fenceRE.FindStringSubmatch(text)
	if m == nil {
		return "", "", false
	}
	if _, rest, _ := strings.Cut(text, m[1]); m[1][0] == '`' && strings.Contains(rest, "`") {
		return "", "", false
	}
	return m[1], m[2], true
}

// IsFenceClose reports whether text closes the block fence opened.
func IsFenceClose(text, fence string) bool {
	t := strings.TrimRight(strings.TrimLeft(text, " "), " \t")
	return len(text)-len(strings.TrimLeft(text, " ")) <= 3 &&
		len(t) >= len(fence) && strings.Trim(t, fence[:1]) == ""
}

func indented(text string) bool {
	return strings.HasPrefix(text, " ") || strings.HasPrefix(text, "\t")
}

// collect appends the references on one line to the flow and returns them.
func (b *bodyScanner) collect(text string, n int, inDiagram bool) []Ref {
	var out []Ref
	for _, m := range RefPattern.FindAllStringSubmatch(text, -1) {
		out = append(out, Ref{Screen: m[2], Region: m[3], Line: n, InDiagram: inDiagram})
	}
	b.f.Refs = append(b.f.Refs, out...)
	return out
}

// step feeds one non-fence line to the Steps scan.
func (b *bodyScanner) step(text string, n int, refs []Ref) {
	heading := headingRE.FindStringSubmatch(text)
	switch b.steps {
	case stepsBefore:
		if heading != nil && strings.EqualFold(heading[1], "steps") {
			b.steps = stepsAwaiting
		}
	case stepsAwaiting:
		if heading != nil {
			b.steps = stepsDone
		} else if m := orderedRE.FindStringSubmatch(text); m != nil {
			b.steps = stepsIn
			b.start(m[1], n, refs)
		}
	case stepsIn:
		b.listLine(text, n, refs, heading != nil)
	}
}

func (b *bodyScanner) listLine(text string, n int, refs []Ref, heading bool) {
	if strings.TrimSpace(text) == "" {
		b.afterGap = true
		return
	}
	if heading {
		b.endList()
		return
	}
	if m := orderedRE.FindStringSubmatch(text); m != nil {
		b.endStep()
		b.start(m[1], n, refs)
		return
	}
	if indented(text) {
		b.afterGap = false
		if m := bulletRE.FindStringSubmatch(text); m != nil {
			b.cur.Branches = append(b.cur.Branches, strings.TrimSpace(m[1]))
			b.inBranch = true
			return
		}
		b.cont(text, refs)
		return
	}
	// An unindented line that is not an ordered item: after a blank line, or
	// as another kind of list, it ends the steps; otherwise it is a lazy
	// continuation of the text above.
	if b.afterGap || bulletRE.MatchString(text) {
		b.endList()
		return
	}
	b.cont(text, refs)
}

// cont joins a wrapped line onto the current branch or step.
func (b *bodyScanner) cont(text string, refs []Ref) {
	t := strings.TrimSpace(text)
	if b.inBranch {
		last := len(b.cur.Branches) - 1
		b.cur.Branches[last] += " " + t
		return
	}
	b.cur.Text += " " + t
	b.setRef(refs)
}

func (b *bodyScanner) start(text string, n int, refs []Ref) {
	b.stepIndex++
	b.cur = &Step{Number: b.stepIndex, Text: strings.TrimSpace(text), Line: n}
	b.inBranch, b.afterGap = false, false
	b.setRef(refs)
}

func (b *bodyScanner) setRef(refs []Ref) {
	if b.cur.Ref == nil && len(refs) > 0 {
		r := refs[0]
		b.cur.Ref = &r
	}
}

func (b *bodyScanner) endStep() {
	if b.cur != nil {
		b.f.Steps = append(b.f.Steps, *b.cur)
		b.cur = nil
	}
}

func (b *bodyScanner) endList() {
	b.endStep()
	b.steps = stepsDone
}
