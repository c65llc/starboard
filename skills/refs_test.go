// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// These tests check the skills' text from outside the package: they import
// internal/cli, which imports internal/skills, which imports this package,
// so an in-package test importing cli would be an import cycle.
package skills_test

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/cli"
	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/flows"
	"github.com/c65llc/starboard/internal/lint"
	installer "github.com/c65llc/starboard/internal/skills"
	"github.com/c65llc/starboard/skills"
)

// TestSkillSections: every body has a "# " title, then exactly the H2
// sections When to use, Workflow and Rules in that order, and the Workflow
// is a numbered list starting at 1.
func TestSkillSections(t *testing.T) {
	for _, s := range skills.All() {
		t.Run(s.Name, func(t *testing.T) {
			assert.NoError(t, checkSections(s.Body))
		})
	}
}

func TestCheckSectionsRejects(t *testing.T) {
	for name, body := range map[string]string{
		"no title":        "## When to use\n\nx\n\n## Workflow\n\n1. x\n\n## Rules\n\n- x\n",
		"missing rules":   "# T\n\n## When to use\n\nx\n\n## Workflow\n\n1. x\n",
		"wrong order":     "# T\n\n## Workflow\n\n1. x\n\n## When to use\n\nx\n\n## Rules\n\n- x\n",
		"extra section":   "# T\n\n## When to use\n\nx\n\n## Workflow\n\n1. x\n\n## Rules\n\n- x\n\n## More\n\nx\n",
		"unnumbered flow": "# T\n\n## When to use\n\nx\n\n## Workflow\n\n- x\n\n## Rules\n\n- x\n",
		"empty rules":     "# T\n\n## When to use\n\nx\n\n## Workflow\n\n1. x\n\n## Rules\n",
	} {
		t.Run(name, func(t *testing.T) {
			assert.Error(t, checkSections(body))
		})
	}
	assert.NoError(t, checkSections("# T\n\n## When to use\n\nx\n\n## Workflow\n\n1. x\n2. y\n\n## Rules\n\n- x\n"))
}

// checkSections reports how body departs from the runbook shape.
func checkSections(body string) error {
	lines := strings.Split(body, "\n")
	if len(lines) == 0 || !strings.HasPrefix(lines[0], "# ") {
		return fmt.Errorf("body must open with a # title")
	}
	var heads []string
	content := map[string]string{}
	cur := ""
	var f fences
	for _, l := range lines[1:] {
		if _, code := f.line(l); !code && strings.HasPrefix(l, "## ") {
			cur = strings.TrimPrefix(l, "## ")
			heads = append(heads, cur)
			continue
		}
		if cur != "" {
			content[cur] += l + "\n"
		}
	}
	want := []string{"When to use", "Workflow", "Rules"}
	if !slices.Equal(heads, want) {
		return fmt.Errorf("sections are %q, want %q", heads, want)
	}
	for _, h := range want {
		if strings.TrimSpace(content[h]) == "" {
			return fmt.Errorf("section %q is empty", h)
		}
	}
	if !strings.HasPrefix(strings.TrimSpace(content["Workflow"]), "1. ") {
		return fmt.Errorf("the Workflow must be a numbered list starting at 1")
	}
	return nil
}

// --- References to commands and rules ---------------------------------------

// The test below checks that every command and rule ID a skill names is
// real, so a renamed rule or command breaks the build instead of an agent.
//
// Code is the text inside inline code spans (`…`) and every line of a fenced
// code block. Every "starboard" followed by whitespace in code starts an
// invocation: optional global flags, then a command that must be in
// cli.Commands (and, for a group such as skills, a subcommand of it), then
// flags that must be that command's or global flags (a
// flag with an Arg consumes the next word), then bare words, which are
// allowed only when the command takes positional arguments (Args is set).
// The invocation ends at the end of the code, or at "#", "|", "&&", "||",
// ";" or ")". So `starboard.yaml` is not an invocation, and a made-up
// subcommand such as `starboard skills remove` fails.
//
// A rule ID is a kebab-case word with at least one hyphen. It is checked
// only in a rules context, defined so that ordinary kebab-case words (region
// kinds such as `primary-action`, paths, flags) are never mistaken for one:
//
//   - in prose: a run of inline code spans joined only by ", ", " and ",
//     " or ", ", and " or ", or " (one span alone is a run of one) that is
//     immediately preceded by the word "rule", "rules", "finding" or
//     "findings", or immediately followed by one of them. Every kebab-case
//     span in such a run must be a rule ID. So "the `file-missing` and
//     `ref-unresolved` rules" checks both, and "a `primary-action` region"
//     checks nothing.
//   - in a fenced code block: the value of a JSON "rule" key,
//     "rule": "<id>".
//
// A rule ID is real when lint.Rules() has it or diag.CorrectnessRules does.

