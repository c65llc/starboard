// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package cli

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/skills"
	skillsfs "github.com/c65llc/starboard/skills"
)

// runIn runs the command line with stdin.
func runIn(stdin string, args ...string) (int, string, string) {
	var stdout, stderr bytes.Buffer
	code := Run(args, strings.NewReader(stdin), &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func TestSkillsList(t *testing.T) {
	code, out, errOut := run("skills", "list")
	assert.Equal(t, 0, code)
	assert.Empty(t, errOut)
	for _, s := range skillsfs.All() {
		assert.Contains(t, out, s.Name+"  ")
		assert.Contains(t, out, s.Description)
	}
	code, _, errOut = run("skills", "list", "x")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "skills list takes no arguments")
	assert.Contains(t, errOut, "usage: starboard [--dir D] skills list\n")
}

func TestSkillsGroupUsage(t *testing.T) {
	code, out, errOut := run("skills")
	assert.Equal(t, 2, code)
	assert.Empty(t, out)
	assert.Contains(t, errOut, "starboard skills: missing subcommand; use install, list or hooks")
	assert.Contains(t, errOut, "usage: starboard [--dir D] skills <subcommand>")

	code, _, errOut = run("skills", "remove")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "starboard skills: unknown subcommand remove; use install, list or hooks")

	for _, h := range []string{"--help", "-h", "help"} {
		code, out, errOut = run("skills", h)
		assert.Equal(t, 0, code, h)
		assert.Empty(t, errOut)
		assert.Contains(t, out, "usage: starboard [--dir D] skills <subcommand>\n")
		assert.Contains(t, out, "  install [--agent A]... [--dry-run]")
		assert.Contains(t, out, "  hooks <agent|pre-commit>")
	}

	code, out, _ = run("skills", "install", "--help")
	assert.Equal(t, 0, code)
	assert.Contains(t, out, "usage: starboard [--dir D] skills install [--agent A]... [--dry-run]\n")
	assert.Contains(t, out, "--dry-run")

	code, _, errOut = run("skills", "install", "--bogus")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "starboard skills install: flag provided but not defined: -bogus")
}

func TestHiddenHookIsNotInTheUsage(t *testing.T) {
	_, out, _ := run("help")
	assert.NotContains(t, out, "hook claude-code")
	assert.Contains(t, out, "\n  skills install [--agent A]... [--dry-run]  ")
	assert.Contains(t, out, "\n  skills hooks <agent|pre-commit>  ")
	code, _, errOut := run("hook")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "missing subcommand; use claude-code")
}

func TestSkillsHooks(t *testing.T) {
	code, out, errOut := run("skills", "hooks", "claude-code")
	assert.Equal(t, 0, code)
	assert.True(t, json.Valid([]byte(out)), out)
	assert.Contains(t, errOut, ".claude/settings.json")

	code, out, _ = run("skills", "hooks", "pre-commit")
	assert.Equal(t, 0, code)
	assert.Contains(t, out, "starboard fmt --check && starboard lint")

	code, out, errOut = run("skills", "hooks", "emacs")
	assert.Equal(t, 2, code)
	assert.Empty(t, out)
	assert.Contains(t, errOut, "unknown hook target emacs")

	for _, args := range [][]string{{"skills", "hooks"}, {"skills", "hooks", "a", "b"}} {
		code, _, errOut = run(args...)
		assert.Equal(t, 2, code)
		assert.Contains(t, errOut, "skills hooks takes one argument")
	}
}

