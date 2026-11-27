// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package skills

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/rogpeppe/go-internal/txtar"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/osfs"
	"github.com/c65llc/starboard/internal/project"
	skillsfs "github.com/c65llc/starboard/skills"
)

var update = flag.Bool("update", false, "rewrite the golden files in testdata")

// fake is a small, fixed skill set, so the goldens do not move every time a
// real skill's text changes.
var fake = []skillsfs.Skill{
	{Name: "alpha", Description: "Use when testing alpha.", Body: "# Alpha\n\n## When to use\n\nAlways.\n"},
	{Name: "beta", Description: "Use when testing beta.", Body: "# Beta\n\n## Rules\n\n- Never.\n"},
}

// recorder is a WriteFS that counts the writes and removals it is asked for.
type recorder struct {
	project.MemFS
	writes []string
}

func (r *recorder) WriteFile(name string, data []byte) error {
	r.writes = append(r.writes, name)
	return r.MemFS.WriteFile(name, data)
}

func (r *recorder) Remove(name string) error {
	r.writes = append(r.writes, "rm "+name)
	return r.MemFS.Remove(name)
}

// archive renders m as a txtar archive, files sorted by name.
func archive(m project.MemFS) []byte {
	var a txtar.Archive
	for _, name := range slices.Sorted(maps.Keys(m)) {
		a.Files = append(a.Files, txtar.File{Name: name, Data: m[name]})
	}
	return txtar.Format(&a)
}