var (
	inlineCode   = regexp.MustCompile("`([^`\n]+)`")
	ruleShape    = regexp.MustCompile(`^[a-z][a-z0-9]*(-[a-z0-9]+)+$`)
	jsonRule     = regexp.MustCompile(`"rule"\s*:\s*"([^"]*)"`)
	invocation   = regexp.MustCompile(`(?:^|[^A-Za-z0-9_./-])starboard\s`)
	ruleWord     = `(?i:rules?|findings?)`
	ruleBefore   = regexp.MustCompile(`(?:^|\W)` + ruleWord + `\s+$`)
	ruleAfter    = regexp.MustCompile(`^\s+` + ruleWord + `(?:\W|$)`)
	runSeparator = regexp.MustCompile(`^(?:,\s+|\s+and\s+|\s+or\s+|,\s+and\s+|,\s+or\s+)$`)
)

// fences follows fenced code blocks line by line, as CommonMark does (and
// as the installer does): only a run of the opener's character at least as
// long closes a fence, and a line indented four spaces never opens one.
type fences struct{ open, info string }

// line feeds l to f and reports whether it is a fence line, and whether it
// is inside a block (fence lines included).
func (f *fences) line(l string) (fence, code bool) {
	l = strings.TrimRight(l, "\r")
	if f.open != "" {
		if flows.IsFenceClose(l, f.open) {
			f.open, f.info = "", ""
			return true, true
		}
		return false, true
	}
	if run, info, ok := flows.OpenFence(l); ok {
		f.open, f.info = run, info
		return true, true
	}
	return false, false
}

// unclosedFence returns the line of the fence body leaves open, or "".
func unclosedFence(body string) string {
	var f fences
	opener := ""
	for _, l := range strings.Split(body, "\n") {
		if fence, _ := f.line(l); fence && f.open != "" {
			opener = l
		}
	}
	if f.open == "" {
		return ""
	}
	return opener
}

// codeAndProse splits body into code (inline spans and fenced lines) and the
// prose lines outside fences.
func codeAndProse(body string) (code, prose []string) {
	var f fences
	for _, l := range strings.Split(body, "\n") {
		fence, inCode := f.line(l)
		if fence {
			continue
		}
		if inCode {
			code = append(code, l)
			continue
		}
		prose = append(prose, l)
		for _, m := range inlineCode.FindAllStringSubmatch(l, -1) {
			code = append(code, m[1])
		}
	}
	return code, prose
}

// commandByName returns the cli command called name.
func commandByName(name string) (cli.Command, bool) {
	for _, c := range cli.Commands {
		if c.Name == name {
			return c, true
		}
	}
	return cli.Command{}, false
}

// findFlag returns the flag spelled tok ("--json", "-o", "--dir=x") among
// flags, and whether its value was attached with "=".
func findFlag(tok string, flags []cli.Flag) (cli.Flag, bool, bool) {
	name := strings.TrimLeft(tok, "-")
	name, _, attached := strings.Cut(name, "=")
	for _, f := range flags {
		if f.Name == name {
			return f, attached, true
		}
	}
	return cli.Flag{}, false, false
}

// checkInvocation checks the words after one "starboard".
func checkInvocation(words []string) []string {
	var problems []string
	i := 0
	// Global flags.
	for i < len(words) && strings.HasPrefix(words[i], "-") {
		f, attached, ok := findFlag(words[i], cli.GlobalFlags)
		if !ok {
			return []string{fmt.Sprintf("starboard %s: unknown global flag", words[i])}
		}
		i++
		if f.Arg != "" && !attached {
			i++
		}
	}
	if i >= len(words) {
		return []string{"starboard: no command"}
	}
	cmd, ok := commandByName(words[i])
	if !ok {
		return []string{fmt.Sprintf("starboard %s: not a command", words[i])}
	}
	if len(cmd.Subcommands) > 0 {
		group := cmd.Name
		i++
		if i >= len(words) || strings.HasPrefix(words[i], "-") {
			return []string{fmt.Sprintf("starboard %s: no subcommand", group)}
		}
		j := slices.IndexFunc(cmd.Subcommands, func(c cli.Command) bool { return c.Name == words[i] })
		if j < 0 {
			return []string{fmt.Sprintf("starboard %s %s: not a subcommand of %s", group, words[i], group)}
		}
		cmd = cmd.Subcommands[j]
		cmd.Name = group + " " + cmd.Name
	}
	for i++; i < len(words); i++ {
		w := words[i]
		if strings.HasPrefix(w, "-") {
			f, attached, ok := findFlag(w, append(slices.Clone(cmd.Flags), cli.GlobalFlags...))
			if !ok {
				problems = append(problems, fmt.Sprintf("starboard %s %s: not a flag of %s", cmd.Name, w, cmd.Name))
				continue
			}
			if f.Arg != "" && !attached {
				i++
			}
			continue
		}
		if cmd.Args == "" {
			problems = append(problems, fmt.Sprintf("starboard %s %s: %s takes no arguments or subcommands", cmd.Name, w, cmd.Name))
		}
	}
	return problems
}

