// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package format

import (
	"io/fs"
	"os"
	"path"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/flows"
	"github.com/c65llc/starboard/internal/project"
)

func TestFormatFlowLeavesMermaid(t *testing.T) {
	diagram := "```mermaid\nflowchart TD\n\n\n\n    A[\"@a.b\"]  -->   B\n%% comment\n```\n"
	src := "---\nid: f\ntitle: T\nstatus: shipped\nentry: a.b\n---\n\n" + diagram + "\n\n\nAfter.\n"
	got, err := Flow([]byte(src))
	require.NoError(t, err)
	assert.Equal(t, "---\nid: f\ntitle: T\nstatus: shipped\nentry: a.b\n---\n\n"+diagram+"\nAfter.\n", string(got))
}

func TestFormatFlowFences(t *testing.T) {
	// A fence that is never closed runs to the end of the file; a tilde
	// fence is a fence too; "``` a`b" is not a fence.
	for name, tc := range map[string]struct{ src, want string }{
		"unclosed": {"Text\n```\na\n\n\nb\n", "Text\n```\na\n\n\nb\n"},
		"tilde":    {"~~~~\na\n\n\n~~~\nb\n~~~~\n\n\nc\n", "~~~~\na\n\n\n~~~\nb\n~~~~\n\nc\n"},
		"backtick": {"``` a`b\n\n\nc\n", "``` a`b\n\nc\n"},
	} {
		got, err := Flow([]byte(tc.src))
		require.NoError(t, err, name)
		assert.Equal(t, tc.want, string(got), name)
	}
}

func TestFormatFlowWithoutFrontMatter(t *testing.T) {
	for name, tc := range map[string]struct{ src, want string }{
		"empty":           {"", ""},
		"blank":           {"\n\n  \n", ""},
		"no front":        {"# Title  \n\n\n\nText", "# Title\n\nText\n"},
		"never closed":    {"---\nid: [x\n\n\nbody\n", "---\nid: [x\n\nbody\n"},
		"empty front":     {"---\n---\nbody\n", "---\n---\nbody\n"},
		"comment front":   {"---  \n# just a note\n--- \n\n\nbody\n", "---\n# just a note\n---\n\nbody\n"},
		"bom and crlf":    {"\uFEFF---\r\nid: f\r\n---\r\nbody\r\n", "---\nid: f\n---\nbody\n"},
		"front not a map": {"---\n- b\n- a\n---\n", "---\n[b, a]\n---\n"},
	} {
		got, err := Flow([]byte(tc.src))
		require.NoError(t, err, name)
		assert.Equal(t, tc.want, string(got), name)
	}
}

func TestFormatFlowFrontMatterErrors(t *testing.T) {
	for name, src := range map[string]string{
		"syntax":  "---\nid: [x\n---\nbody\n",
		"lone CR": "body\rmore\n",
		"alias":   "---\nid: &a f\ntitle: *a\n---\n",
	} {
		_, err := Flow([]byte(src))
		assert.Error(t, err, name)
	}
}