func sum(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func lockOf(t *testing.T, m project.MemFS) map[string]string {
	t.Helper()
	var l struct {
		Version int               `json:"version"`
		Files   map[string]string `json:"files"`
	}
	require.NoError(t, json.Unmarshal(m[LockFile], &l))
	assert.Equal(t, 1, l.Version)
	return l.Files
}

// TestInstallEachAgent: each agent's layout, compared with a golden of every
// file the install leaves, lock included.
func TestInstallEachAgent(t *testing.T) {
	for _, a := range Agents {
		t.Run(string(a), func(t *testing.T) {
			m := project.MemFS{}
			res, err := Install(m, []Agent{a}, fake, false)
			require.NoError(t, err)
			assert.Empty(t, res.Staged)
			assert.Empty(t, res.Unchanged)
			assert.NotEmpty(t, res.Written)
			assert.True(t, slices.IsSorted(res.Written))
			for _, p := range res.Written {
				assert.Contains(t, m, p)
			}

			got := archive(m)
			golden := filepath.Join("testdata", "install", string(a)+".txtar")
			if *update {
				require.NoError(t, os.WriteFile(golden, got, 0o600))
			}
			want, err := os.ReadFile(golden) //nolint:gosec // G304: a fixed testdata path
			require.NoError(t, err)
			assert.Equal(t, string(want), string(got))
		})
	}
}

func TestInstallPaths(t *testing.T) {
	m := project.MemFS{}
	res, err := Install(m, Agents, fake, false)
	require.NoError(t, err)
	assert.Equal(t, []string{
		".claude/skills/alpha/SKILL.md",
		".claude/skills/beta/SKILL.md",
		".cursor/commands/alpha.md",
		".cursor/commands/beta.md",
		".github/prompts/alpha.prompt.md",
		".github/prompts/beta.prompt.md",
		"AGENTS.md",
		"CONVENTIONS.md",
		"GEMINI.md",
	}, res.Written)
	assert.Equal(t, res.Written, slices.Sorted(maps.Keys(lockOf(t, m))))
}

// TestRenderClaudeCodeIsTheSourceFile: the real skills install for Claude
// Code byte for byte as they are written in skills/.
func TestRenderClaudeCodeIsTheSourceFile(t *testing.T) {
	for _, s := range skillsfs.All() {
		src, err := fs.ReadFile(skillsfs.FS, s.Name+".md")
		require.NoError(t, err)
		assert.Equal(t, string(src), Render(ClaudeCode, s), s.Name)
		assert.True(t, strings.HasPrefix(Render(Cursor, s), "---\ndescription: "+s.Description+"\n---\n\n"))
		assert.True(t, strings.HasSuffix(Render(Copilot, s), s.Body))
	}
}

func TestRenderQuotesADescriptionYAMLWouldMisread(t *testing.T) {
	s := skillsfs.Skill{Name: "x", Description: "Use when: always.", Body: "# X\n"}
	assert.Equal(t, "---\ndescription: \"Use when: always.\"\n---\n\n# X\n", Render(Cursor, s))
	s.Description = "#1 choice."
	assert.Equal(t, "---\nname: x\ndescription: \"#1 choice.\"\n---\n\n# X\n", Render(ClaudeCode, s))
	assert.Equal(t, "plain", yamlScalar("plain"))
	for _, v := range []string{"", "- a", "a #b", "'q", "a: b", "*x", "true", "null", "1.5", "a\tb"} {
		assert.NotEqual(t, v, yamlScalar(v), v)
	}
}

func TestInstallIdempotent(t *testing.T) {
	m := project.MemFS{}
	first, err := Install(m, Agents, fake, false)
	require.NoError(t, err)

	r := &recorder{MemFS: m}
	res, err := Install(r, Agents, fake, false)
	require.NoError(t, err)
	assert.Empty(t, r.writes, "a re-run with nothing changed writes nothing")
	assert.Empty(t, res.Written)
	assert.Empty(t, res.Staged)
	assert.Equal(t, first.Written, res.Unchanged)
}

// TestInstallUpdatesWhatItOwns: a new release's text replaces an installed
// file that was not edited, and its lock entry follows.
func TestInstallUpdatesWhatItOwns(t *testing.T) {
	m := project.MemFS{}
	_, err := Install(m, []Agent{ClaudeCode, Codex}, fake, false)
	require.NoError(t, err)

	next := slices.Clone(fake)
	next[0].Body = "# Alpha\n\nNew text.\n"
	res, err := Install(m, []Agent{ClaudeCode, Codex}, next, false)
	require.NoError(t, err)
	assert.Equal(t, []string{".claude/skills/alpha/SKILL.md", "AGENTS.md"}, res.Written)
	assert.Equal(t, []string{".claude/skills/beta/SKILL.md"}, res.Unchanged)
	assert.Contains(t, string(m[".claude/skills/alpha/SKILL.md"]), "New text.")
	assert.Contains(t, string(m["AGENTS.md"]), "New text.")
	lock := lockOf(t, m)
	assert.Equal(t, sum(string(m[".claude/skills/alpha/SKILL.md"])), lock[".claude/skills/alpha/SKILL.md"])
}

// TestInstallStagesEditedFile: Review Focus 1. An installed skill the
// person edited is kept; the new version is staged under .starboard/pending/
// and reported, and the install still succeeds.
func TestInstallStagesEditedFile(t *testing.T) {
	m := project.MemFS{}
	_, err := Install(m, []Agent{ClaudeCode}, fake, false)
	require.NoError(t, err)
	lockBefore := string(m[LockFile])

	const dest = ".claude/skills/alpha/SKILL.md"
	edited := string(m[dest]) + "\nMy own note.\n"
	m[dest] = []byte(edited)

	next := slices.Clone(fake)
	next[0].Body = "# Alpha\n\nNew text.\n"
	res, err := Install(m, []Agent{ClaudeCode}, next, false)
	require.NoError(t, err)
	assert.Equal(t, []string{dest}, res.Staged)
	assert.Empty(t, res.Written)
	assert.Equal(t, edited, string(m[dest]), "the edited file is never overwritten")
	assert.Equal(t, Render(ClaudeCode, next[0]), string(m[PendingDir+"/"+dest]))
	assert.Equal(t, lockBefore, string(m[LockFile]), "the lock still records what Starboard installed")

	// Staged again on the next run, without writing the same pending file.
	r := &recorder{MemFS: m}
	res, err = Install(r, []Agent{ClaudeCode}, next, false)
	require.NoError(t, err)
	assert.Equal(t, []string{dest}, res.Staged)
	assert.Empty(t, r.writes)

	// Accepting the staged version (copying it over) makes the file
	// Starboard's again.
	m[dest] = m[PendingDir+"/"+dest]
	res, err = Install(m, []Agent{ClaudeCode}, next, false)
	require.NoError(t, err)
	assert.Empty(t, res.Staged)
	assert.Contains(t, res.Unchanged, dest)
	assert.Equal(t, sum(string(m[dest])), lockOf(t, m)[dest])
}

// TestInstallStagesUnrecordedExisting: a destination that exists but that
// the lock does not record is the project's own file, and is never
// overwritten, even with no lock at all.
func TestInstallStagesUnrecordedExisting(t *testing.T) {
	m := project.MemFS{
		".cursor/commands/alpha.md": []byte("my own alpha command\n"),
	}
	res, err := Install(m, []Agent{Cursor}, fake, false)
	require.NoError(t, err)
	assert.Equal(t, []string{".cursor/commands/alpha.md"}, res.Staged)
	assert.Equal(t, []string{".cursor/commands/beta.md"}, res.Written)
	assert.Equal(t, "my own alpha command\n", string(m[".cursor/commands/alpha.md"]))
	assert.Equal(t, Render(Cursor, fake[0]), string(m[PendingDir+"/.cursor/commands/alpha.md"]))
	assert.NotContains(t, lockOf(t, m), ".cursor/commands/alpha.md")
}

// TestInstallAdoptsAnIdenticalFile: an unrecorded file that already holds
// exactly what Starboard would write is recorded, not staged.
func TestInstallAdoptsAnIdenticalFile(t *testing.T) {
	m := project.MemFS{".cursor/commands/alpha.md": []byte(Render(Cursor, fake[0]))}
	res, err := Install(m, []Agent{Cursor}, fake, false)
	require.NoError(t, err)
	assert.Equal(t, []string{".cursor/commands/alpha.md"}, res.Unchanged)
	assert.Contains(t, lockOf(t, m), ".cursor/commands/alpha.md")
}

// TestInstallIgnoresCRLF: a checkout that turned the installed files into
// CRLF has not edited them.
func TestInstallIgnoresCRLF(t *testing.T) {
	m := project.MemFS{}
	_, err := Install(m, []Agent{Copilot, Gemini}, fake, false)
	require.NoError(t, err)
	for name, data := range m {
		m[name] = []byte(strings.ReplaceAll(string(data), "\n", "\r\n"))
	}
	r := &recorder{MemFS: m}
	res, err := Install(r, []Agent{Copilot, Gemini}, fake, false)
	require.NoError(t, err)
	assert.Empty(t, r.writes)
	assert.Empty(t, res.Staged)

	next := slices.Clone(fake)
	next[1].Body = "# Beta\n\nNew.\n"
	_, err = Install(m, []Agent{Gemini}, next, false)
	require.NoError(t, err)
	got := string(m["GEMINI.md"])
	assert.Contains(t, got, "#### Beta\r\n\r\nNew.\r\n", "a CRLF file keeps CRLF")
	assert.NotContains(t, strings.ReplaceAll(got, "\r\n", ""), "\n")
}

func TestInstallDryRunWritesNothing(t *testing.T) {
	m := project.MemFS{".claude/skills/alpha/SKILL.md": []byte("mine\n")}
	r := &recorder{MemFS: m}
	res, err := Install(r, []Agent{ClaudeCode, Aider}, fake, true)
	require.NoError(t, err)
	assert.Empty(t, r.writes)
	assert.Equal(t, []string{".claude/skills/beta/SKILL.md", "CONVENTIONS.md"}, res.Written)
	assert.Equal(t, []string{".claude/skills/alpha/SKILL.md"}, res.Staged)
	assert.NotContains(t, m, LockFile)
}

func TestInstallDeduplicatesAgents(t *testing.T) {
	m := project.MemFS{}
	res, err := Install(m, []Agent{Codex, Codex}, fake, false)
	require.NoError(t, err)
	assert.Equal(t, []string{"AGENTS.md"}, res.Written)
}

func TestInstallNothingWritesNothing(t *testing.T) {
	r := &recorder{MemFS: project.MemFS{}}
	res, err := Install(r, nil, fake, false)
	require.NoError(t, err)
	assert.Equal(t, Result{}, res)
	assert.Empty(t, r.writes)
}

func TestInstallKeepsOtherLockEntries(t *testing.T) {
	m := project.MemFS{}
	_, err := Install(m, []Agent{Codex}, fake, false)
	require.NoError(t, err)
	_, err = Install(m, []Agent{Aider}, fake, false)
	require.NoError(t, err)
	assert.Equal(t, []string{"AGENTS.md", "CONVENTIONS.md"}, slices.Sorted(maps.Keys(lockOf(t, m))))
}

func TestInstallRefusesABadLock(t *testing.T) {
	for name, lock := range map[string]string{
		"not json":      "{",
		"wrong version": `{"version":2,"files":{}}`,
	} {
		t.Run(name, func(t *testing.T) {
			m := project.MemFS{LockFile: []byte(lock)}
			r := &recorder{MemFS: m}
			_, err := Install(r, []Agent{Codex}, fake, false)
			require.Error(t, err)
			assert.Contains(t, err.Error(), LockFile)
			assert.Empty(t, r.writes)
		})
	}
}

func TestInstallRefusesAnUnknownAgent(t *testing.T) {
	_, err := Install(project.MemFS{}, []Agent{"emacs"}, fake, false)
	assert.EqualError(t, err, `unknown agent "emacs"`)
}

// failFS fails every write, and the reads it is told to.
type failFS struct {
	project.MemFS
	readFail string
	writeErr bool
}

var errBoom = errors.New("boom")

func (f failFS) Open(name string) (fs.File, error) {
	if name == f.readFail {
		return nil, errBoom
	}
	return f.MemFS.Open(name)
}

func (f failFS) WriteFile(name string, data []byte) error {
	if f.writeErr {
		return errBoom
	}
	return f.MemFS.WriteFile(name, data)
}

func TestInstallReportsIOErrors(t *testing.T) {
	cases := map[string]failFS{
		"read lock":        {MemFS: project.MemFS{}, readFail: LockFile},
		"read destination": {MemFS: project.MemFS{}, readFail: ".claude/skills/alpha/SKILL.md"},
		"read section":     {MemFS: project.MemFS{}, readFail: "AGENTS.md"},
		"read pending":     {MemFS: project.MemFS{".claude/skills/alpha/SKILL.md": []byte("x")}, readFail: PendingDir + "/.claude/skills/alpha/SKILL.md"},
		"write":            {MemFS: project.MemFS{}, writeErr: true},
		"write pending":    {MemFS: project.MemFS{".claude/skills/alpha/SKILL.md": []byte("x")}, writeErr: true},
	}
	for name, f := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := Install(f, []Agent{ClaudeCode, Codex}, fake, false)
			assert.ErrorIs(t, err, errBoom)
		})
	}

	// A lock write that fails after the skills were written.
	m := project.MemFS{}
	_, err := Install(lockFails{m}, []Agent{Codex}, fake, false)
	assert.ErrorIs(t, err, errBoom)
}