// invocationWords splits the text after "starboard" into words, stopping at
// the first shell separator or comment.
func invocationWords(rest string) []string {
	var words []string
	for _, w := range strings.Fields(rest) {
		if strings.HasPrefix(w, "#") || slices.Contains([]string{"|", "&&", "||", ";"}, w) {
			break
		}
		if trimmed, cut := strings.CutSuffix(w, ")"); cut {
			if trimmed != "" {
				words = append(words, trimmed)
			}
			break
		}
		words = append(words, w)
	}
	return words
}

// checkCommands reports every invocation in code that is not a real command.
func checkCommands(code []string) []string {
	var problems []string
	for _, c := range code {
		starts := invocation.FindAllStringIndex(c, -1)
		for i, m := range starts {
			end := len(c) // an invocation runs to the next one at most
			if i+1 < len(starts) {
				end = starts[i+1][0]
			}
			problems = append(problems, checkInvocation(invocationWords(c[m[1]-1:end]))...)
		}
	}
	return problems
}

// knownRule reports whether id is a real rule ID.
func knownRule(id string) bool {
	if diag.CorrectnessRules[id] {
		return true
	}
	return slices.ContainsFunc(lint.Rules(), func(r lint.Rule) bool { return r.ID == id })
}

// ruleIDsInContext returns every kebab-case token in a rules context: the
// spans of each run of inline code in a prose line that is immediately
// preceded or followed by a rule word, and JSON "rule" values in code.
func ruleIDsInContext(code, prose []string) []string {
	var ids []string
	for _, c := range code {
		for _, m := range jsonRule.FindAllStringSubmatch(c, -1) {
			ids = append(ids, m[1])
		}
	}
	for _, l := range prose {
		spans := inlineCode.FindAllStringSubmatchIndex(l, -1)
		for start := 0; start < len(spans); {
			end := start // the run is spans[start..end]
			for end+1 < len(spans) && runSeparator.MatchString(l[spans[end][1]:spans[end+1][0]]) {
				end++
			}
			before := l[:spans[start][0]]
			after := l[spans[end][1]:]
			if ruleBefore.MatchString(before) || ruleAfter.MatchString(after) {
				for _, s := range spans[start : end+1] {
					if tok := l[s[2]:s[3]]; ruleShape.MatchString(tok) {
						ids = append(ids, tok)
					}
				}
			}
			start = end + 1
		}
	}
	return ids
}

// checkRules reports every rule ID in a rules context that is not real.
func checkRules(code, prose []string) []string {
	var problems []string
	for _, id := range ruleIDsInContext(code, prose) {
		if !knownRule(id) {
			problems = append(problems, fmt.Sprintf("%q is not a rule ID", id))
		}
	}
	return problems
}

// checkReferences is every command and rule problem in body.
func checkReferences(body string) []string {
	code, prose := codeAndProse(body)
	return append(checkCommands(code), checkRules(code, prose)...)
}

func TestSkillsReferenceRealCommandsAndRules(t *testing.T) {
	for _, s := range skills.All() {
		t.Run(s.Name, func(t *testing.T) {
			assert.Empty(t, checkReferences(s.Body))
		})
	}
}

// TestSkillFencesAreBalanced: every fenced code block a skill body opens is
// closed. An unclosed one would run to the end of the section file it is
// installed into, and every later install would refuse that file.
func TestSkillFencesAreBalanced(t *testing.T) {
	for _, s := range skills.All() {
		t.Run(s.Name, func(t *testing.T) {
			assert.Empty(t, unclosedFence(s.Body))
		})
	}
	assert.Equal(t, "```bash", unclosedFence("# T\n\n```bash\nx\n"))
	assert.Equal(t, "````", unclosedFence("````\n```\n"))
	assert.Equal(t, "~~~", unclosedFence("~~~\n```\n```\n"))
	assert.Empty(t, unclosedFence("```\nx\n```\n    ```\n"))
}

