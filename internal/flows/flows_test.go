// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package flows

import (
	"io/fs"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/diag"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := fs.ReadFile(os.DirFS("testdata"), name)
	require.NoError(t, err)
	return data
}

// fm is a valid front matter block, six lines long; a body starts on line 7.
const fm = "---\nid: f\ntitle: T\nstatus: shipped\nentry: a.b\n---\n"

func parseOK(t *testing.T, src string) *Flow {
	t.Helper()
	f, ds := Parse([]byte(src))
	require.Empty(t, ds)
	require.NotNil(t, f)
	return f
}

func rules(ds []diag.Diagnostic) []string {
	var out []string
	for _, d := range ds {
		out = append(out, d.Rule)
	}
	return out
}

func TestParseFlow(t *testing.T) {
	f, ds := Parse(fixture(t, "spec.md"))
	require.Empty(t, ds)
	assert.Equal(t, "add-activity", f.ID)
	assert.Equal(t, "Add an activity", f.Title)
	assert.Equal(t, "proposed", f.Status)
	assert.Equal(t, "trip.timeline", f.Entry)
	assert.Equal(t, []string{"traveler"}, f.Actors)
	assert.Equal(t, []string{"ios", "web"}, f.Platforms)
	assert.Equal(t, [2]int{1, 8}, f.FrontMatterLines)
	assert.True(t, f.HasDiagram)
	assert.Nil(t, f.Steps)
	// The spec's example: two placeholder references in the prose, then the
	// diagram's four (three nodes and one edge label naming a region).
	assert.Equal(t, []Ref{
		{Screen: "screen.id", Line: 12},
		{Screen: "screen.id", Region: "region", Line: 12},
		{Screen: "trip.timeline", Line: 16, InDiagram: true},
		{Screen: "trip.timeline", Region: "add-activity", Line: 16, InDiagram: true},
		{Screen: "activity.editor", Line: 16, InDiagram: true},
		{Screen: "activity.detail", Line: 17, InDiagram: true},
	}, f.Refs)
}

func TestRefIgnoresEmail(t *testing.T) {
	f := parseOK(t, fm+"Mail dev@trip.timeline.com or x.y@trip.timeline.\n")
	assert.Nil(t, f.Refs)
}

func TestRefWithRegion(t *testing.T) {
	f := parseOK(t, fm+"See (@trip.timeline#app-bar), then @a.b.c#x-1.\n")
	assert.Equal(t, []Ref{
		{Screen: "trip.timeline", Region: "app-bar", Line: 7},
		{Screen: "a.b.c", Region: "x-1", Line: 7},
	}, f.Refs)
}

func TestRefForms(t *testing.T) {
	f := parseOK(t, fm+"@a.b at the start, `@c.d` in code,@e.f after a comma, @g not an id, @h.i#.\n")
	assert.Equal(t, []Ref{
		{Screen: "a.b", Line: 7},
		{Screen: "c.d", Line: 7},
		{Screen: "e.f", Line: 7},
		{Screen: "h.i", Line: 7},
	}, f.Refs)
}

func TestSteps(t *testing.T) {
	f, ds := Parse(fixture(t, "steps.md"))
	require.Empty(t, ds)
	require.Len(t, f.Steps, 3)
	require.NotNil(t, f.Steps[0].Ref)
	assert.Equal(t, "trip.timeline", f.Steps[0].Ref.Screen)
	assert.Len(t, f.Steps[1].Branches, 2)
	assert.Equal(t, []Step{
		{
			Number: 1, Line: 14,
			Text: "Open @trip.timeline#add-activity and tap **Add**.",
			Ref:  &Ref{Screen: "trip.timeline", Region: "add-activity", Line: 14},
		},
		{
			Number: 2, Line: 16,
			Text:     "Fill in @activity.editor.",
			Ref:      &Ref{Screen: "activity.editor", Line: 16},
			Branches: []string{"Save goes to @activity.detail.", "Cancel returns to the timeline."},
		},
		{Number: 3, Line: 20, Text: "Review the activity."},
	}, f.Steps)
	assert.Equal(t, []Ref{
		{Screen: "trip.timeline", Line: 10},
		{Screen: "trip.timeline", Region: "add-activity", Line: 14},
		{Screen: "activity.editor", Line: 16},
		{Screen: "activity.detail", Line: 17},
		{Screen: "trip.timeline", Line: 22},
	}, f.Refs)
}

func TestStepWithoutRef(t *testing.T) {
	f := parseOK(t, fm+"## Steps\n1. Do a thing.\n   - branch at @a.b\n")
	require.Len(t, f.Steps, 1)
	assert.Nil(t, f.Steps[0].Ref)
	assert.Equal(t, []string{"branch at @a.b"}, f.Steps[0].Branches)
}

