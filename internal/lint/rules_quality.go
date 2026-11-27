// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package lint

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/flows"
	"github.com/c65llc/starboard/internal/project"
	"github.com/c65llc/starboard/internal/registry"
)

// quality registers a quality rule at its default severity from
// diag.QualityRules; Config.Rules may change it.
func quality(id string, run func(*project.Project, *Context) []diag.Diagnostic) Rule {
	return Rule{ID: id, Default: diag.QualityRules[id], Run: run}
}

// limit is the configured limit for rule id, or its default.
func limit(c *Context, id string) int {
	if n, ok := c.Limits[id]; ok {
		return n
	}
	return config.DefaultLimits[id]
}

// targets is every to in one layout tree, regions and nav items alike.
func targets(regions []*registry.Region) map[string]bool {
	out := map[string]bool{}
	registry.Walk(regions, func(r *registry.Region, _ string) {
		if r.To != "" {
			out[r.To] = true
		}
		for _, it := range r.Items {
			if it.To != "" {
				out[it.To] = true
			}
		}
	})
	return out
}

func ruleUnreachableScreen(p *project.Project, _ *Context) []diag.Diagnostic {
	inbound := map[string]bool{}
	screens(p, func(s *registry.Screen) {
		for _, t := range trees(s) {
			for to := range targets(t.regions) {
				if to != s.ID {
					inbound[to] = true
				}
			}
		}
	})
	flowEach(p, func(_, _ string, f *flows.Flow) {
		if f.Entry != "" {
			inbound[f.Entry] = true
		}
	})
	var out []diag.Diagnostic
	screens(p, func(s *registry.Screen) {
		if !inbound[s.ID] && s.Presentation != "root" {
			out = append(out, finding("unreachable-screen", registryFile(p), s.Line, screenPath(s),
				"no other screen links to %s, it is not presentation: root, and no flow starts there", s.ID))
		}
	})
	return out
}

func ruleOrphanScreen(p *project.Project, _ *Context) []diag.Diagnostic {
	referenced := map[string]bool{}
	flowEach(p, func(_, _ string, f *flows.Flow) {
		if f.Entry != "" {
			referenced[f.Entry] = true
		}
		for _, r := range f.Refs {
			referenced[r.Screen] = true
		}
	})
	var out []diag.Diagnostic
	screens(p, func(s *registry.Screen) {
		if !referenced[s.ID] {
			out = append(out, finding("orphan-screen", registryFile(p), s.Line, screenPath(s),
				"no flow references %s", s.ID))
		}
	})
	return out
}

func ruleMissingPurpose(p *project.Project, _ *Context) []diag.Diagnostic {
	var out []diag.Diagnostic
	screens(p, func(s *registry.Screen) {
		if strings.TrimSpace(s.Purpose) == "" {
			out = append(out, finding("missing-purpose", registryFile(p), s.Line, screenPath(s)+".purpose",
				"%s has no purpose; say in a sentence what the screen is for", s.ID))
		}
	})
	return out
}

func ruleLabelTooLong(p *project.Project, c *Context) []diag.Diagnostic {
	lim := limit(c, "label-too-long")
	var out []diag.Diagnostic
	check := func(label, where string, line int) {
		if n := utf8.RuneCountInString(label); n > lim {
			out = append(out, finding("label-too-long", registryFile(p), line, where+".label",
				"label is %d characters, over the limit of %d", n, lim))
		}
	}
	screens(p, func(s *registry.Screen) {
		for _, t := range trees(s) {
			registry.WalkFrom(t.regions, screenPath(s)+"."+t.path, func(r *registry.Region, at string) {
				check(r.Label, at, r.Line)
				for i, it := range r.Items {
					check(it.Label, fmt.Sprintf("%s.items[%d]", at, i), it.Line)
				}
			})
		}
	})
	return out
}