func TestSkillsInstall(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, map[string]string{"starboard.yaml": "version: 1\n", "AGENTS.md": "# Mine\n", "sub/x.txt": "x"})
	require.NoError(t, os.Mkdir(filepath.Join(dir, ".claude"), 0o750))

	code, out, errOut := run("--dir", filepath.Join(dir, "sub"), "skills", "install", "--dry-run")
	assert.Equal(t, 0, code, errOut)
	assert.Contains(t, out, "agents: claude-code, codex (detected)\n")
	assert.Contains(t, out, "would write .claude/skills/starboard/SKILL.md\n")
	assert.Contains(t, out, "would write AGENTS.md\n")
	assert.Contains(t, out, "(dry run)")
	assert.NoFileExists(t, filepath.Join(dir, ".starboard", "skills.lock.json"))

	code, out, errOut = run("--dir", filepath.Join(dir, "sub"), "skills", "install")
	assert.Equal(t, 0, code, errOut)
	assert.Contains(t, out, "wrote .claude/skills/starboard/SKILL.md\n")
	assert.Contains(t, out, "5 written, 0 unchanged, 0 staged\n")
	assert.Empty(t, errOut)
	assert.FileExists(t, filepath.Join(dir, ".starboard", "skills.lock.json"))
	assert.True(t, strings.HasPrefix(read(t, dir, "AGENTS.md"), "# Mine\n\n"+skills.StartMarker))

	// Edited: staged, warned, exit 0.
	write(t, dir, map[string]string{".claude/skills/starboard/SKILL.md": "mine\n"})
	code, out, errOut = run("--dir", dir, "skills", "install", "--agent", "claude-code")
	assert.Equal(t, 0, code)
	assert.Contains(t, out, "staged .claude/skills/starboard/SKILL.md as .starboard/pending/.claude/skills/starboard/SKILL.md\n")
	assert.Contains(t, out, "0 written, 3 unchanged, 1 staged\n")
	assert.Contains(t, errOut, "warning: 1 file was edited or not installed by Starboard")
	assert.Equal(t, "mine\n", read(t, dir, ".claude/skills/starboard/SKILL.md"))

	code, out, _ = run("--dir", dir, "skills", "install", "--agent", "claude-code", "--dry-run")
	assert.Equal(t, 0, code)
	assert.Contains(t, out, "would stage .claude/skills/starboard/SKILL.md as ")

	write(t, dir, map[string]string{".claude/skills/starboard-adopt/SKILL.md": "mine too\n"})
	_, _, errOut = run("--dir", dir, "skills", "install", "--agent", "claude-code")
	assert.Contains(t, errOut, "warning: 2 files were edited or not installed by Starboard")
}

func TestSkillsInstallErrors(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, map[string]string{"starboard.yaml": "version: 1\n"})

	code, _, errOut := run("--dir", dir, "skills", "install")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "starboard: no agents detected: pass --agent\n")

	code, _, errOut = run("--dir", dir, "skills", "install", "--agent", "vim")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "starboard skills install: unknown agent vim")

	code, _, errOut = run("--dir", dir, "skills", "install", "extra")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "skills install takes no arguments")

	code, _, errOut = run("--dir", t.TempDir(), "skills", "install", "--agent", "codex")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "no starboard.yaml found")

	code, _, errOut = run("--dir", filepath.Join(dir, "missing"), "skills", "install", "--agent", "codex")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "starboard: ")

	write(t, dir, map[string]string{"AGENTS.md": skills.EndMarker + "\n"})
	code, _, errOut = run("--dir", dir, "skills", "install", "--agent", "codex")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "AGENTS.md:1: ")
}

// hookProject writes a clean project with a vocabulary, and returns its
// directory.
func hookProject(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	write(t, dir, map[string]string{
		"starboard.yaml": "version: 1\nareas: [home]\nvocabularies:\n  requires:\n    file: vocab.yaml\n    select: .requires[]\n",
		"vocab.yaml":     "requires: [signed-in]\n",
		"docs/flows/screens.yaml": "screens:\n  home.main:\n    title: Home\n    area: home\n    purpose: Start here.\n" +
			"    presentation: root\n",
		"src/app.go": "package app\n",
	})
	code, _, errOut := run("--dir", dir, "fmt")
	require.Equal(t, 0, code, errOut)
	code, _, errOut = run("--dir", dir, "generate")
	require.Equal(t, 0, code, errOut)
	code, out, errOut := run("--dir", dir, "lint")
	require.Equal(t, 0, code, out+errOut)
	return dir
}

func editInput(file string) string {
	data, _ := json.Marshal(map[string]any{
		"hook_event_name": "PostToolUse",
		"tool_name":       "Edit",
		"tool_input":      map[string]any{"file_path": file},
	})
	return string(data)
}

