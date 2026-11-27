// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package lint

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.yaml.in/yaml/v3"

	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/flows"
	"github.com/c65llc/starboard/internal/project"
)

// rulesDir holds one documentation page per rule, docs/rules/<id>.md.
var rulesDir = filepath.Join("..", "..", "docs", "rules")

// rulePage is a parsed docs/rules/<id>.md.
type rulePage struct {
	Title, Description string
	Sections           []string          // the ## headings, in order
	Content            map[string]string // each section's text, by heading
}

func readRulePage(t *testing.T, id string) rulePage {
	t.Helper()
	data, err := fs.ReadFile(os.DirFS(rulesDir), id+".md")
	require.NoError(t, err)
	src := strings.ReplaceAll(string(data), "\r\n", "\n")
	rest, ok := strings.CutPrefix(src, "---\n")
	require.True(t, ok, "%s.md must open with front matter", id)
	fm, body, ok := strings.Cut(rest, "\n---\n")
	require.True(t, ok, "%s.md: front matter is never closed", id)
	var meta struct {
		Title       string `yaml:"title"`
		Description string `yaml:"description"`
	}
	dec := yaml.NewDecoder(strings.NewReader(fm))
	dec.KnownFields(true)
	require.NoError(t, dec.Decode(&meta), "%s.md front matter", id)
	page := rulePage{Title: meta.Title, Description: meta.Description, Content: map[string]string{}}
	fence, cur := "", ""
	for _, l := range strings.Split(body, "\n") {
		f, _, opens := flows.OpenFence(l)
		switch {
		case fence != "":
			if flows.IsFenceClose(l, fence) {
				fence = ""
			}
		case opens:
			fence = f
		default:
			if h, ok := strings.CutPrefix(l, "## "); ok {
				cur = h
				page.Sections = append(page.Sections, h)
				continue
			}
		}
		page.Content[cur] += l + "\n"
	}
	return page
}

// sentenceEnd is punctuation that ends a sentence: a summary has exactly
// one, its final period.
var sentenceEnd = regexp.MustCompile(`[.!?](\s|$)`)

// TestRuleDocsComplete: docs/rules holds exactly one page per rule, each
// titled with the rule's ID, described by its Summary, and with the
// sections a rule page has: Configuration only for a quality rule.
func TestRuleDocsComplete(t *testing.T) {
	entries, err := os.ReadDir(rulesDir)
	require.NoError(t, err)
	var stems []string
	for _, e := range entries {
		if stem, ok := strings.CutSuffix(e.Name(), ".md"); ok && !e.IsDir() {
			stems = append(stems, stem)
		}
	}
	var ids []string
	for _, r := range Rules() {
		ids = append(ids, r.ID)
	}
	assert.Equal(t, ids, stems, "docs/rules/*.md must match the rule IDs")

	want := []string{"What it catches", "Why it matters", "How to fix", "Example"}
	for _, r := range Rules() {
		t.Run(r.ID, func(t *testing.T) {
			require.NotEmpty(t, r.Summary)
			assert.Len(t, sentenceEnd.FindAllStringIndex(r.Summary, -1), 1, "a summary is one sentence: %q", r.Summary)
			assert.True(t, strings.HasSuffix(r.Summary, "."), "a summary ends with a period")
			page := readRulePage(t, r.ID)
			assert.Equal(t, r.ID, page.Title)
			assert.Equal(t, r.Summary, page.Description)
			sections := want
			if r.Kind() == "quality" {
				sections = append(slices.Clone(want), "Configuration")
			}
			assert.Equal(t, sections, page.Sections)
			for _, h := range page.Sections {
				assert.NotEmpty(t, strings.TrimSpace(page.Content[h]), "section %q is empty", h)
			}
			assert.Empty(t, strings.TrimSpace(page.Content[""]), "text before the first section")
		})
	}
}