type lockFails struct{ project.MemFS }

func (l lockFails) WriteFile(name string, data []byte) error {
	if name == LockFile {
		return errBoom
	}
	return l.MemFS.WriteFile(name, data)
}

// TestSectionMarkers: Review Focus 2.
func TestSectionMarkers(t *testing.T) {
	section := func(m project.MemFS) string {
		_, err := Install(m, []Agent{Codex}, fake, false)
		require.NoError(t, err)
		return string(m["AGENTS.md"])
	}
	block := section(project.MemFS{})
	require.True(t, strings.HasPrefix(block, StartMarker+"\n"))
	require.True(t, strings.HasSuffix(block, EndMarker+"\n"))
	for _, s := range fake {
		assert.Contains(t, block, "### "+s.Name+"\n\n"+s.Description+"\n\n"+demote(s.Body))
	}

	t.Run("without markers, the section is appended", func(t *testing.T) {
		got := section(project.MemFS{"AGENTS.md": []byte("# Mine\n\nKeep this.\n")})
		assert.Equal(t, "# Mine\n\nKeep this.\n\n"+block, got)

		got = section(project.MemFS{"AGENTS.md": []byte("# No newline")})
		assert.Equal(t, "# No newline\n\n"+block, got)

		got = section(project.MemFS{"AGENTS.md": []byte("")})
		assert.Equal(t, block, got)
	})

	t.Run("content outside the markers is never touched", func(t *testing.T) {
		m := project.MemFS{"AGENTS.md": []byte("# Mine\n\n" + block + "\n## After\n\nAlso mine.\n")}
		_, err := Install(m, []Agent{Codex}, fake, false)
		require.NoError(t, err)

		// The person edits outside the section: nothing is staged.
		m["AGENTS.md"] = []byte(strings.Replace(string(m["AGENTS.md"]), "Also mine.", "Edited, still mine.", 1))
		next := slices.Clone(fake)
		next[0].Body = "# Alpha\n\nNew.\n"
		res, err := Install(m, []Agent{Codex}, next, false)
		require.NoError(t, err)
		assert.Equal(t, []string{"AGENTS.md"}, res.Written)
		got := string(m["AGENTS.md"])
		assert.True(t, strings.HasPrefix(got, "# Mine\n\n"+StartMarker+"\n"))
		assert.True(t, strings.HasSuffix(got, EndMarker+"\n\n## After\n\nEdited, still mine.\n"))
		assert.Contains(t, got, "# Alpha\n\nNew.\n")
	})

	t.Run("an edit inside the markers stages the whole file", func(t *testing.T) {
		m := project.MemFS{}
		_, err := Install(m, []Agent{Codex}, fake, false)
		require.NoError(t, err)
		edited := strings.Replace(string(m["AGENTS.md"]), "Always.", "Sometimes.", 1)
		m["AGENTS.md"] = []byte(edited)
		next := slices.Clone(fake)
		next[1].Body = "# Beta\n\nNew.\n"
		res, err := Install(m, []Agent{Codex}, next, false)
		require.NoError(t, err)
		assert.Equal(t, []string{"AGENTS.md"}, res.Staged)
		assert.Equal(t, edited, string(m["AGENTS.md"]))
		assert.Contains(t, string(m[PendingDir+"/AGENTS.md"]), "# Beta\n\nNew.\n")
		assert.Contains(t, string(m[PendingDir+"/AGENTS.md"]), "Always.")
	})

	t.Run("an unrecorded section is the project's own", func(t *testing.T) {
		mine := "# Mine\n" + StartMarker + "\nhand-written\n" + EndMarker + "\n"
		m := project.MemFS{"AGENTS.md": []byte(mine)}
		res, err := Install(m, []Agent{Codex}, fake, false)
		require.NoError(t, err)
		assert.Equal(t, []string{"AGENTS.md"}, res.Staged)
		assert.Equal(t, mine, string(m["AGENTS.md"]))
	})

	bad := map[string]struct{ text, err string }{
		"duplicated start": {
			"a\n" + StartMarker + "\nx\n" + StartMarker + "\n" + EndMarker + "\n",
			"AGENTS.md:4: a second " + StartMarker + " (the first is on line 2)",
		},
		"duplicated section": {
			StartMarker + "\n" + EndMarker + "\n\n" + StartMarker + "\n" + EndMarker + "\n",
			"AGENTS.md:4: a second " + StartMarker + " (the first is on line 1)",
		},
		"end without start": {
			"a\n\n" + EndMarker + "\n",
			"AGENTS.md:3: " + EndMarker + " without a " + StartMarker + " before it",
		},
		"start without end": {
			"a\n" + StartMarker + "\nb\n",
			"AGENTS.md:2: " + StartMarker + " is never closed by " + EndMarker,
		},
		"unclosed fence": {
			"# Mine\n\n```bash\necho unclosed\n",
			"AGENTS.md:3: a code fence opened here is never closed",
		},
		"unclosed fence after the section": {
			StartMarker + "\n" + EndMarker + "\n~~~\n",
			"AGENTS.md:3: a code fence opened here is never closed",
		},
		"second end": {
			StartMarker + "\n" + EndMarker + "\n" + EndMarker + "\n",
			"AGENTS.md:3: " + EndMarker + " without a " + StartMarker + " before it",
		},
	}
	for name, tc := range bad {
		t.Run(name, func(t *testing.T) {
			m := project.MemFS{"AGENTS.md": []byte(tc.text)}
			r := &recorder{MemFS: m}
			_, err := Install(r, []Agent{ClaudeCode, Codex}, fake, false)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.err)
			assert.Empty(t, r.writes, "nothing is written when a section file is malformed")
			assert.Equal(t, tc.text, string(m["AGENTS.md"]))
		})
	}
}