// TestSkillsReferenceSomething guards the check above against passing
// vacuously: every skill runs lint, and between them the skills name rules
// in a rules context.
func TestSkillsReferenceSomething(t *testing.T) {
	var ids []string
	for _, s := range skills.All() {
		code, prose := codeAndProse(s.Body)
		assert.True(t, slices.ContainsFunc(code, func(c string) bool { return strings.Contains(c, "starboard lint") }),
			"%s never runs starboard lint", s.Name)
		ids = append(ids, ruleIDsInContext(code, prose)...)
	}
	for _, id := range []string{"generated-stale", "unregistered-screen-file", "file-missing", "status-conflict"} {
		assert.Contains(t, ids, id)
	}
}

func TestCheckReferencesFindsMadeUpCommandsAndRules(t *testing.T) {
	bad := map[string]string{
		"made-up command":          "Run `starboard check`.",
		"made-up command in fence": "```bash\nstarboard publish --all\n```\n",
		"subcommand of a command":  "Run `starboard lint all`.",
		"made-up subcommand":       "Run `starboard skills remove`.",
		"missing subcommand":       "Run `starboard skills`.",
		"flag before subcommand":   "Run `starboard skills --dry-run install`.",
		"flag of a sibling":        "Run `starboard skills list --dry-run`.",
		"argument to list":         "Run `starboard skills list all`.",
		"made-up hook":             "Run `starboard hook cursor`.",
		"argument to lint":         "Run `starboard lint everything`.",
		"made-up flag":             "Run `starboard lint --quiet`.",
		"made-up global flag":      "Run `starboard --root x lint`.",
		"no command":               "Run `starboard --dir x`.",
		"made-up rule before":      "Fix the rule `screen-too-big`.",
		"made-up rule after":       "Fix every `screen-too-big` finding.",
		"made-up rule in a run":    "The `file-missing`, `ref-unresolved` or `screen-too-big` rules.",
		"made-up rule in json":     "```json\n{\"rule\": \"screen-too-big\"}\n```\n",
		"inside a longer fence":    "````md\n```\nstarboard check\n```\n````\n",
		"inside a tilde fence":     "~~~\n```\nstarboard check\n~~~\n",
	}
	for name, body := range bad {
		t.Run(name, func(t *testing.T) {
			assert.NotEmpty(t, checkReferences(body))
		})
	}
}

func TestCheckReferencesAcceptsRealOnesAndOrdinaryWords(t *testing.T) {
	good := strings.Join([]string{
		"Edit `starboard.yaml` and use the `starboard-propose` skill.",
		"Run `starboard fmt`, then `starboard lint --json` (`starboard --dir app lint --strict`).",
		"Run `starboard init --platform ios --platform web` and `starboard render trip.timeline -o t.svg`.",
		"Run `starboard schema screens` or `starboard lint --fix && git add .`.",
		"Run `starboard skills install --agent codex --dry-run`, `starboard skills list` and `starboard skills hooks pre-commit`.",
		"The hook runs `starboard hook claude-code`.",
		"A `primary-action` region on a `web-wide` form factor is not a rule.",
		"The `file-missing`, `ref-unresolved` and `unregistered-screen-file` rules; a `generated-stale` finding.",
		"```bash\nstarboard fmt   # canonical form\nstarboard lint --json | jq .\n```",
		"```json\n{\"rule\": \"edge-unresolved\"}\n```",
	}, "\n")
	assert.Empty(t, checkReferences(good))
}

// --- Forbidden instructions --------------------------------------------------

// A skill never tells an agent to hand-edit generated/, to skip starboard
// lint, or to mark something shipped before its code and file paths exist.
// Each forbidden pattern below matches the instruction; a line that matches
// is allowed only when it is negated, that is, it also says "never", "do
// not", "don't" or "not". This cannot catch every paraphrase; together with
// the positive checks after it, it catches the plain ones.

var (
	negation  = regexp.MustCompile(`(?i)\b(never|do not|don't|not)\b`)
	forbidden = []*regexp.Regexp{
		// Editing generated output by hand.
		regexp.MustCompile("(?i)\\b(hand-edit|edit|modify|change|update|write|fix)\\b[^.]*`?generated/"),
		regexp.MustCompile("(?i)`?generated/`?[^.]*\\bby hand\\b"),
		// Skipping lint.
		regexp.MustCompile(`(?i)\b(skip|omit|bypass)\b[^.]*\blint\b`),
		regexp.MustCompile("(?i)\\bwithout (running )?`?(starboard )?lint"),
		regexp.MustCompile(`(?i)--no-verify`),
		// Shipping early.
		regexp.MustCompile("(?i)`?shipped`?[^.]*\\bbefore\\b[^.]*\\b(code|implement|files?)\\b"),
		regexp.MustCompile("(?i)\\b(mark|set|flip)\\b[^.]*`?shipped`?[^.]*\\b(first|then implement|later)\\b"),
	}
)