// TestRulesCoverEveryID: Rules lists every rule ID diag knows, the
// correctness rules found while loading included, and no other.
func TestRulesCoverEveryID(t *testing.T) {
	var want []string
	for id := range diag.CorrectnessRules {
		want = append(want, id)
	}
	for id := range diag.QualityRules {
		want = append(want, id)
	}
	slices.Sort(want)
	var got []string
	for _, r := range Rules() {
		got = append(got, r.ID)
		if diag.CorrectnessRules[r.ID] {
			assert.Equal(t, "correctness", r.Kind(), r.ID)
		} else {
			assert.Equal(t, "quality", r.Kind(), r.ID)
		}
		assert.Equal(t, diag.DocsURL(r.ID), r.Docs(), r.ID)
	}
	assert.Equal(t, want, got)
}

// TestDiagnosticHasDocs: every diagnostic Run returns, the load
// diagnostics included, links to its rule's page.
func TestDiagnosticHasDocs(t *testing.T) {
	p := mkProject(t, with(map[string]string{
		screensYML: "screens:\n  a.one:\n    title: A\n    area: nowhere\n    presentation: root\n",
		flowFile:   "",
	}))
	load := []diag.Diagnostic{{Rule: "schema-invalid", Severity: diag.Error, File: screensYML, Line: 1, Message: "m"}}
	res := Run(p, load, Options{})
	require.NotEmpty(t, res.Diagnostics)
	for _, d := range res.Diagnostics {
		assert.Equal(t, "https://starboard.c65llc.com/rules/"+d.Rule+"/", d.Docs, d.Rule)
	}
	assert.Empty(t, load[0].Docs, "Run must not change the caller's slice")

	res = Run(nil, []diag.Diagnostic{{Rule: "yaml-syntax", Severity: diag.Error, File: cfgFile}}, Options{})
	require.Len(t, res.Diagnostics, 1)
	assert.Equal(t, diag.DocsURL("yaml-syntax"), res.Diagnostics[0].Docs)
}

// --- the pages' examples ----------------------------------------------------

// A page's Example marks its code blocks with an HTML comment on the line
// before the fence, naming the project-relative file the block is:
//
//	<!-- example: docs/flows/screens.yaml -->  the file in the failing project
//	<!-- fixed: docs/flows/screens.yaml -->    the file in the fixed project
//	<!-- given: starboard.yaml -->             the file in both
//	<!-- exists: ios/Screens/TimelineView.swift -->  an unshown file in both,
//	                                           with no block after it
//
// TestRuleExamples builds both projects over exampleBase and lints them:
// the rule must fire in the failing one and not in the fixed one. A page
// with no example marker is not checked; unverifiedExamples lists them.
var exampleMarker = regexp.MustCompile(`^<!-- (example|fixed|given|exists): (\S+) -->$`)

// exampleBase is the project a page's files are laid over: two platforms
// and two areas, and nothing else.
var exampleBase = map[string]string{
	"starboard.yaml": "version: 1\nplatforms:\n  ios:\n    formFactors: [phone]\n  web:\n    formFactors: [web-wide]\nareas: [trip, activity]\n",
}

// unverifiedExamples are the pages whose example cannot be built as a
// tiny project, and why.
var unverifiedExamples = map[string]string{
	"generated-stale": "the failing input is a hand-edited generated page, which is long and only meaningful against the generator's exact output",
}

type example struct{ failing, fixed map[string]string }

// parseExample reads the marked blocks of a page body.
func parseExample(body string) (example, bool, error) {
	ex := example{failing: map[string]string{}, fixed: map[string]string{}}
	lines := strings.Split(body, "\n")
	found := false
	for i := 0; i < len(lines); i++ {
		m := exampleMarker.FindStringSubmatch(lines[i])
		if m == nil {
			continue
		}
		found = true
		kind, file := m[1], m[2]
		content := "exists\n"
		if kind != "exists" {
			fence := ""
			if i+1 < len(lines) {
				fence, _, _ = flows.OpenFence(lines[i+1])
			}
			if fence == "" {
				return ex, false, fmt.Errorf("line %d: %s marker is not followed by a fenced block", i+1, kind)
			}
			var b strings.Builder
			j := i + 2
			for ; j < len(lines) && !flows.IsFenceClose(lines[j], fence); j++ {
				b.WriteString(lines[j] + "\n")
			}
			if j == len(lines) {
				return ex, false, fmt.Errorf("line %d: fenced block is never closed", i+2)
			}
			content, i = b.String(), j
		}
		if kind != "fixed" {
			ex.failing[file] = content
		}
		if kind != "example" {
			ex.fixed[file] = content
		}
	}
	return ex, found, nil
}

