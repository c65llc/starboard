// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package core

import (
	"io/fs"
	"maps"
	"path"
	"slices"
	"strings"

	"github.com/c65llc/starboard/internal/config"
)

// ScopeResult is which files of a folder a project uses, so a host can read
// only those: starboard.yaml, every file under Content (the content root),
// the files in Read in full, and the files in Present by name alone, as
// lint only checks that they exist (a root's files, which screenFiles are
// globbed among, and each screen's files and screenshots). Read and Present
// are sorted and leave out starboard.yaml and the content root.
type ScopeResult struct {
	Content string   `json:"content"`
	Read    []string `json:"read"`
	Present []string `json:"present"`
}

// Scope says which of f's files the project uses. f is a folder as a host
// lists it: starboard.yaml read, any other file present with or without its
// contents. A host calls it twice: first with starboard.yaml alone read, to
// learn the content root, then with the content root read too, so each
// screen's files and screenshots are known. When starboard.yaml does not
// parse or names an invalid content root, Content is the default one, which
// lint reports.
func Scope(f Files) (ScopeResult, error) {
	_, p, _, err := load(f)
	if err != nil {
		return ScopeResult{}, err
	}
	res := ScopeResult{Content: config.DefaultContent, Read: []string{}, Present: []string{}}
	if p == nil {
		return res, nil
	}
	content := path.Clean(p.Config.Content)
	if !validName(content) {
		return res, nil
	}
	res.Content = content
	inScope := func(name string) bool {
		_, ok := f[name]
		return ok && name != config.FileName && !under(name, content)
	}

	read := map[string]bool{}
	for _, v := range p.Config.Vocabularies {
		if validName(v.File) && inScope(v.File) {
			read[v.File] = true
		}
	}

	present := map[string]bool{}
	var roots []string
	for _, plat := range p.Config.Platforms {
		for _, root := range plat.Roots {
			if root == "." || validName(root) {
				roots = append(roots, root)
			}
		}
	}
	for name := range f {
		if inScope(name) && !read[name] && slices.ContainsFunc(roots, func(r string) bool { return r == "." || under(name, r) }) {
			present[name] = true
		}
	}
	for _, s := range p.Registry.Screens {
		for _, files := range s.Files {
			for _, name := range files {
				if inScope(name) && !read[name] {
					present[name] = true
				}
			}
		}
		for _, name := range s.Screenshots {
			if inScope(name) && !read[name] {
				present[name] = true
			}
		}
	}
	res.Read = append(res.Read, slices.Sorted(maps.Keys(read))...)
	res.Present = append(res.Present, slices.Sorted(maps.Keys(present))...)
	return res, nil
}

// validName reports whether name is a project-relative slash path other
// than the project itself.
func validName(name string) bool {
	return fs.ValidPath(name) && name != "." && !strings.Contains(name, `\`)
}

// under reports whether name is inside the directory dir.
func under(name, dir string) bool {
	return strings.HasPrefix(name, dir+"/")
}