// checkForbidden returns every line of body that gives a forbidden
// instruction.
func checkForbidden(body string) []string {
	var out []string
	for _, l := range strings.Split(body, "\n") {
		for _, re := range forbidden {
			if re.MatchString(l) && !negation.MatchString(l) {
				out = append(out, l)
				break
			}
		}
	}
	return out
}

func TestSkillsGiveNoForbiddenInstruction(t *testing.T) {
	for _, s := range skills.All() {
		t.Run(s.Name, func(t *testing.T) {
			assert.Empty(t, checkForbidden(s.Body))
			assert.NotContains(t, s.Body, "starboard skills", "the skills are read after install; installing is the guide's job")
			assert.NotContains(t, s.Body, installer.StartMarker, "a marker in a skill would break its own section")
			assert.NotContains(t, s.Body, installer.EndMarker, "a marker in a skill would break its own section")
		})
	}
}

func TestCheckForbiddenCatchesThePlainForms(t *testing.T) {
	for _, l := range []string{
		"Edit `generated/app-map.md` to add the edge.",
		"Fix the wireframe in generated/wireframes by hand.",
		"Skip `starboard lint` when in a hurry.",
		"Commit without running lint.",
		"Commit with --no-verify.",
		"Set the status to `shipped` before writing the code.",
		"Mark it `shipped` first, then implement it.",
	} {
		assert.NotEmpty(t, checkForbidden(l), l)
	}
	for _, l := range []string{
		"Never hand-edit `generated/`; run `starboard generate`.",
		"Do not skip `starboard lint`.",
		"Never set `shipped` before the code and its file paths exist.",
		"`generated/` is written by `starboard generate`.",
	} {
		assert.Empty(t, checkForbidden(l), l)
	}
}

// TestSkillsSayTheLoadBearingRules pins the sentences each skill exists to
// teach, so an edit cannot quietly drop one.
func TestSkillsSayTheLoadBearingRules(t *testing.T) {
	want := map[string][]string{
		"starboard": {
			"run `starboard fmt` then `starboard lint --json`",
			"Never hand-edit `generated/`",
			"`starboard.yaml`",
			"cannot be configured",
		},
		"starboard-propose": {"`status: proposed`", "`starboard lint`", "platform code"},
		"starboard-implement": {
			"`files.<platform>`", "same change", "`shipped`", "`proposed`", "`starboard lint`",
		},
		"starboard-adopt": {
			"`starboard init`", "`unregistered-screen-file`", "`unmapped`", "Commit",
			"Commit only with `starboard lint` passing", "one area at a time",
		},
	}
	// Phrases a skill must not say. Adoption once committed each area while
	// lint still failed for the "areas not yet adopted"; it now widens
	// screenFiles per area so lint passes at every commit.
	mustNot := map[string][]string{
		"starboard-adopt": {"areas not yet adopted"},
	}
	byName := map[string]skills.Skill{}
	for _, s := range skills.All() {
		byName[s.Name] = s
	}
	for name, phrases := range want {
		s, ok := byName[name]
		require.True(t, ok, name)
		for _, p := range phrases {
			assert.Contains(t, s.Body, p, "%s must say %q", name, p)
		}
	}
	for name, phrases := range mustNot {
		for _, p := range phrases {
			assert.NotContains(t, byName[name].Body, p, "%s must not say %q", name, p)
		}
	}
}

// TestGuideReferencesRealCommands: the agents guide names commands the
// way the skills do, so it is held to the same check.
func TestGuideReferencesRealCommands(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "docs", "guides", "agents.md"))
	require.NoError(t, err)
	// Inline spans and shell blocks only: the guide also quotes JSON and
	// Markdown, whose own backticks and quotes are not invocations.
	var code []string
	var f fences
	for _, l := range strings.Split(string(data), "\n") {
		fence, inCode := f.line(l)
		switch {
		case fence:
		case inCode && (f.info == "bash" || f.info == "sh"):
			code = append(code, l)
		case !inCode:
			for _, m := range inlineCode.FindAllStringSubmatch(l, -1) {
				code = append(code, m[1])
			}
		}
	}
	assert.Empty(t, checkCommands(code))
	assert.True(t, slices.ContainsFunc(code, func(c string) bool { return strings.Contains(c, "starboard skills install") }))
}
