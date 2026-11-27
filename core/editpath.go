// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package core

import (
	"fmt"
	"strconv"
	"strings"

	"go.yaml.in/yaml/v3"
)

// Region paths, as Model and registry.WalkFrom write them, resolved
// against a screen's YAML for Edit.

// The kinds of node a region path can name.
type nodeKind int

const (
	screenKind nodeKind = iota
	regionListKind
	regionKind
	navListKind
	navItemKind
)

// target is the node a region path names. parent and index locate it in
// its list when the path ends in an index.
type target struct {
	node   *yaml.Node
	kind   nodeKind
	parent *yaml.Node
	index  int
}

// step is one part of a region path: a key, or an index when key is "".
type step struct {
	key   string
	index int
}

// parsePath splits a path such as layouts.web-wide[0].children[1].
func parsePath(p string) ([]step, bool) {
	var out []step
	for _, seg := range strings.Split(p, ".") {
		name, rest, _ := strings.Cut(seg, "[")
		if name == "" {
			return nil, false
		}
		out = append(out, step{key: name})
		for rest != "" {
			num, after, ok := strings.Cut(rest, "]")
			i, err := strconv.Atoi(num)
			// Only the canonical form Model writes: digits, no sign, no
			// leading zero.
			canonical := err == nil && strconv.Itoa(i) == num && i >= 0
			if !ok || !canonical || (after != "" && after[0] != '[') {
				return nil, false
			}
			out = append(out, step{index: i})
			rest = strings.TrimPrefix(after, "[")
		}
	}
	return out, true
}

// resolve finds the node at p, a region path, in screen, whose ID is id.
func resolve(screen *yaml.Node, id, p string) (target, error) {
	steps, ok := parsePath(p)
	bad := func(why string) (target, error) {
		return target{}, fmt.Errorf("%w: %s: %s", ErrBadPath, p, why)
	}
	if !ok {
		return bad("write it as layout[0].children[1], layout[1].item or layouts.<formFactor>[0]")
	}
	t := target{node: screen, kind: screenKind}
	for i := 0; i < len(steps); i++ {
		st := steps[i]
		var next *yaml.Node
		kind, want := regionListKind, yaml.SequenceNode
		switch {
		case st.key == "":
			if t.kind != regionListKind && t.kind != navListKind {
				return bad("only a list takes an index")
			}
			if st.index < len(t.node.Content) {
				next = t.node.Content[st.index]
			}
			kind, want = regionKind, yaml.MappingNode
			if t.kind == navListKind {
				kind = navItemKind
			}
			t.parent, t.index = t.node, st.index
		case t.kind == screenKind && st.key == "layout":
			next = lookup(t.node, "layout")
		case t.kind == screenKind && st.key == "layouts" && i+1 < len(steps) && steps[i+1].key != "":
			next = lookup(lookup(t.node, "layouts"), steps[i+1].key)
			i++
		case t.kind == regionKind && st.key == "children":
			next = lookup(t.node, "children")
		case t.kind == regionKind && st.key == "item":
			next = lookup(t.node, "item")
			kind, want = regionKind, yaml.MappingNode
		case t.kind == regionKind && st.key == "items":
			next = lookup(t.node, "items")
			kind = navListKind
		default:
			return bad("write it as layout[0].children[1], layout[1].item or layouts.<formFactor>[0]")
		}
		if st.key != "" {
			t.parent = nil
		}
		if next == nil || next.Kind != want {
			return bad(fmt.Sprintf("%s has no %s", id, p))
		}
		t.node, t.kind = next, kind
	}
	return t, nil
}