func TestStepRefOnContinuationLine(t *testing.T) {
	f := parseOK(t, fm+"## Steps\n1. Open\n   @a.b#c then @d.e.\n")
	require.Len(t, f.Steps, 1)
	assert.Equal(t, "Open @a.b#c then @d.e.", f.Steps[0].Text)
	assert.Equal(t, &Ref{Screen: "a.b", Region: "c", Line: 9}, f.Steps[0].Ref)
}

func TestStepsHeadingAnyLevelAnyCase(t *testing.T) {
	for _, h := range []string{"# Steps", "### STEPS", "## steps ##", "###### Steps"} {
		f := parseOK(t, fm+h+"\n\n7. one\n7. two\n")
		require.Len(t, f.Steps, 2, h)
		assert.Equal(t, 1, f.Steps[0].Number, h)
		assert.Equal(t, 2, f.Steps[1].Number, h)
		assert.Equal(t, "two", f.Steps[1].Text, h)
	}
}

func TestStepsOnlyFirstList(t *testing.T) {
	src := fm + "## Steps\n\nIntro paragraph.\n\n1. one\n2. two\n\nAfter.\n\n1. not a step\n"
	f := parseOK(t, src)
	assert.Equal(t, []string{"one", "two"}, texts(f.Steps))
}

func TestStepsLooseList(t *testing.T) {
	src := fm + "## Steps\n1. one\n\n2. two\n\n   more of two\n   - a branch\n     wraps\n"
	f := parseOK(t, src)
	require.Len(t, f.Steps, 2)
	assert.Equal(t, "two more of two", f.Steps[1].Text)
	assert.Equal(t, []string{"a branch wraps"}, f.Steps[1].Branches)
}

func TestStepsLazyContinuation(t *testing.T) {
	f := parseOK(t, fm+"## Steps\n1. one\ncontinues here\n2. two\n")
	assert.Equal(t, []string{"one continues here", "two"}, texts(f.Steps))
}

func TestStepsEnd(t *testing.T) {
	for name, tail := range map[string]string{
		"heading":           "## Notes\n1. not a step\n",
		"unindented bullet": "- a bullet\n",
		"fence":             "```\ncode\n```\n",
	} {
		f := parseOK(t, fm+"## Steps\n1. one\n"+tail)
		assert.Equal(t, []string{"one"}, texts(f.Steps), name)
	}
}

func TestStepsNeedTheHeading(t *testing.T) {
	f := parseOK(t, fm+"## Overview\n1. one\n")
	assert.Nil(t, f.Steps)
	f = parseOK(t, fm+"## Steps\nNo list.\n## Next\n1. one\n")
	assert.Nil(t, f.Steps)
	f = parseOK(t, fm+"## Steps and more\n1. one\n")
	assert.Nil(t, f.Steps)
}

func TestStepsHeadingInsideFenceIgnored(t *testing.T) {
	f := parseOK(t, fm+"```\n## Steps\n```\n1. one\n")
	assert.Nil(t, f.Steps)
}

func texts(steps []Step) []string {
	var out []string
	for _, s := range steps {
		out = append(out, s.Text)
	}
	return out
}

func TestFences(t *testing.T) {
	src := fm +
		"```yaml\nx: @a.b\n```\n" + // 7-9: ignored
		"```\n@c.d\n```\n" + // 10-12: ignored
		"~~~~ Mermaid\n@e.f\n~~~\n@g.h\n~~~~\n" + // 13-17: a diagram; ~~~ is too short to close it
		"Text `@i.j` here.\n" + // 18
		"  ```mermaid\n  @k.l\n" // 19-20: unterminated, runs to the end
	f := parseOK(t, src)
	assert.True(t, f.HasDiagram)
	assert.Equal(t, []Ref{
		{Screen: "e.f", Line: 14, InDiagram: true},
		{Screen: "g.h", Line: 16, InDiagram: true},
		{Screen: "i.j", Line: 18},
		{Screen: "k.l", Line: 20, InDiagram: true},
	}, f.Refs)
}

func TestNoDiagram(t *testing.T) {
	f := parseOK(t, fm+"```mermaidx\n@a.b\n```\n")
	assert.False(t, f.HasDiagram)
	assert.Nil(t, f.Refs)
}

func TestFrontMatterOptionalNull(t *testing.T) {
	f := parseOK(t, "---\nid: f\ntitle: T\nstatus: proposed\nentry: a.b\nactors:\nplatforms: []\n---\n")
	assert.Nil(t, f.Actors)
	assert.Nil(t, f.Platforms)
	assert.Equal(t, [2]int{1, 8}, f.FrontMatterLines)
}

