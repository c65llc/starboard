// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package lint

import (
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"slices"
	"strings"

	"github.com/bmatcuk/doublestar/v4"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/project"
	"github.com/c65llc/starboard/internal/registry"
)

// --- path helpers -----------------------------------------------------------

// validPath reports whether v is a project path Starboard may open: a
// relative slash path with no "." or ".." element and no backslash.
func validPath(v string) bool {
	return fs.ValidPath(v) && !strings.Contains(v, `\`)
}

// validPattern reports whether a screenFiles pattern may be globbed. It
// must have no "..", anywhere (so a brace alternative cannot climb out of
// a root), no backslash, no empty or "." element (which also rules out a
// leading "/"), no "/" inside a {…} group (an alternative may not span
// directories), and valid doublestar syntax. fs.ValidPath cannot judge a
// pattern, so this checks the same things itself.
func validPattern(v string) bool {
	if strings.Contains(v, "..") || strings.Contains(v, `\`) || !doublestar.ValidatePattern(v) {
		return false
	}
	for _, el := range strings.Split(v, "/") {
		if el == "" || el == "." {
			return false
		}
	}
	depth := 0
	for _, c := range v {
		switch {
		case c == '{':
			depth++
		case c == '}' && depth > 0:
			depth--
		case c == '/' && depth > 0:
			return false
		}
	}
	return true
}

// fileProblem says why name is not a regular file in fsys, or "" when it is.
func fileProblem(fsys fs.FS, name string) string {
	info, err := fs.Stat(fsys, name)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return "does not exist"
	case err != nil:
		return fmt.Sprintf("cannot be read: %v", err)
	case info.IsDir():
		return "is a directory, not a file"
	}
	return ""
}

// isDir reports whether name is a directory in fsys.
func isDir(fsys fs.FS, name string) bool {
	info, err := fs.Stat(fsys, name)
	return err == nil && info.IsDir()
}

// itemLine is the line of item i of the sequence at keys in src, or 0.
func itemLine(src []byte, i int, keys ...string) int {
	if _, v := lookup(src, keys...); v != nil && i < len(v.Content) {
		return v.Content[i].Line
	}
	return 0
}

// platformField calls fn for every value of a platform's roots or
// screenFiles, in platform order, with its path and config line.
func platformField(p *project.Project, field string, get func(config.Platform) []string,
	fn func(pl, v, where string, line int)) {
	src := p.Sources[config.FileName]
	for _, pl := range p.Config.PlatformOrder {
		for i, v := range get(p.Config.Platforms[pl]) {
			fn(pl, v, fmt.Sprintf("platforms.%s.%s[%d]", pl, field, i),
				itemLine(src, i, "platforms", pl, field))
		}
	}
}

func roots(c config.Platform) []string       { return c.Roots }
func screenFiles(c config.Platform) []string { return c.ScreenFiles }

// claimedBy maps every path in any screen's files, on any platform, to the
// first screen (in file order) that claims it.
func claimedBy(p *project.Project) map[string]string {
	out := map[string]string{}
	screens(p, func(s *registry.Screen) {
		for _, pl := range slices.Sorted(maps.Keys(s.Files)) {
			for _, f := range s.Files[pl] {
				if _, ok := out[f]; !ok {
					out[f] = s.ID
				}
			}
		}
	})
	return out
}

// --- rules ------------------------------------------------------------------

func rulePathInvalid(p *project.Project, _ *Context) []diag.Diagnostic {
	const id = "path-invalid"
	var out []diag.Diagnostic
	const why = "must be a relative path inside the project, using / and no . or .. elements"

	platformField(p, "roots", roots, func(_, v, where string, line int) {
		if !validPath(v) {
			out = append(out, finding(id, config.FileName, line, where, "root %q %s", v, why))
		}
	})
	platformField(p, "screenFiles", screenFiles, func(_, v, where string, line int) {
		if !validPattern(v) {
			out = append(out, finding(id, config.FileName, line, where,
				"pattern %q must be a valid glob relative to each root, using / and no . or .. elements", v))
		}
	})
	src := p.Sources[config.FileName]
	for _, key := range slices.Sorted(maps.Keys(p.Config.Vocabularies)) {
		if v := p.Config.Vocabularies[key].File; !validPath(v) {
			out = append(out, finding(id, config.FileName, valueLine(src, 0, "vocabularies", key, "file"),
				"vocabularies."+key+".file", "vocabulary file %q %s", v, why))
		}
	}

	screens(p, func(s *registry.Screen) {
		for _, pl := range slices.Sorted(maps.Keys(s.Files)) {
			for i, f := range s.Files[pl] {
				if !validPath(f) {
					out = append(out, finding(id, registryFile(p), s.Line,
						fmt.Sprintf("%s.files.%s[%d]", screenPath(s), pl, i), "file %q %s", f, why))
				}
			}
		}
		for _, pl := range slices.Sorted(maps.Keys(s.Screenshots)) {
			if f := s.Screenshots[pl]; !validPath(f) {
				out = append(out, finding(id, registryFile(p), s.Line,
					screenPath(s)+".screenshots."+pl, "screenshot %q %s", f, why))
			}
		}
	})
	for i, u := range p.Registry.Unmapped {
		if !validPath(u.Path) {
			out = append(out, finding(id, registryFile(p), u.Line,
				fmt.Sprintf("unmapped[%d].path", i), "unmapped path %q %s", u.Path, why))
		}
	}
	return out
}

func ruleFileMissing(p *project.Project, _ *Context) []diag.Diagnostic {
	const id = "file-missing"
	var out []diag.Diagnostic
	platformField(p, "roots", roots, func(_, v, where string, line int) {
		if !validPath(v) {
			return // path-invalid reports it
		}
		info, err := fs.Stat(p.FS, v)
		switch {
		case err != nil:
			out = append(out, finding(id, config.FileName, line, where, "root %s does not exist", v))
		case !info.IsDir():
			out = append(out, finding(id, config.FileName, line, where, "root %s is not a directory", v))
		}
	})
	// A directory under a root that cannot be listed would hide screen
	// files from reverse coverage; report it on the root.
	seen := map[string]bool{}
	globEach(p, func(where string, line int, _, _ string, _ []string, err error) {
		if err != nil && !seen[where+err.Error()] {
			seen[where+err.Error()] = true
			out = append(out, finding(id, config.FileName, line, where, "cannot list a directory under this root: %v", err))
		}
	})
	screens(p, func(s *registry.Screen) {
		for _, pl := range slices.Sorted(maps.Keys(s.Files)) {
			if s.Status.For(pl) == registry.Proposed {
				continue
			}
			for i, f := range s.Files[pl] {
				if !validPath(f) {
					continue
				}
				if why := fileProblem(p.FS, f); why != "" {
					out = append(out, finding(id, registryFile(p), s.Line,
						fmt.Sprintf("%s.files.%s[%d]", screenPath(s), pl, i), "%s %s", f, why))
				}
			}
		}
	})
	return out
}

func ruleScreenshotMissing(p *project.Project, _ *Context) []diag.Diagnostic {
	var out []diag.Diagnostic
	screens(p, func(s *registry.Screen) {
		for _, pl := range slices.Sorted(maps.Keys(s.Screenshots)) {
			f := s.Screenshots[pl]
			if !validPath(f) {
				continue
			}
			if why := fileProblem(p.FS, f); why != "" {
				out = append(out, finding("screenshot-missing", registryFile(p), s.Line,
					screenPath(s)+".screenshots."+pl, "screenshot %s %s", f, why))
			}
		}
	})
	return out
}

// globEach globs every valid screenFiles pattern under every valid, existing
// root, in platform order, and calls fn with the root's config location,
// the platform, the pattern, the matches and any listing error.
func globEach(p *project.Project, fn func(where string, line int, pl, pattern string, matches []string, err error)) {
	src := p.Sources[config.FileName]
	for _, pl := range p.Config.PlatformOrder {
		plat := p.Config.Platforms[pl]
		for i, root := range plat.Roots {
			if !validPath(root) || !isDir(p.FS, root) {
				continue // path-invalid or file-missing reports it
			}
			for _, pattern := range plat.ScreenFiles {
				if !validPattern(pattern) {
					continue
				}
				// WithNoFollow: ** must not walk a symlinked directory,
				// which could lead outside the root or loop.
				matches, err := doublestar.Glob(p.FS, globRoot(root, pattern),
					doublestar.WithFilesOnly(), doublestar.WithNoFollow(), doublestar.WithFailOnIOErrors())
				fn(fmt.Sprintf("platforms.%s.roots[%d]", pl, i), itemLine(src, i, "platforms", pl, "roots"),
					pl, pattern, matches, err)
			}
		}
	}
}

// globRoot is pattern under root, or pattern alone when root is the project.
func globRoot(root, pattern string) string {
	if root == "." {
		return pattern
	}
	return root + "/" + pattern
}

func ruleUnregisteredScreenFile(p *project.Project, _ *Context) []diag.Diagnostic {
	claimed := claimedBy(p)
	unmapped := map[string]bool{}
	for _, u := range p.Registry.Unmapped {
		unmapped[u.Path] = true
	}
	// first records, for each unregistered file, the platform and pattern
	// that matched it first, so a file two patterns match is reported once.
	first := map[string]string{}
	globEach(p, func(_ string, _ int, pl, pattern string, matches []string, _ error) {
		for _, m := range matches {
			if _, done := first[m]; done || unmapped[m] {
				continue
			}
			if _, ok := claimed[m]; !ok {
				first[m] = fmt.Sprintf("platforms.%s.screenFiles %q", pl, pattern)
			}
		}
	})
	var out []diag.Diagnostic
	for _, f := range slices.Sorted(maps.Keys(first)) {
		out = append(out, finding("unregistered-screen-file", f, 0, "",
			"matches %s but no screen claims it; add it to a screen's files, or to unmapped in %s with a reason",
			first[f], registryFile(p)))
	}
	return out
}

func ruleUnmappedAndClaimed(p *project.Project, _ *Context) []diag.Diagnostic {
	claimed := claimedBy(p)
	var out []diag.Diagnostic
	for i, u := range p.Registry.Unmapped {
		if by, ok := claimed[u.Path]; ok {
			out = append(out, finding("unmapped-and-claimed", registryFile(p), u.Line,
				fmt.Sprintf("unmapped[%d].path", i),
				"%s is listed under unmapped but claimed by %s; remove it from one of them", u.Path, by))
		}
	}
	return out
}