func ruleFlowRefNotInDiagram(p *project.Project, _ *Context) []diag.Diagnostic {
	var out []diag.Diagnostic
	flowEach(p, func(file, _ string, f *flows.Flow) {
		if !f.HasDiagram {
			return
		}
		inDiagram := map[string]bool{}
		for _, r := range f.Refs {
			if r.InDiagram {
				inDiagram[r.Screen] = true
			}
		}
		reported := map[string]bool{}
		for _, r := range f.Refs {
			if r.InDiagram || inDiagram[r.Screen] || reported[r.Screen] {
				continue
			}
			reported[r.Screen] = true
			out = append(out, finding("flow-ref-not-in-diagram", file, r.Line, "",
				"@%s is referenced but the diagram does not show it", r.Screen))
		}
	})
	return out
}

// parentPath is the path of the node holding the region at p: the list for
// a list item, the container for a child, the tree for a top-level region.
func parentPath(p string) string {
	if s, ok := strings.CutSuffix(p, ".item"); ok {
		return s
	}
	p = p[:strings.LastIndexByte(p, '[')]
	return strings.TrimSuffix(p, ".children")
}

func ruleDuplicateEdge(p *project.Project, _ *Context) []diag.Diagnostic {
	var out []diag.Diagnostic
	screens(p, func(s *registry.Screen) {
		for _, t := range trees(s) {
			seen := map[[2]string]bool{}
			check := func(parent, to, where string, line int) {
				if to == "" {
					return
				}
				key := [2]string{parent, to}
				if seen[key] {
					out = append(out, finding("duplicate-edge", registryFile(p), line, where,
						"a second link to %s under %s", to, parent))
				}
				seen[key] = true
			}
			registry.WalkFrom(t.regions, screenPath(s)+"."+t.path, func(r *registry.Region, at string) {
				check(parentPath(at), r.To, at, r.Line)
				for i, it := range r.Items {
					check(at, it.To, fmt.Sprintf("%s.items[%d]", at, i), it.Line)
				}
			})
		}
	})
	return out
}

func ruleDeepNesting(p *project.Project, c *Context) []diag.Diagnostic {
	lim := limit(c, "deep-nesting")
	var out []diag.Diagnostic
	var visit func(r *registry.Region, at string, depth int)
	visit = func(r *registry.Region, at string, depth int) {
		if depth > lim {
			out = append(out, finding("deep-nesting", registryFile(p), r.Line, at,
				"nested %d deep, over the limit of %d", depth, lim))
			return
		}
		for i, ch := range r.Children {
			visit(ch, fmt.Sprintf("%s.children[%d]", at, i), depth+1)
		}
		if r.Item != nil {
			visit(r.Item, at+".item", depth+1)
		}
	}
	screens(p, func(s *registry.Screen) {
		for _, t := range trees(s) {
			for i, r := range t.regions {
				visit(r, fmt.Sprintf("%s.%s[%d]", screenPath(s), t.path, i), 1)
			}
		}
	})
	return out
}

func ruleEdgeParity(p *project.Project, _ *Context) []diag.Diagnostic {
	var out []diag.Diagnostic
	screens(p, func(s *registry.Screen) {
		def := slices.Sorted(maps.Keys(targets(s.Layout)))
		for _, ff := range slices.Sorted(maps.Keys(s.Layouts)) {
			have := targets(s.Layouts[ff])
			for _, to := range def {
				if !have[to] {
					out = append(out, finding("edge-parity", registryFile(p), s.Line,
						screenPath(s)+"."+s.LayoutPath(ff),
						"the %s layout drops the link to %s that the default layout has", ff, to))
				}
			}
		}
	})
	return out
}

func ruleStepWithoutRef(p *project.Project, _ *Context) []diag.Diagnostic {
	var out []diag.Diagnostic
	flowEach(p, func(file, _ string, f *flows.Flow) {
		for _, st := range f.Steps {
			if st.Ref == nil {
				out = append(out, finding("step-without-ref", file, st.Line, "",
					"step %d has no @screen reference to say where it happens", st.Number))
			}
		}
	})
	return out
}
