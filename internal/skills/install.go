// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package skills installs Starboard's agent skills (the embedded files in
// the top-level skills package) into a project, in each agent's own shape,
// and prints the hook configuration that runs fmt and lint after an agent's
// edits.
//
// Claude Code, Cursor and Copilot get one file per skill. Codex, Gemini and
// Aider read one instructions file each, so they get one section in it,
// between StartMarker and EndMarker, holding every skill; the rest of that
// file is never touched.
//
// Installed files are owned through LockFile, which records the SHA-256 of
// every file (for a section file, of the section between the markers) that
// Starboard wrote. A destination that exists but is not recorded, or whose
// hash no longer matches, was written or edited by someone else: it is
// never overwritten, and the new version is staged under PendingDir
// instead. Hashes ignore CRLF, so a Windows checkout is not an edit.
package skills

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/c65llc/starboard/internal/project"
	skillsfs "github.com/c65llc/starboard/skills"
)

// Agent is a coding agent the skills can be installed for.
type Agent string

// The agents, by the name --agent takes.
const (
	ClaudeCode Agent = "claude-code"
	Cursor     Agent = "cursor"
	Copilot    Agent = "copilot"
	Codex      Agent = "codex"
	Gemini     Agent = "gemini"
	Aider      Agent = "aider"
)

// Agents is every agent, in the order Install and Detect report them.
var Agents = []Agent{ClaudeCode, Cursor, Copilot, Codex, Gemini, Aider}

// The files Install keeps.
const (
	LockFile   = ".starboard/skills.lock.json"
	PendingDir = ".starboard/pending"
)

// The lines that delimit the skills section in a section agent's file.
const (
	StartMarker = "<!-- starboard:skills:start -->"
	EndMarker   = "<!-- starboard:skills:end -->"
)

// sectionFiles is the file each section agent reads.
var sectionFiles = map[Agent]string{Codex: "AGENTS.md", Gemini: "GEMINI.md", Aider: "CONVENTIONS.md"}

// detectors are what marks an agent as in use in a project: any of a
// directory (a trailing slash) or a file, relative to the project root.
// Copilot needs more than .github/, which nearly every GitHub repo has.
var detectors = map[Agent][]string{
	ClaudeCode: {".claude/"},
	Cursor:     {".cursor/"},
	Copilot:    {".github/copilot-instructions.md", ".github/prompts/"},
	Codex:      {"AGENTS.md"},
	Gemini:     {"GEMINI.md"},
	Aider:      {"CONVENTIONS.md"},
}

// agentList is the agents as an error message lists them.
func agentList() string {
	names := make([]string, len(Agents))
	for i, a := range Agents {
		names[i] = string(a)
	}
	return strings.Join(names[:len(names)-1], ", ") + " or " + names[len(names)-1]
}

// ParseAgent returns the agent called name.
func ParseAgent(name string) (Agent, error) {
	if slices.Contains(Agents, Agent(name)) {
		return Agent(name), nil
	}
	return "", fmt.Errorf("unknown agent %s; use %s", name, agentList())
}

// Detect returns the agents the project at the root of fsys appears to use,
// in Agents order: .claude/ means Claude Code, .cursor/ Cursor,
// .github/copilot-instructions.md or .github/prompts/ Copilot, and
// AGENTS.md, GEMINI.md and CONVENTIONS.md Codex, Gemini and Aider.
func Detect(fsys fs.FS) []Agent {
	var out []Agent
	for _, a := range Agents {
		for _, marker := range detectors[a] {
			name, wantDir := strings.CutSuffix(marker, "/")
			if fi, err := fs.Stat(fsys, name); err == nil && fi.IsDir() == wantDir {
				out = append(out, a)
				break
			}
		}
	}
	return out
}

// yamlPlain is a scalar YAML reads back as the same string when written
// without quotes.
var yamlPlain = regexp.MustCompile(`^[A-Za-z0-9(][^\t]*$`)

// yamlScalar is s as a YAML scalar: plain when that reads back as s, else
// double-quoted.
func yamlScalar(s string) string {
	reserved := map[string]bool{"true": true, "false": true, "null": true, "yes": true, "no": true, "on": true, "off": true, "~": true}
	_, numErr := strconv.ParseFloat(s, 64)
	if yamlPlain.MatchString(s) && !strings.Contains(s, ": ") && !strings.Contains(s, " #") &&
		!strings.HasSuffix(s, ":") && !reserved[strings.ToLower(s)] && numErr != nil {
		return s
	}
	return strconv.Quote(s)
}