func TestFrontMatterMissing(t *testing.T) {
	f, ds := Parse([]byte("# Title\n\nSee @a.b.\n"))
	require.Len(t, ds, 1)
	assert.Equal(t, diag.Diagnostic{
		Rule: "flow-frontmatter-invalid", Severity: diag.Error, File: "flow.md", Line: 1,
		Message: "flow.md must start with front matter between --- lines",
	}, ds[0])
	require.NotNil(t, f)
	assert.Equal(t, [2]int{0, 0}, f.FrontMatterLines)
	assert.Equal(t, []Ref{{Screen: "a.b", Line: 3}}, f.Refs)
	_, ds = Parse(nil)
	assert.Equal(t, []string{"flow-frontmatter-invalid"}, rules(ds))
}

func TestFrontMatterUnterminated(t *testing.T) {
	f, ds := Parse([]byte("---\nid: f\n\n@a.b\n"))
	require.Len(t, ds, 1)
	assert.Equal(t, "flow-frontmatter-invalid", ds[0].Rule)
	assert.Equal(t, 1, ds[0].Line)
	assert.Equal(t, "front matter opened on line 1 is never closed with ---", ds[0].Message)
	assert.Nil(t, f.Refs)
}

func TestFrontMatterUnknownKey(t *testing.T) {
	f, ds := Parse([]byte("---\nid: f\ntitle: T\nstatus: shipped\nentry: a.b\nowner: me\n---\nBody @a.b\n"))
	require.Len(t, ds, 1)
	assert.Equal(t, diag.Diagnostic{
		Rule: "flow-frontmatter-invalid", Severity: diag.Error, File: "flow.md", Path: "owner", Line: 6,
		Message: "unknown key owner",
	}, ds[0])
	assert.Equal(t, "f", f.ID)
	assert.Equal(t, []Ref{{Screen: "a.b", Line: 8}}, f.Refs)
}

func TestFrontMatterMissingKeys(t *testing.T) {
	_, ds := Parse([]byte("---\n---\n"))
	require.Len(t, ds, 4)
	for _, d := range ds {
		assert.Equal(t, "flow-frontmatter-invalid", d.Rule)
		assert.Equal(t, 1, d.Line)
	}
	assert.Equal(t, "front matter must set entry", ds[0].Message)
	assert.Equal(t, "entry", ds[0].Path)
	var paths []string
	for _, d := range ds {
		paths = append(paths, d.Path)
	}
	assert.Equal(t, []string{"entry", "id", "status", "title"}, paths)
}

func TestFrontMatterBadValues(t *testing.T) {
	src := "---\nid: [x]\ntitle: \"\"\nstatus: draft\nentry: Timeline\nactors: 3\nplatforms: [ios, {a: b}]\nid: g\n---\n"
	f, ds := Parse([]byte(src))
	assert.Equal(t, []diag.Diagnostic{
		{Rule: "flow-frontmatter-invalid", Severity: diag.Error, File: "flow.md", Path: "id", Line: 2, Message: "id must be a string"},
		{Rule: "flow-frontmatter-invalid", Severity: diag.Error, File: "flow.md", Path: "title", Line: 3, Message: "title must not be empty"},
		{Rule: "flow-frontmatter-invalid", Severity: diag.Error, File: "flow.md", Path: "status", Line: 4, Message: "status must be shipped or proposed, not draft"},
		{Rule: "flow-frontmatter-invalid", Severity: diag.Error, File: "flow.md", Path: "entry", Line: 5, Message: "entry must be a screen ID such as trip.timeline, not Timeline"},
		{Rule: "flow-frontmatter-invalid", Severity: diag.Error, File: "flow.md", Path: "actors", Line: 6, Message: "actors must be a list of strings"},
		{Rule: "flow-frontmatter-invalid", Severity: diag.Error, File: "flow.md", Path: "platforms[1]", Line: 7, Message: "platforms[1] must be a string"},
		{Rule: "flow-frontmatter-invalid", Severity: diag.Error, File: "flow.md", Path: "id", Line: 8, Message: "duplicate key id"},
	}, ds)
	assert.Equal(t, "", f.ID)
	assert.Equal(t, "", f.Status)
	assert.Equal(t, "", f.Entry)
	assert.Equal(t, []string{"ios"}, f.Platforms)
}