// TestLockUsesSlashPaths: Review Focus 5. Installed into a real directory
// on each CI OS, the lock's keys are slash paths and its bytes are the
// same everywhere.
func TestLockUsesSlashPaths(t *testing.T) {
	dir := t.TempDir()
	d, err := osfs.Open(dir)
	require.NoError(t, err)
	defer func() { _ = d.Close() }()
	_, err = Install(d, Agents, fake, false)
	require.NoError(t, err)

	data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(LockFile))) //nolint:gosec // G304: a test temp dir
	require.NoError(t, err)
	assert.NotContains(t, string(data), `\\`)
	assert.NotContains(t, string(data), "\r")

	m := project.MemFS{}
	_, err = Install(m, Agents, fake, false)
	require.NoError(t, err)
	assert.Equal(t, string(m[LockFile]), string(data))
	assert.FileExists(t, filepath.Join(dir, ".claude", "skills", "alpha", "SKILL.md"))
}

func TestDetect(t *testing.T) {
	assert.Empty(t, Detect(fstest.MapFS{"README.md": {}}))
	all := fstest.MapFS{
		".claude/settings.json":       {},
		".cursor/rules/x.mdc":         {},
		".github/prompts/x.prompt.md": {},
		"AGENTS.md":                   {},
		"GEMINI.md":                   {},
		"CONVENTIONS.md":              {},
		"docs/flows/screens.yaml":     {},
		".starboard/skills.lock.json": {},
	}
	assert.Equal(t, Agents, Detect(all))
	// A file where a directory is expected, or a directory where a file
	// is, detects nothing.
	assert.Empty(t, Detect(fstest.MapFS{".claude": {}, "AGENTS.md/x": {}}))
	assert.Equal(t, []Agent{Gemini}, Detect(fstest.MapFS{"GEMINI.md": {}}))
	// Copilot needs its own files, not just the .github/ every repo has.
	assert.Empty(t, Detect(fstest.MapFS{".github/workflows/ci.yml": {}}))
	assert.Equal(t, []Agent{Copilot}, Detect(fstest.MapFS{".github/copilot-instructions.md": {}}))
	assert.Equal(t, []Agent{Copilot}, Detect(fstest.MapFS{".github/prompts/a.prompt.md": {}}))
	assert.Empty(t, Detect(fstest.MapFS{".github/prompts": {}, ".github/copilot-instructions.md/x": {}}))
}