// Render is skill s as agent a reads it. Claude Code keeps the front matter
// (name and description); Cursor and Copilot take a description only, their
// name being the file's. The body is the skill's, verbatim. A section
// agent's rendering is the skill's subsection of the section.
func Render(a Agent, s skillsfs.Skill) string {
	switch a {
	case ClaudeCode:
		return "---\nname: " + s.Name + "\ndescription: " + yamlScalar(s.Description) + "\n---\n\n" + s.Body
	case Cursor, Copilot:
		return "---\ndescription: " + yamlScalar(s.Description) + "\n---\n\n" + s.Body
	}
	return "### " + s.Name + "\n\n" + s.Description + "\n\n" + demote(s.Body)
}

// demote moves every ATX heading in body three levels down, to at most
// level 6, so a skill nests under its ### subsection. Fenced code is left
// alone.
func demote(body string) string {
	lines := strings.SplitAfter(body, "\n")
	inFence := false
	for i, l := range lines {
		if isFence(l) {
			inFence = !inFence
			continue
		}
		level := len(l) - len(strings.TrimLeft(l, "#"))
		heading := level > 0 && level <= 6 && (len(l) == level || l[level] == ' ' || l[level] == '\n')
		if inFence || !heading {
			continue
		}
		lines[i] = strings.Repeat("#", min(level+3, 6)) + l[level:]
	}
	return strings.Join(lines, "")
}

// isFence reports whether line opens or closes a fenced code block.
func isFence(line string) bool {
	l := strings.TrimSpace(line)
	return strings.HasPrefix(l, "```") || strings.HasPrefix(l, "~~~")
}

// skillOf returns the skill name a file agent's path installs, and whether
// it is one of a's paths at all.
func skillOf(a Agent, p string) (string, bool) {
	before, after, _ := strings.Cut(target(a, "\x00"), "\x00")
	rest, ok := strings.CutPrefix(p, before)
	if !ok {
		return "", false
	}
	name, ok := strings.CutSuffix(rest, after)
	return name, ok && name != "" && !strings.Contains(name, "/")
}

// target is the path skill name installs to for a file agent.
func target(a Agent, name string) string {
	switch a {
	case ClaudeCode:
		return ".claude/skills/" + name + "/SKILL.md"
	case Cursor:
		return ".cursor/commands/" + name + ".md"
	}
	return ".github/prompts/" + name + ".prompt.md"
}

// sectionIntro opens the section's content.
const sectionIntro = "## Starboard skills\n\n" +
	"Installed by Starboard. To change these skills, change them in Starboard;\n" +
	"an edit made here is kept, and the next install stages its new version\n" +
	"under `.starboard/pending/` for you to merge.\n"

// section is the content between the markers: every skill's subsection.
func section(skills []skillsfs.Skill) string {
	parts := []string{sectionIntro}
	for _, s := range skills {
		parts = append(parts, Render(Codex, s))
	}
	for i := range parts {
		parts[i] = strings.TrimRight(parts[i], "\n") + "\n"
	}
	return strings.Join(parts, "\n")
}

// Result is what Install did, or would do on a dry run, by destination
// path: written (created or updated), unchanged, or staged under
// PendingDir because the destination is not Starboard's to overwrite.
// Removed are installed files of skills the release no longer ships,
// deleted because they were not edited; Retired are such files that were
// edited, and are left for the person to delete. Each list is sorted.
type Result struct{ Written, Unchanged, Staged, Removed, Retired []string }

// lock is the content of LockFile.
type lock struct {
	Version int               `json:"version"`
	Files   map[string]string `json:"files"`
}

// lf is data with CRLF line endings made LF.
func lf(data []byte) []byte { return bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n")) }

// hash is the SHA-256 of data, ignoring CRLF.
func hash(data []byte) string {
	h := sha256.Sum256(lf(data))
	return hex.EncodeToString(h[:])
}

// readFile reads name, returning nil and no error when it does not exist.
func readFile(fsys fs.FS, name string) ([]byte, bool, error) {
	data, err := fs.ReadFile(fsys, name)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, false, nil
	}
	return data, err == nil, err
}

