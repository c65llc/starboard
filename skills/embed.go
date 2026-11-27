// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package skills holds Starboard's agent-neutral skills: one Markdown file
// per skill, embedded in the binary so that each release carries the skills
// that match its commands and rules. A skill file opens with front matter
// giving its name (kebab-case, the file's stem) and a one-sentence
// description, followed by a runbook body with the sections When to use,
// Workflow and Rules. The installer renders each one into every agent's own
// format.
package skills

import (
	"bytes"
	"embed"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"path"
	"regexp"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"
)

// FS is the skill files, one <name>.md per skill.
//
//go:embed *.md
var FS embed.FS

// Skill is one parsed skill file. Body is everything after the front
// matter, without the blank line that separates them.
type Skill struct {
	Name        string
	Description string
	Body        string
}

// All returns every embedded skill, sorted by name. The embedded files are
// checked by this package's tests, so a malformed one is a build defect and
// All panics on it.
func All() []Skill {
	return mustLoad(FS)
}

// mustLoad is load that panics on an error.
func mustLoad(fsys fs.FS) []Skill {
	out, err := load(fsys)
	if err != nil {
		panic(err)
	}
	return out
}

// load parses every *.md file at the root of fsys and returns the skills
// sorted by name.
func load(fsys fs.FS) ([]Skill, error) {
	names, err := fs.Glob(fsys, "*.md")
	if err != nil {
		return nil, err
	}
	out := make([]Skill, 0, len(names))
	for _, name := range names {
		data, err := fs.ReadFile(fsys, name)
		if err != nil {
			return nil, err
		}
		s, err := parse(name, data)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	slices.SortFunc(out, func(a, b Skill) int { return strings.Compare(a.Name, b.Name) })
	return out, nil
}

// kebab is the form of a skill name.
var kebab = regexp.MustCompile(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)

// frontMatter is the only keys a skill's front matter may have.
type frontMatter struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
}

// parse reads the skill in file, whose content is data.
func parse(file string, data []byte) (Skill, error) {
	rest, ok := bytes.CutPrefix(data, []byte("---\n"))
	if !ok {
		return Skill{}, fmt.Errorf("%s: must start with front matter between --- lines", file)
	}
	head, body, ok := bytes.Cut(rest, []byte("\n---\n"))
	if !ok {
		return Skill{}, fmt.Errorf("%s: front matter is never closed with ---", file)
	}
	var fm frontMatter
	dec := yaml.NewDecoder(bytes.NewReader(head))
	dec.KnownFields(true)
	if err := dec.Decode(&fm); err != nil && !errors.Is(err, io.EOF) {
		return Skill{}, fmt.Errorf("%s: front matter: %w", file, err)
	}
	stem := strings.TrimSuffix(path.Base(file), ".md")
	switch {
	case !kebab.MatchString(fm.Name):
		return Skill{}, fmt.Errorf("%s: name %q must be kebab-case", file, fm.Name)
	case fm.Name != stem:
		return Skill{}, fmt.Errorf("%s: name %q must equal the file's stem %q", file, fm.Name, stem)
	case strings.TrimSpace(fm.Description) == "" || strings.Contains(strings.TrimSpace(fm.Description), "\n"):
		return Skill{}, fmt.Errorf("%s: description must be one non-empty line", file)
	}
	return Skill{
		Name:        fm.Name,
		Description: strings.TrimSpace(fm.Description),
		Body:        string(bytes.TrimPrefix(body, []byte("\n"))),
	}, nil
}