func TestParseAgent(t *testing.T) {
	for _, a := range Agents {
		got, err := ParseAgent(string(a))
		require.NoError(t, err)
		assert.Equal(t, a, got)
	}
	_, err := ParseAgent("vim")
	assert.EqualError(t, err, "unknown agent vim; use claude-code, cursor, copilot, codex, gemini or aider")
}

// TestInstallRetiresDroppedSkills: a skill a later release no longer ships
// is removed where it was installed unedited, kept and reported where it
// was edited, and simply left out of a section.
func TestInstallRetiresDroppedSkills(t *testing.T) {
	agents := []Agent{ClaudeCode, Cursor, Copilot, Codex}
	m := project.MemFS{}
	_, err := Install(m, agents, fake, false)
	require.NoError(t, err)
	const edited = ".cursor/commands/beta.md"
	m[edited] = []byte("my beta\n")
	only := fake[:1] // beta is dropped

	r := &recorder{MemFS: m}
	res, err := Install(r, agents, only, true)
	require.NoError(t, err)
	assert.Empty(t, r.writes, "a dry run reports without acting")
	assert.Equal(t, []string{".claude/skills/beta/SKILL.md", ".github/prompts/beta.prompt.md"}, res.Removed)
	assert.Equal(t, []string{edited}, res.Retired)

	res, err = Install(m, agents, only, false)
	require.NoError(t, err)
	assert.Equal(t, []string{".claude/skills/beta/SKILL.md", ".github/prompts/beta.prompt.md"}, res.Removed)
	assert.Equal(t, []string{edited}, res.Retired)
	assert.Equal(t, []string{"AGENTS.md"}, res.Written)
	assert.NotContains(t, m, ".claude/skills/beta/SKILL.md")
	assert.NotContains(t, m, ".github/prompts/beta.prompt.md")
	assert.Equal(t, "my beta\n", string(m[edited]))
	assert.NotContains(t, string(m["AGENTS.md"]), "### beta")
	lock := lockOf(t, m)
	assert.NotContains(t, lock, ".claude/skills/beta/SKILL.md")
	assert.Contains(t, lock, edited, "an edited file stays recorded, and reported, until it is deleted")

	// Deleting the edited file lets the next install forget it.
	delete(m, edited)
	res, err = Install(m, agents, only, false)
	require.NoError(t, err)
	assert.Empty(t, res.Retired)
	assert.Empty(t, res.Removed)
	assert.NotContains(t, lockOf(t, m), edited)

	// An agent not being installed keeps its files.
	m = project.MemFS{}
	_, err = Install(m, []Agent{ClaudeCode, Cursor}, fake, false)
	require.NoError(t, err)
	res, err = Install(m, []Agent{ClaudeCode}, only, false)
	require.NoError(t, err)
	assert.Equal(t, []string{".claude/skills/beta/SKILL.md"}, res.Removed)
	assert.Contains(t, m, ".cursor/commands/beta.md")
}