// readLock reads LockFile; a missing one is empty.
func readLock(fsys fs.FS) (map[string]string, []byte, error) {
	data, ok, err := readFile(fsys, LockFile)
	if err != nil || !ok {
		return map[string]string{}, nil, err
	}
	var l lock
	if err := json.Unmarshal(data, &l); err != nil {
		return nil, nil, fmt.Errorf("%s: %w; fix it or delete it to start over", LockFile, err)
	}
	if l.Version != 1 {
		return nil, nil, fmt.Errorf("%s: version %d is not supported; upgrade starboard", LockFile, l.Version)
	}
	if l.Files == nil {
		l.Files = map[string]string{}
	}
	return l.Files, data, nil
}

// plan is one destination's outcome.
type plan struct {
	path    string
	content []byte // what to write to path, or to stage
	hash    string // what the lock records once path holds content
	verdict int
}

const (
	write = iota
	unchanged
	stage
	remove // a dropped skill's unedited file
	retire // a dropped skill's edited file
	forget // a dropped skill's file that is already gone
)

// Install installs skills for each of agents into w, and records what it
// wrote in LockFile. A destination that is not Starboard's (unrecorded, or
// edited since it was installed) is never overwritten; the new version is
// staged under PendingDir. Every destination is checked before anything is
// written, so a malformed section file fails the install with nothing
// changed. Nothing is written when nothing changed, and nothing at all on
// a dry run.
func Install(w project.WriteFS, agents []Agent, skills []skillsfs.Skill, dryRun bool) (Result, error) {
	for _, a := range agents {
		if !slices.Contains(Agents, a) {
			return Result{}, fmt.Errorf("unknown agent %q", a)
		}
	}
	owned, lockData, err := readLock(w)
	if err != nil {
		return Result{}, err
	}
	var plans []plan
	for _, a := range Agents {
		if !slices.Contains(agents, a) {
			continue
		}
		if file, ok := sectionFiles[a]; ok {
			p, err := planSection(w, file, section(skills), owned)
			if err != nil {
				return Result{}, err
			}
			plans = append(plans, p)
			continue
		}
		shipped := map[string]bool{}
		for _, s := range skills {
			shipped[s.Name] = true
			p, err := planFile(w, target(a, s.Name), []byte(Render(a, s)), owned)
			if err != nil {
				return Result{}, err
			}
			plans = append(plans, p)
		}
		dropped, err := planDropped(w, a, shipped, owned)
		if err != nil {
			return Result{}, err
		}
		plans = append(plans, dropped...)
	}
	slices.SortFunc(plans, func(a, b plan) int { return strings.Compare(a.path, b.path) })

	var res Result
	next := maps.Clone(owned)
	for _, p := range plans {
		switch p.verdict {
		case write:
			res.Written = append(res.Written, p.path)
			next[p.path] = p.hash
			if !dryRun {
				if err := w.WriteFile(p.path, p.content); err != nil {
					return res, err
				}
			}
		case unchanged:
			res.Unchanged = append(res.Unchanged, p.path)
			next[p.path] = p.hash
		case stage:
			res.Staged = append(res.Staged, p.path)
			if dryRun {
				continue
			}
			pending := PendingDir + "/" + p.path
			old, ok, err := readFile(w, pending)
			if err != nil {
				return res, err
			}
			if ok && bytes.Equal(lf(old), lf(p.content)) {
				continue
			}
			if err := w.WriteFile(pending, p.content); err != nil {
				return res, err
			}
		case remove:
			res.Removed = append(res.Removed, p.path)
			delete(next, p.path)
			if !dryRun {
				if err := w.Remove(p.path); err != nil {
					return res, err
				}
			}
		case retire:
			res.Retired = append(res.Retired, p.path)
		case forget:
			delete(next, p.path)
		}
	}
	if dryRun {
		return res, nil
	}
	data, _ := json.MarshalIndent(lock{Version: 1, Files: next}, "", "  ") // a map of strings always marshals
	data = append(data, '\n')
	if (lockData == nil && len(next) == 0) || (lockData != nil && bytes.Equal(lf(lockData), data)) {
		return res, nil
	}
	return res, w.WriteFile(LockFile, data)
}