// lintExample loads files over exampleBase and returns its findings as
// "rule: message", and the rules of those at error severity. The project
// must load.
func lintExample(t *testing.T, files map[string]string) (all, errs []string) {
	t.Helper()
	fsys := project.MemFS{}
	for name, data := range exampleBase {
		fsys[name] = []byte(data)
	}
	for name, data := range files {
		fsys[name] = []byte(data)
	}
	p, ds, err := project.Load(fsys)
	require.NoError(t, err)
	require.NotNil(t, p, "the project does not load: %v", ds)
	for _, d := range Run(p, ds, Options{}).Diagnostics {
		all = append(all, d.Rule+": "+d.Message)
		if d.Severity == diag.Error {
			errs = append(errs, d.Rule)
		}
	}
	return all, errs
}

// TestRuleExamples: each page's failing example draws its rule and, for a
// correctness rule, no other error; a quality rule's draws no error at all.
// The fixed example loads and draws no error and not the page's rule, so a
// reader copying it gets a clean lint (quality warnings aside).
func TestRuleExamples(t *testing.T) {
	for _, r := range Rules() {
		t.Run(r.ID, func(t *testing.T) {
			page := readRulePage(t, r.ID)
			ex, found, err := parseExample(page.Content["Example"])
			require.NoError(t, err)
			if _, skip := unverifiedExamples[r.ID]; skip {
				assert.False(t, found, "%s is listed as unverified but has markers", r.ID)
				return
			}
			require.True(t, found, "the Example has no <!-- example: … --> markers; mark it or list it in unverifiedExamples")
			require.NotEmpty(t, ex.failing)

			all, errs := lintExample(t, ex.failing)
			assert.True(t, slices.ContainsFunc(all, func(f string) bool { return strings.HasPrefix(f, r.ID+": ") }),
				"the failing example does not draw %s; it draws %q", r.ID, all)
			for _, e := range errs {
				assert.Equal(t, r.ID, e, "the failing example draws another error; it draws %q", all)
			}

			all, errs = lintExample(t, ex.fixed)
			assert.Empty(t, errs, "the fixed example draws errors: %q", all)
			assert.False(t, slices.ContainsFunc(all, func(f string) bool { return strings.HasPrefix(f, r.ID+": ") }),
				"the fixed example still draws %s: %q", r.ID, all)
		})
	}
}

func TestParseExampleErrors(t *testing.T) {
	for name, body := range map[string]string{
		"no block":       "<!-- example: a.yaml -->\ntext\n",
		"marker at end":  "<!-- example: a.yaml -->",
		"unclosed block": "<!-- example: a.yaml -->\n```yaml\na: b\n",
	} {
		t.Run(name, func(t *testing.T) {
			_, _, err := parseExample(body)
			assert.Error(t, err)
		})
	}
	ex, found, err := parseExample("<!-- example: m.md -->\n````markdown\n```mermaid\nx\n```\n````\n")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, map[string]string{"m.md": "```mermaid\nx\n```\n"}, ex.failing)

	ex, found, err = parseExample("<!-- given: g -->\n```\ng\n```\n<!-- example: f -->\n```\nbad\n```\n<!-- fixed: f -->\n```\ngood\n```\n<!-- exists: e -->\n")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, map[string]string{"g": "g\n", "f": "bad\n", "e": "exists\n"}, ex.failing)
	assert.Equal(t, map[string]string{"g": "g\n", "f": "good\n", "e": "exists\n"}, ex.fixed)
}