func TestHookClaudeCode(t *testing.T) {
	dir := hookProject(t)

	// Clean reference file: exit 0, quiet.
	for _, f := range []string{"starboard.yaml", "docs/flows/screens.yaml", "vocab.yaml"} {
		code, out, errOut := runIn(editInput(filepath.Join(dir, f)), "--dir", dir, "hook", "claude-code")
		assert.Equal(t, 0, code, f+errOut)
		assert.Empty(t, out)
		assert.Empty(t, errOut)
	}

	// Not a reference file, or outside the project, or unreadable input:
	// exit 0 without looking.
	write(t, dir, map[string]string{"docs/flows/screens.yaml": "screens:\n  home.main: [\n"})
	for name, in := range map[string]string{
		"code file":       editInput(filepath.Join(dir, "src", "app.go")),
		"outside":         editInput(filepath.Join(t.TempDir(), "screens.yaml")),
		"nested flow dir": editInput(filepath.Join(dir, "docs", "flows", "flows", "x", "a.md")),
		"no file_path":    `{"tool_input":{}}`,
		"no tool_input":   `{}`,
	} {
		code, out, errOut := runIn(in, "--dir", dir, "hook", "claude-code")
		assert.Equal(t, 0, code, name)
		assert.Empty(t, out, name)
		assert.Empty(t, errOut, name)
	}

	// Input it cannot decode is noted and passed.
	for name, in := range map[string]string{"not json": "nope", "empty": ""} {
		code, out, errOut := runIn(in, "--dir", dir, "hook", "claude-code")
		assert.Equal(t, 0, code, name)
		assert.Empty(t, out, name)
		assert.Contains(t, errOut, "starboard hook: cannot read the hook input", name)
		assert.NotContains(t, strings.TrimSuffix(errOut, "\n"), "\n", "one line")
	}

	// A broken reference file: the findings go to stderr, exit 2.
	code, out, errOut := runIn(editInput(filepath.Join(dir, "docs", "flows", "screens.yaml")), "--dir", dir, "hook", "claude-code")
	assert.Equal(t, 2, code)
	assert.Empty(t, out)
	assert.Contains(t, errOut, "yaml-syntax")

	// A relative path is relative to the directory.
	code, _, errOut = runIn(editInput("docs/flows/screens.yaml"), "--dir", dir, "hook", "claude-code")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "yaml-syntax")
}

func TestHookClaudeCodeLintFindings(t *testing.T) {
	dir := hookProject(t)
	// Formats cleanly, but lint finds an error: an unknown area.
	write(t, dir, map[string]string{"docs/flows/flows/a.md": "---\nid: a\ntitle: A\nstatus: proposed\nactors: [person]\nentry: nope.screen\n---\n\n# A\n\n1. Open @nope.screen.\n"})
	code, out, errOut := runIn(editInput(filepath.Join(dir, "docs", "flows", "flows", "a.md")), "--dir", dir, "hook", "claude-code")
	assert.Equal(t, 2, code)
	assert.Empty(t, out)
	assert.Contains(t, errOut, "starboard lint found problems after this edit")
	assert.Contains(t, errOut, `"rule"`)
}

func TestHookClaudeCodeFormats(t *testing.T) {
	dir := hookProject(t)
	canonical := read(t, dir, "starboard.yaml")
	write(t, dir, map[string]string{"starboard.yaml": strings.Replace(canonical, "version: 1", "version:   1", 1)})
	code, _, errOut := runIn(editInput(filepath.Join(dir, "starboard.yaml")), "--dir", dir, "hook", "claude-code")
	assert.Equal(t, 0, code, errOut)
	assert.Equal(t, canonical, read(t, dir, "starboard.yaml"))
}

func TestHookClaudeCodeOutsideAProject(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, map[string]string{"starboard.yaml.txt": "x"})
	code, out, errOut := runIn(editInput(filepath.Join(dir, "starboard.yaml")), "--dir", dir, "hook", "claude-code")
	assert.Equal(t, 0, code)
	assert.Empty(t, out+errOut)

	code, _, errOut = runIn("{}", "--dir", dir, "hook", "claude-code", "extra")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "hook claude-code takes no arguments")
}

// TestHookClaudeCodeBrokenConfig: a starboard.yaml that cannot be read is
// still checked when it is the edited file, and nothing else is.
func TestHookClaudeCodeBrokenConfig(t *testing.T) {
	dir := hookProject(t)
	write(t, dir, map[string]string{"starboard.yaml": "version: [1\n"})
	code, _, errOut := runIn(editInput(filepath.Join(dir, "starboard.yaml")), "--dir", dir, "hook", "claude-code")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "yaml-syntax")

	code, _, _ = runIn(editInput(filepath.Join(dir, "docs", "flows", "screens.yaml")), "--dir", dir, "hook", "claude-code")
	assert.Equal(t, 0, code)
}

// TestHookClaudeCodeThroughASymlink: an edited path that reaches the
// project through a symbolic link is still in it.
func TestHookClaudeCodeThroughASymlink(t *testing.T) {
	dir := hookProject(t)
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(dir, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	write(t, dir, map[string]string{"docs/flows/screens.yaml": "screens:\n  home.main: [\n"})
	code, _, errOut := runIn(editInput(filepath.Join(link, "docs", "flows", "screens.yaml")), "--dir", dir, "hook", "claude-code")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "yaml-syntax")

	// A link to a file that does not exist is not in the project.
	code, _, _ = runIn(editInput(filepath.Join(link, "docs", "nope.yaml")), "--dir", dir, "hook", "claude-code")
	assert.Equal(t, 0, code)
}

