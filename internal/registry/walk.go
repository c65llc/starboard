// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package registry

import (
	"cmp"
	"fmt"
	"slices"
	"strings"
)

// Walk calls fn for every region of the default layout tree, depth first: a
// region, then its Children, then its Item. path locates the region, such as
// "layout[2].children[0]" or "layout[1].item".
func Walk(regions []*Region, fn func(r *Region, path string)) {
	WalkFrom(regions, "layout", fn)
}

// WalkFrom is Walk for a tree whose path is root, such as
// "layouts.web-wide" for an override (see Screen.LayoutPath).
func WalkFrom(regions []*Region, root string, fn func(r *Region, path string)) {
	walk(regions, root, fn)
}

func walk(regions []*Region, prefix string, fn func(*Region, string)) {
	for i, r := range regions {
		visit(r, fmt.Sprintf("%s[%d]", prefix, i), fn)
	}
}

func visit(r *Region, path string, fn func(*Region, string)) {
	fn(r, path)
	walk(r.Children, path+".children", fn)
	if r.Item != nil {
		visit(r.Item, path+".item", fn)
	}
}

// Edge is one navigation from a screen: a to on a region or nav item. Region
// is the name of the region holding it; a nameless list item takes its
// nearest named ancestor's. Path is as WalkFrom gives it from the tree's
// LayoutPath, with ".items[i]" for a nav item.
type Edge struct {
	From, To, Region, Path string
	Line                   int
}

// Edges returns every to in s's layout for formFactor, including those in
// list items and nav items, sorted by To, then Path.
func Edges(s *Screen, formFactor string) []Edge {
	var out []Edge
	owner := map[*Region]string{} // a nameless item's nearest named ancestor
	WalkFrom(s.LayoutFor(formFactor), s.LayoutPath(formFactor), func(r *Region, path string) {
		name := r.Name
		if name == "" {
			name = owner[r]
		}
		if r.Item != nil {
			owner[r.Item] = name
		}
		if r.To != "" {
			out = append(out, Edge{From: s.ID, To: r.To, Region: name, Path: path, Line: r.Line})
		}
		for i, it := range r.Items {
			if it.To != "" {
				out = append(out, Edge{From: s.ID, To: it.To, Region: name, Path: fmt.Sprintf("%s.items[%d]", path, i), Line: it.Line})
			}
		}
	})
	slices.SortFunc(out, func(a, b Edge) int {
		return cmp.Or(strings.Compare(a.To, b.To), strings.Compare(a.Path, b.Path))
	})
	return out
}