func TestInstallRetireIOErrors(t *testing.T) {
	m := project.MemFS{}
	_, err := Install(m, []Agent{ClaudeCode}, fake, false)
	require.NoError(t, err)
	_, err = Install(failFS{MemFS: m, readFail: ".claude/skills/beta/SKILL.md"}, []Agent{ClaudeCode}, fake[:1], false)
	assert.ErrorIs(t, err, errBoom)
	_, err = Install(removeFails{m}, []Agent{ClaudeCode}, fake[:1], false)
	assert.ErrorIs(t, err, errBoom)
}

type removeFails struct{ project.MemFS }

func (r removeFails) Remove(string) error { return errBoom }

func TestSkillOf(t *testing.T) {
	for p, want := range map[string]string{
		".claude/skills/x/SKILL.md":    "x",
		".cursor/commands/x.md":        "x",
		".github/prompts/x.prompt.md":  "x",
		".claude/skills/a/b/SKILL.md":  "",
		".claude/skills//SKILL.md":     "",
		".cursor/commands/x.txt":       "",
		".cursor/commands/Bad_Name.md": "",
		".claude/skills/-x/SKILL.md":   "",
		"AGENTS.md":                    "",
	} {
		var got string
		for _, a := range []Agent{ClaudeCode, Cursor, Copilot} {
			if name, ok := skillOf(a, p); ok {
				got = name
			}
		}
		assert.Equal(t, want, got, p)
	}
}

