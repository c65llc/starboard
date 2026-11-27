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
	assert.Contains(t, got, "# Beta\r\n\r\nNew.\r\n", "a CRLF file keeps CRLF")
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
		assert.Contains(t, block, "### "+s.Name+"\n\n"+s.Description+"\n\n"+s.Body)
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
		".github/workflows/ci.yml":    {},
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