func TestProject(t *testing.T) {
	const canonicalScreens = "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n"
	const okFlow = "---\nid: ok\ntitle: T\nstatus: shipped\nentry: a.b\n---\n"
	crlf := func(s string) []byte { return []byte(strings.ReplaceAll(s, "\n", "\r\n")) }
	fsys := project.MemFS{
		config.FileName:        []byte("content: docs\nversion: 1\nareas: [a]\n"),
		"docs/screens.yaml":    crlf(canonicalScreens),
		"docs/flows/ok.md":     []byte(okFlow),
		"docs/flows/okcrlf.md": crlf(strings.ReplaceAll(okFlow, "ok", "okcrlf")),
		"docs/flows/messy.md":  crlf("---\ntitle: T\nid: messy\nstatus: shipped\nentry: a.b\n---\nText   \n"),
		"docs/flows/broken.md": []byte("---\nid: [x\n---\n"),
		"docs/flows/cr.md":     []byte("---\nid: cr\ntitle: T\nstatus: shipped\nentry: a.b\n---\nOne\rTwo\n"),
	}
	p, _, err := project.Load(fsys)
	require.NoError(t, err)
	require.NotNil(t, p)
	got, failed := Project(p)
	assert.Equal(t, map[string][]byte{
		"starboard.yaml":      []byte("version: 1\ncontent: docs\nareas: [a]\n"),
		"docs/flows/messy.md": []byte("---\nid: messy\ntitle: T\nstatus: shipped\nentry: a.b\n---\nText\n"),
	}, got, "a file that differs only in CRLF line endings is formatted; a rewrite is LF")
	require.Len(t, failed, 1, "broken.md does not parse, which the loader reports; only cr.md fails here")
	assert.EqualError(t, failed["docs/flows/cr.md"], "lines must end in LF or CRLF, not a lone CR")
}

func TestProjectCannotFormat(t *testing.T) {
	fsys := project.MemFS{
		config.FileName:     []byte("version: 1\ncontent: docs\n"),
		"docs/screens.yaml": []byte("[[[]#\n]#\n]\n"),
	}
	p, _, err := project.Load(fsys)
	require.NoError(t, err)
	require.NotNil(t, p)
	got, failed := Project(p)
	assert.Empty(t, got)
	require.Contains(t, failed, "docs/screens.yaml")
	assert.EqualError(t, failed["docs/screens.yaml"], "formatting would drop a comment: #")
}

func TestFormatFlowHardBreaks(t *testing.T) {
	src := "Line one   \nline two\t \nlast  \n\n```\ncode  \nmore\n```\nend  \n"
	got, err := Flow([]byte(src))
	require.NoError(t, err)
	// Two or more trailing spaces before more text keep exactly two (a
	// Markdown hard break); a tab, the end of a paragraph, a fenced line
	// and the last line lose them.
	assert.Equal(t, "Line one  \nline two\nlast\n\n```\ncode\nmore\n```\nend\n", string(got))
}

// fenced returns the trimmed lines inside fenced blocks of a flow body. The
// blank lines that end the file go, as they do from an unclosed fence.
func fenced(text string) []string {
	text = strings.TrimPrefix(strings.ReplaceAll(text, "\r\n", "\n"), flows.BOM)
	lines := strings.Split(text, "\n")
	for len(lines) > 1 && strings.TrimRight(lines[len(lines)-1], " \t") == "" {
		lines = lines[:len(lines)-1]
	}
	if flows.IsDelimiter(lines[0]) {
		if end := closing(lines); end > 0 {
			lines = lines[end+1:]
		}
	}
	var out []string
	fence := ""
	for _, l := range lines {
		l = strings.TrimRight(l, " \t")
		switch {
		case fence != "":
			if flows.IsFenceClose(l, fence) {
				fence = ""
				continue
			}
			out = append(out, l)
		default:
			if f, _, ok := flows.OpenFence(l); ok {
				fence = f
			}
		}
	}
	return out
}

func FuzzFormatFlowIdempotent(f *testing.F) {
	for _, name := range inputs(f) {
		if strings.HasSuffix(name, ".md") {
			f.Add(read(f, path.Join("testdata/in", name)))
		}
	}
	for _, name := range []string{"spec.md", "steps.md"} {
		data, err := fs.ReadFile(os.DirFS("../flows/testdata"), name)
		require.NoError(f, err)
		f.Add(data)
	}
	f.Fuzz(func(t *testing.T, src []byte) {
		once, err := Flow(src)
		if err != nil {
			return // front matter that is not readable YAML
		}
		twice, err := Flow(once)
		require.NoError(t, err, "formatted output must format:\n%s", once)
		require.Equal(t, string(once), string(twice), "formatting twice must equal once")
		require.Equal(t, fenced(string(src)), fenced(string(once)), "fenced blocks must be untouched")
	})
}