func TestDemote(t *testing.T) {
	in := "# T\n\n## When\n\n### Sub\n\n#### Deep\n\n#\n#tag\n####### seven\n```md\n# not a heading\n```\ntext # not\n"
	want := "#### T\n\n##### When\n\n###### Sub\n\n###### Deep\n\n####\n#tag\n####### seven\n```md\n# not a heading\n```\ntext # not\n"
	assert.Equal(t, want, demote(in))
	assert.Equal(t, "####", demote("#"))
}

// TestDemoteFencesFollowCommonMark: a fence closes only on a run of its own
// character at least as long as the opener, a line indented four or more
// spaces is not a fence, and CRLF lines are headings like LF ones.
func TestDemoteFencesFollowCommonMark(t *testing.T) {
	for name, tc := range map[string]struct{ in, want string }{
		"shorter run inside a longer fence": {
			"````md\n```\n# code\n````\n# T\n",
			"````md\n```\n# code\n````\n#### T\n",
		},
		"backticks inside a tilde fence": {
			"~~~\n```\n# code\n~~~\n# T\n",
			"~~~\n```\n# code\n~~~\n#### T\n",
		},
		"tildes inside a backtick fence": {
			"```\n~~~\n# code\n```\n# T\n",
			"```\n~~~\n# code\n```\n#### T\n",
		},
		"a closer with an info string does not close": {
			"```\n``` md\n# code\n```\n# T\n",
			"```\n``` md\n# code\n```\n#### T\n",
		},
		"indented four spaces is code, not a fence": {
			"    ```\n# T\n",
			"    ```\n#### T\n",
		},
		"indented three spaces is a fence": {
			"   ```\n# code\n   ```\n# T\n",
			"   ```\n# code\n   ```\n#### T\n",
		},
		"CRLF": {
			"# T\r\n\r\n## W\r\n#\r\n```\r\n# code\r\n```\r\n",
			"#### T\r\n\r\n##### W\r\n####\r\n```\r\n# code\r\n```\r\n",
		},
	} {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, tc.want, demote(tc.in))
		})
	}
}

// TestFindMarkersFencesFollowCommonMark: a shorter or other-character run
// inside a fence neither closes it nor leaves the file "unclosed", and a
// line indented four spaces never opens one.
func TestFindMarkersFencesFollowCommonMark(t *testing.T) {
	for name, text := range map[string]string{
		"shorter run inside":   "````\n```\n````\n" + StartMarker + "\nx\n" + EndMarker + "\n",
		"other character":      "~~~\n```\n~~~\n" + StartMarker + "\nx\n" + EndMarker + "\n",
		"indented four spaces": "    ```\n" + StartMarker + "\nx\n" + EndMarker + "\n",
		"CRLF":                 "```\r\n" + StartMarker + "\r\n```\r\n" + StartMarker + "\r\nx\r\n" + EndMarker + "\r\n",
	} {
		t.Run(name, func(t *testing.T) {
			lines := strings.SplitAfter(text, "\n")
			start, end, err := findMarkers("AGENTS.md", lines)
			require.NoError(t, err)
			assert.Equal(t, StartMarker, strings.TrimSpace(lines[start]))
			assert.Equal(t, EndMarker, strings.TrimSpace(lines[end]))
		})
	}
	_, _, err := findMarkers("AGENTS.md", strings.SplitAfter("````\n```\n", "\n"))
	assert.EqualError(t, err, "AGENTS.md:1: a code fence opened here is never closed")
}