func TestFrontMatterNotMapping(t *testing.T) {
	_, ds := Parse([]byte("---\n- a\n---\n"))
	require.Len(t, ds, 1)
	assert.Equal(t, "flow-frontmatter-invalid", ds[0].Rule)
	assert.Equal(t, 2, ds[0].Line)
	assert.Equal(t, "front matter must be a mapping", ds[0].Message)
}

func TestFrontMatterYAMLSyntax(t *testing.T) {
	_, ds := Parse([]byte("---\nid: f\ntitle: [\n---\n"))
	require.Len(t, ds, 1)
	assert.Equal(t, "flow-frontmatter-invalid", ds[0].Rule)
	// The YAML parser counts from the line after the opening ---; the
	// diagnostic and its message count from the top of the file.
	// title: [ is line 2 of the YAML and line 3 of the file.
	assert.Equal(t, 3, ds[0].Line)
	assert.Contains(t, ds[0].Message, "line 3")
	assert.NotContains(t, ds[0].Message, "line 2")
}

func TestFrontMatterAlias(t *testing.T) {
	_, ds := Parse([]byte("---\nid: &x f\ntitle: *x\nstatus: shipped\nentry: a.b\n---\n"))
	assert.Equal(t, []string{"yaml-alias-not-allowed", "yaml-alias-not-allowed"}, rules(ds))
	assert.Equal(t, 2, ds[0].Line)
	assert.Equal(t, 3, ds[1].Line)
	assert.Equal(t, "flow.md", ds[0].File)
}

func TestFrontMatterDelimiterTrailingSpace(t *testing.T) {
	f := parseOK(t, "--- \nid: f\ntitle: T\nstatus: shipped\nentry: a.b\n---\t\n")
	assert.Equal(t, [2]int{1, 6}, f.FrontMatterLines)
}

func TestFlowCRLF(t *testing.T) {
	for _, name := range []string{"spec.md", "steps.md"} {
		lf := fixture(t, name)
		crlf := []byte(strings.ReplaceAll(string(lf), "\n", "\r\n"))
		want, wantDs := Parse(lf)
		got, gotDs := Parse(crlf)
		require.Empty(t, wantDs, name)
		assert.Equal(t, wantDs, gotDs, name)
		assert.Equal(t, want, got, name)
	}
}

func TestFrontMatterYAMLErrorWithoutLine(t *testing.T) {
	// The YAML reader gives no line for a control character; the
	// diagnostic points at the front matter's opening ---.
	_, ds := Parse([]byte("---\nid: \x01\n---\n"))
	require.Len(t, ds, 1)
	assert.Equal(t, "flow-frontmatter-invalid", ds[0].Rule)
	assert.Equal(t, 1, ds[0].Line)
}

func TestStepsIndentedItemStartsAStep(t *testing.T) {
	for _, indent := range []string{" ", "  ", "   "} {
		f := parseOK(t, fm+"## Steps\n1. one\n"+indent+"2. two\n")
		assert.Equal(t, []string{"one", "two"}, texts(f.Steps), "indent %q", indent)
	}
	// Four spaces is a continuation, not an item.
	f := parseOK(t, fm+"## Steps\n1. one\n    2. two\n")
	assert.Equal(t, []string{"one 2. two"}, texts(f.Steps))
}

func TestStepsParenAndEmptyItems(t *testing.T) {
	f := parseOK(t, fm+"## Steps\n1) one\n2.\n3)\n4) four\n")
	assert.Equal(t, []string{"one", "", "", "four"}, texts(f.Steps))
	assert.Equal(t, 4, f.Steps[3].Number)
	// No space after the marker: not an item.
	f = parseOK(t, fm+"## Steps\n1.one\n")
	assert.Empty(t, f.Steps)
}

func TestFenceInfoWithBacktickIsNotAFence(t *testing.T) {
	// "``` a`b" is not a fence, so the Steps heading after it is read.
	f := parseOK(t, fm+"``` a`b\n## Steps\n1. one @a.b\n")
	assert.Equal(t, []string{"one @a.b"}, texts(f.Steps))
	assert.False(t, f.HasDiagram)
	// A tilde fence may have a backtick in its info string.
	f = parseOK(t, fm+"~~~ a`b\n## Steps\n1. hidden\n~~~\n")
	assert.Empty(t, f.Steps)
}

func TestFlowLeadingBOM(t *testing.T) {
	f, ds := Parse([]byte("\uFEFF" + fm + "## Steps\n1. one\n"))
	require.Empty(t, ds)
	assert.Equal(t, "f", f.ID)
	assert.Equal(t, [2]int{1, 6}, f.FrontMatterLines)
	assert.Equal(t, []string{"one"}, texts(f.Steps))
}