// TestHookClaudeCodeFindsTheFilesProject: the project is the edited
// file's, wherever the hook runs; a relative path resolves against the
// input's cwd.
func TestHookClaudeCodeFindsTheFilesProject(t *testing.T) {
	dir := hookProject(t)
	write(t, dir, map[string]string{"docs/flows/screens.yaml": "screens:\n  home.main: [\n"})
	elsewhere := t.TempDir()

	code, _, errOut := runIn(editInput(filepath.Join(dir, "docs", "flows", "screens.yaml")), "--dir", elsewhere, "hook", "claude-code")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "yaml-syntax")

	in, _ := json.Marshal(map[string]any{"cwd": dir, "tool_input": map[string]any{"file_path": "docs/flows/screens.yaml"}})
	code, _, errOut = runIn(string(in), "--dir", elsewhere, "hook", "claude-code")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "yaml-syntax")

	// A file whose directory is gone falls back to the cwd's project.
	in, _ = json.Marshal(map[string]any{"cwd": dir, "tool_input": map[string]any{"file_path": "gone/x.md"}})
	code, _, _ = runIn(string(in), "--dir", elsewhere, "hook", "claude-code")
	assert.Equal(t, 0, code)

	// A large edit payload is read whole.
	big, _ := json.Marshal(map[string]any{
		"tool_input": map[string]any{"file_path": filepath.Join(dir, "docs", "flows", "screens.yaml"), "content": strings.Repeat("x", 3<<20)},
	})
	code, _, errOut = runIn(string(big), "--dir", elsewhere, "hook", "claude-code")
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "yaml-syntax")
}

func TestSkillsInstallReportsDroppedSkills(t *testing.T) {
	dir := t.TempDir()
	sum := func(s string) string {
		h := sha256.Sum256([]byte(s))
		return hex.EncodeToString(h[:])
	}
	write(t, dir, map[string]string{
		"starboard.yaml":                     "version: 1\n",
		".claude/skills/old/SKILL.md":        "old\n",
		".claude/skills/old-edited/SKILL.md": "edited\n",
		skills.LockFile: `{"version":1,"files":{".claude/skills/old/SKILL.md":"` + sum("old\n") +
			`",".claude/skills/old-edited/SKILL.md":"` + sum("before\n") + `"}}`,
	})

	code, out, errOut := run("--dir", dir, "skills", "install", "--agent", "claude-code", "--dry-run")
	assert.Equal(t, 0, code, errOut)
	assert.Contains(t, out, "would remove .claude/skills/old/SKILL.md (no longer shipped)\n")
	assert.Contains(t, out, "no longer shipped: .claude/skills/old-edited/SKILL.md (edited; delete it yourself)\n")
	assert.Contains(t, out, "4 written, 0 unchanged, 0 staged, 1 removed (dry run)\n")
	assert.FileExists(t, filepath.Join(dir, ".claude", "skills", "old", "SKILL.md"))

	code, out, _ = run("--dir", dir, "skills", "install", "--agent", "claude-code")
	assert.Equal(t, 0, code)
	assert.Contains(t, out, "removed .claude/skills/old/SKILL.md (no longer shipped)\n")
	assert.Contains(t, out, "no longer shipped: .claude/skills/old-edited/SKILL.md (edited; delete it yourself)\n")
	assert.NoFileExists(t, filepath.Join(dir, ".claude", "skills", "old", "SKILL.md"))
	assert.FileExists(t, filepath.Join(dir, ".claude", "skills", "old-edited", "SKILL.md"))
}

// TestHookClaudeCodeChecksGeneratedPages: a hand-edit of a generated page is
// part of the reference, so lint's generated-stale reports it.
func TestHookClaudeCodeChecksGeneratedPages(t *testing.T) {
	dir := hookProject(t)
	page := filepath.Join(dir, "docs", "flows", "generated", "app-map.md")
	write(t, dir, map[string]string{"docs/flows/generated/app-map.md": read(t, dir, "docs/flows/generated/app-map.md") + "\nhand-edited\n"})
	code, out, errOut := runIn(editInput(page), "--dir", dir, "hook", "claude-code")
	assert.Equal(t, 2, code)
	assert.Empty(t, out)
	assert.Contains(t, errOut, "generated-stale")
}

// TestHookClaudeCodeFmtProblems: fmt's report, a load error here, is
// worded as problems, not as a failure to format.
func TestHookClaudeCodeFmtProblems(t *testing.T) {
	dir := hookProject(t)
	write(t, dir, map[string]string{"docs/flows/screens.yaml": "screens:\n  home.main: [\n"})
	_, _, errOut := runIn(editInput(filepath.Join(dir, "docs", "flows", "screens.yaml")), "--dir", dir, "hook", "claude-code")
	assert.Contains(t, errOut, "starboard fmt reported problems after this edit; fix them:\n")
}