func TestSectionMarkersBOMAndFences(t *testing.T) {
	m := project.MemFS{}
	_, err := Install(m, []Agent{Codex}, fake, false)
	require.NoError(t, err)
	// A BOM before a line-1 start marker still finds it.
	m["AGENTS.md"] = append([]byte("\uFEFF"), m["AGENTS.md"]...)
	r := &recorder{MemFS: m}
	res, err := Install(r, []Agent{Codex}, fake, false)
	require.NoError(t, err)
	assert.Equal(t, []string{"AGENTS.md"}, res.Unchanged)
	assert.Empty(t, r.writes)

	// Markers quoted in fenced code are text, not markers.
	doc := "# Mine\n\n```markdown\n" + StartMarker + "\n" + EndMarker + "\n" + EndMarker + "\n```\n"
	m = project.MemFS{"AGENTS.md": []byte(doc)}
	res, err = Install(m, []Agent{Codex}, fake, false)
	require.NoError(t, err)
	assert.Equal(t, []string{"AGENTS.md"}, res.Written)
	assert.True(t, strings.HasPrefix(string(m["AGENTS.md"]), doc+"\n"+StartMarker+"\n"))
}

// TestGuideDetectionTable pins the guide's detection table to detectors.
func TestGuideDetectionTable(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "docs", "guides", "agents.md"))
	require.NoError(t, err)
	for _, a := range Agents {
		found := make([]string, len(detectors[a]))
		for i, d := range detectors[a] {
			found[i] = "`" + d + "`"
		}
		assert.Contains(t, string(data), "\n| "+strings.Join(found, " or ")+" | `"+string(a)+"` |", a)
	}
}

// TestInstallUnclosedFenceIsNeverAppendedTwice: a file whose fence never
// closes is refused on every run, so no install appends a second section
// that the next run could not find.
func TestInstallUnclosedFenceIsNeverAppendedTwice(t *testing.T) {
	doc := "# Mine\n\n```bash\necho unclosed\n"
	m := project.MemFS{"AGENTS.md": []byte(doc)}
	for range 2 {
		r := &recorder{MemFS: m}
		_, err := Install(r, []Agent{Codex}, fake, false)
		require.Error(t, err)
		assert.Empty(t, r.writes)
		assert.Equal(t, doc, string(m["AGENTS.md"]))
	}
	// Once the fence is closed, the section is appended once, and a re-run
	// writes nothing.
	m["AGENTS.md"] = []byte(doc + "```\n")
	res, err := Install(m, []Agent{Codex}, fake, false)
	require.NoError(t, err)
	assert.Equal(t, []string{"AGENTS.md"}, res.Written)
	r := &recorder{MemFS: m}
	res, err = Install(r, []Agent{Codex}, fake, false)
	require.NoError(t, err)
	assert.Equal(t, []string{"AGENTS.md"}, res.Unchanged)
	assert.Empty(t, r.writes)
	assert.Equal(t, 1, strings.Count(string(m["AGENTS.md"]), StartMarker))
}

// TestInstallIgnoresLockEntriesThatAreNotSkills: a lock path in a skill
// directory whose name no skill could have is not retired, and does not
// fail the install.
func TestInstallIgnoresLockEntriesThatAreNotSkills(t *testing.T) {
	m := project.MemFS{}
	_, err := Install(m, []Agent{Cursor}, fake, false)
	require.NoError(t, err)
	m[".cursor/commands/My_Notes.md"] = []byte("mine\n")
	m[LockFile] = []byte(strings.Replace(string(m[LockFile]), `"files": {`, `"files": {
    ".cursor/commands/My_Notes.md": "0000",`, 1))
	res, err := Install(m, []Agent{Cursor}, fake, false)
	require.NoError(t, err)
	assert.Empty(t, res.Removed)
	assert.Empty(t, res.Retired)
	assert.Contains(t, m, ".cursor/commands/My_Notes.md")
}
