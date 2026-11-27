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
	"github.com/c65llc/starboard/internal/registry"
)

// ScopeResult is which files of a folder a project uses, so a host can read
// only those: starboard.yaml, every file under Content (the content root),
// the files in Read in full, and the files in Present by name alone, as
// lint only checks that they exist (a root's files, which screenFiles are
// globbed among, and each screen's files and screenshots). Read and Present
// are sorted and leave out starboard.yaml and the content root.
//
// Walk and Named say where those files can be, so a host lists only that
// much of the folder: every file under each directory in Walk (sorted,
// none inside another; "." is the whole folder), plus each path in Named
// that is a file (sorted; the files the project names one by one, outside
// Walk, whether or not they exist). Walk is "." alone whenever the project
// may reach anywhere: a root of "." with a pattern that starts with a
// wildcard, or one the CLI would not glob (an absolute pattern, say), or a
// starboard.yaml that does not parse or names an invalid content root.
type ScopeResult struct {
	Content string   `json:"content"`
	Read    []string `json:"read"`
	Present []string `json:"present"`
	Walk    []string `json:"walk"`
	Named   []string `json:"named"`
}

// Scope says which of f's files the project uses. f is a folder as a host
// lists it: starboard.yaml read, any other file present with or without its
// contents. A host calls it twice: first with starboard.yaml alone read, to
// learn the content root, then with the content root read too, so each
// screen's files and screenshots are known. When starboard.yaml does not
// parse or names an invalid content root (one escaping the project, or
// written with a backslash), Content is the default one, which lint
// reports. A content root of "." is the project folder itself: its files
// are then screens.yaml, flows/ and generated/ at the top (see inContent).
func Scope(f Files) (ScopeResult, error) {
	_, p, _, err := load(f)
	if err != nil {
		return ScopeResult{}, err
	}
	res := ScopeResult{Content: config.DefaultContent, Read: []string{}, Present: []string{}, Walk: []string{"."}, Named: []string{}}
	if p == nil {
		return res, nil
	}
	content := path.Clean(p.Config.Content)
	if !fs.ValidPath(content) || strings.Contains(content, `\`) {
		return res, nil
	}
	res.Content = content
	res.Walk, res.Named = reach(p.Config, p.Registry, content)
	inScope := func(name string) bool {
		_, ok := f[name]
		return ok && name != config.FileName && !inContent(name, content)
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

// reach is where the project's files can be: the directories to walk
// (everything under the content root and under each root the CLI globs)
// and, outside them, the files the project names (vocabulary files and
// each screen's files and screenshots, plus screens.yaml when the content
// root is the folder itself). A root of "." is walked only as deep as its
// patterns' literal directories; see literalDir.
func reach(cfg *config.Config, reg *registry.Registry, content string) (walk, named []string) {
	dirs := map[string]bool{}
	names := map[string]bool{}
	if content == "." {
		dirs["flows"], dirs["generated"], names[registry.FileName] = true, true, true
	} else {
		dirs[content] = true
	}
	for _, plat := range cfg.Platforms {
		for _, root := range plat.Roots {
			switch {
			case validName(root):
				dirs[root] = true
			case root == ".":
				for _, pattern := range plat.ScreenFiles {
					dir, ok := literalDir(pattern)
					if !ok {
						return []string{"."}, []string{}
					}
					dirs[dir] = true
				}
			}
		}
	}
	for _, v := range cfg.Vocabularies {
		names[v.File] = true
	}
	for _, s := range reg.Screens {
		for _, files := range s.Files {
			for _, name := range files {
				names[name] = true
			}
		}
		for _, name := range s.Screenshots {
			names[name] = true
		}
	}

	for _, dir := range slices.Sorted(maps.Keys(dirs)) {
		if !slices.ContainsFunc(walk, func(w string) bool { return under(dir, w) }) {
			walk = append(walk, dir)
		}
	}
	named = []string{}
	for _, name := range slices.Sorted(maps.Keys(names)) {
		if validName(name) && name != config.FileName && !slices.ContainsFunc(walk, func(w string) bool { return under(name, w) }) {
			named = append(named, name)
		}
	}
	return walk, named
}

// literalDir is the directory a screenFiles pattern globbed from the
// project folder stays inside: its leading elements, up to the last one
// or the first holding a wildcard, brace or class. ok is false when that
// is the folder itself, or the pattern is one the CLI does not glob
// (absolute, climbing out with "..", holding a backslash or an empty or
// "." element): the caller then walks everything, which is never wrong.
func literalDir(pattern string) (dir string, ok bool) {
	elems := strings.Split(pattern, "/")
	for _, el := range elems {
		if el == "" || el == "." || el == ".." || strings.Contains(el, `\`) {
			return "", false
		}
	}
	n := 0
	for n < len(elems)-1 && !strings.ContainsAny(elems[n], "*?[]{}") {
		n++
	}
	if n == 0 {
		return "", false
	}
	return strings.Join(elems[:n], "/"), true
}

// validName reports whether name is a project-relative slash path other
// than the project itself.
func validName(name string) bool {
	return fs.ValidPath(name) && name != "." && !strings.Contains(name, `\`)
}

// inContent reports whether the project file name belongs to the content
// root content: anything under it, or, when content is ".", the files a
// content root holds (screens.yaml and everything under flows/ and
// generated/), since the rest of the folder is the app's own.
func inContent(name, content string) bool {
	if content == "." {
		return name == registry.FileName || under(name, "flows") || under(name, "generated")
	}
	return under(name, content)
}

// under reports whether name is inside the directory dir.
func under(name, dir string) bool {
	return strings.HasPrefix(name, dir+"/")
}