// planDropped finds a's installed files, as the lock records them, of
// skills not in shipped: an unedited one is removed, an edited one retired
// (kept, and reported), and a missing one forgotten.
func planDropped(fsys fs.FS, a Agent, shipped map[string]bool, owned map[string]string) ([]plan, error) {
	var out []plan
	for _, p := range slices.Sorted(maps.Keys(owned)) {
		name, ok := skillOf(a, p)
		if !ok || shipped[name] {
			continue
		}
		data, ok, err := readFile(fsys, p)
		switch {
		case err != nil:
			return nil, err
		case !ok:
			out = append(out, plan{path: p, verdict: forget})
		case hash(data) == owned[p]:
			out = append(out, plan{path: p, verdict: remove})
		default:
			out = append(out, plan{path: p, verdict: retire})
		}
	}
	return out, nil
}

// planFile decides what to do with a whole-file destination.
func planFile(fsys fs.FS, name string, content []byte, owned map[string]string) (plan, error) {
	p := plan{path: name, content: content, hash: hash(content)}
	old, ok, err := readFile(fsys, name)
	switch {
	case err != nil:
		return p, err
	case !ok:
		p.verdict = write
	case bytes.Equal(lf(old), content):
		p.verdict = unchanged
	case owned[name] == hash(old):
		p.verdict = write
	default:
		p.verdict = stage
	}
	return p, nil
}

// planSection decides what to do with a section file: inner is the new
// content between the markers.
func planSection(fsys fs.FS, name, inner string, owned map[string]string) (plan, error) {
	p := plan{path: name, hash: hash([]byte(inner))}
	old, ok, err := readFile(fsys, name)
	if err != nil {
		return p, err
	}
	if !ok {
		p.content = []byte(StartMarker + "\n" + inner + EndMarker + "\n")
		p.verdict = write
		return p, nil
	}
	lines := strings.SplitAfter(string(old), "\n")
	start, end, err := findMarkers(name, lines)
	if err != nil {
		return p, err
	}
	eol := "\n"
	if bytes.Contains(old, []byte("\r\n")) {
		eol = "\r\n"
	}
	withEOL := func(s string) string { return strings.ReplaceAll(s, "\n", eol) }
	if start < 0 {
		text := string(old)
		if text != "" && !strings.HasSuffix(text, "\n") {
			text += eol
		}
		if text != "" {
			text += eol
		}
		p.content = []byte(text + withEOL(StartMarker+"\n"+inner+EndMarker+"\n"))
		p.verdict = write
		return p, nil
	}
	current := strings.Join(lines[start+1:end], "")
	p.content = []byte(strings.Join(lines[:start+1], "") + withEOL(inner) + strings.Join(lines[end:], ""))
	switch {
	case string(lf([]byte(current))) == inner:
		p.verdict = unchanged
	case owned[name] == hash([]byte(current)):
		p.verdict = write
	default:
		p.verdict = stage
	}
	return p, nil
}

// findMarkers returns the indexes of the start and end marker lines, or -1
// and -1 when there are none. Any other arrangement (a second start, an end
// before a start, a start never closed) is an error naming the line.
func findMarkers(name string, lines []string) (int, int, error) {
	start, end := -1, -1
	inFence := false
	for i, l := range lines {
		if i == 0 {
			l = strings.TrimPrefix(l, "\uFEFF")
		}
		if isFence(l) {
			inFence = !inFence
			continue
		}
		if inFence {
			continue
		}
		switch strings.TrimSpace(l) {
		case StartMarker:
			if start >= 0 {
				return 0, 0, fmt.Errorf("%s:%d: a second %s (the first is on line %d)", name, i+1, StartMarker, start+1)
			}
			start = i
		case EndMarker:
			if start < 0 || end >= 0 {
				return 0, 0, fmt.Errorf("%s:%d: %s without a %s before it", name, i+1, EndMarker, StartMarker)
			}
			end = i
		}
	}
	if start >= 0 && end < 0 {
		return 0, 0, fmt.Errorf("%s:%d: %s is never closed by %s", name, start+1, StartMarker, EndMarker)
	}
	return start, end, nil
}
