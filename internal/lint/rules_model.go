// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package lint

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"path"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/flows"
	"github.com/c65llc/starboard/internal/project"
	"github.com/c65llc/starboard/internal/registry"
	"github.com/c65llc/starboard/internal/selector"
	"github.com/c65llc/starboard/internal/yamlx"
)

// --- shared helpers ---------------------------------------------------------

// registryFile is the project-relative path of screens.yaml.
func registryFile(p *project.Project) string {
	return path.Join(path.Clean(p.Config.Content), registry.FileName)
}

// screenPath is a screen's path prefix, "screens.<id>".
func screenPath(s *registry.Screen) string { return "screens." + s.ID }

func finding(rule, file string, line int, p, format string, args ...any) diag.Diagnostic {
	return diag.Diagnostic{Rule: rule, File: file, Line: line, Path: p, Message: fmt.Sprintf(format, args...)}
}

// screens calls fn for every screen in file order.
func screens(p *project.Project, fn func(s *registry.Screen)) {
	for _, id := range p.Registry.Order {
		fn(p.Registry.Screens[id])
	}
}

// tree is one layout tree of a screen and its path ("layout" or
// "layouts.<form-factor>").
type tree struct {
	path    string
	regions []*registry.Region
}

// trees returns s's default layout, then each override in form-factor order.
func trees(s *registry.Screen) []tree {
	out := []tree{{"layout", s.Layout}}
	for _, ff := range slices.Sorted(maps.Keys(s.Layouts)) {
		out = append(out, tree{s.LayoutPath(ff), s.Layouts[ff]})
	}
	return out
}

// node is a region or a nav item met while walking a screen's trees. Owner
// is the region itself, or the nav region holding the item.
type node struct {
	To, Requires, Status string
	Owner                *registry.Region
	Path                 string
	Line                 int
}

// nodes calls fn for every region and nav item in every tree of s. Path is
// the full registry path, such as "screens.a.b.layout[0].items[1]".
func nodes(s *registry.Screen, fn func(n node)) {
	for _, t := range trees(s) {
		registry.WalkFrom(t.regions, screenPath(s)+"."+t.path, func(r *registry.Region, p string) {
			fn(node{To: r.To, Requires: r.Requires, Status: r.Status, Owner: r, Path: p, Line: r.Line})
			for i, it := range r.Items {
				fn(node{To: it.To, Requires: it.Requires, Status: it.Status, Owner: r,
					Path: fmt.Sprintf("%s.items[%d]", p, i), Line: it.Line})
			}
		})
	}
}

// platformsOf is s's platforms, or every configured platform when unset.
func platformsOf(p *project.Project, s *registry.Screen) []string {
	if len(s.Platforms) > 0 {
		return s.Platforms
	}
	return p.Config.PlatformOrder
}

// proposedOn reports whether s is proposed on any of platforms. With no
// platforms at all only a scalar status can say so.
func proposedOn(s *registry.Screen, platforms []string) (string, bool) {
	if len(platforms) == 0 {
		return "", s.Status.All == registry.Proposed
	}
	for _, pl := range platforms {
		if s.Status.For(pl) == registry.Proposed {
			return pl, true
		}
	}
	return "", false
}

// flowEach calls fn for every flow in file order with its file and stem.
func flowEach(p *project.Project, fn func(file, stem string, f *flows.Flow)) {
	for _, file := range p.FlowFiles {
		stem := strings.TrimSuffix(path.Base(file), ".md")
		fn(file, stem, p.Flows[stem])
	}
}

// lookup returns the key and value nodes at keys in the YAML mapping src,
// or nils when either is absent. It serves files whose model keeps no lines:
// starboard.yaml and a flow's front matter.
func lookup(src []byte, keys ...string) (k, v *yaml.Node) {
	v, _ = yamlx.Decode(src, "")
	for _, key := range keys {
		if v == nil || v.Kind != yaml.MappingNode {
			return nil, nil
		}
		var nk, nv *yaml.Node
		for i := 0; i+1 < len(v.Content); i += 2 {
			if v.Content[i].Value == key {
				nk, nv = v.Content[i], v.Content[i+1]
			}
		}
		k, v = nk, nv
	}
	return k, v
}

// valueLine is the line of the value at keys in src plus offset, or 0.
func valueLine(src []byte, offset int, keys ...string) int {
	if _, v := lookup(src, keys...); v != nil {
		return v.Line + offset
	}
	return 0
}

// keyLine is the line of the last of keys itself in src, or 0.
func keyLine(src []byte, keys ...string) int {
	if k, _ := lookup(src, keys...); k != nil {
		return k.Line
	}
	return 0
}

// frontMatterLine is the line of key's value in the flow at file.
// Callers ask only for id or entry, which are set only when the front
// matter was closed, so FrontMatterLines is always set here.
func frontMatterLine(p *project.Project, file string, f *flows.Flow, key string) int {
	lines := strings.Split(strings.ReplaceAll(string(p.Sources[file]), "\r\n", "\n"), "\n")
	start, end := f.FrontMatterLines[0], f.FrontMatterLines[1]
	text := strings.Join(lines[start:end-1], "\n")
	return valueLine([]byte(text), start, key)
}

// --- screens: configured names ----------------------------------------------

func ruleUnknownPlatform(p *project.Project, _ *Context) []diag.Diagnostic {
	const id = "unknown-platform"
	var out []diag.Diagnostic
	known := p.Config.Platforms
	screens(p, func(s *registry.Screen) {
		sp := screenPath(s)
		report := func(field, where, name string) {
			out = append(out, finding(id, registryFile(p), s.FieldLine(field), where,
				"unknown platform %s; configure it under platforms in %s", name, config.FileName))
		}
		for i, pl := range s.Platforms {
			if _, ok := known[pl]; !ok {
				report("platforms", fmt.Sprintf("%s.platforms[%d]", sp, i), pl)
			}
		}
		for _, field := range []struct {
			name string
			keys []string
		}{
			{"status", slices.Sorted(maps.Keys(s.Status.Per))},
			{"files", slices.Sorted(maps.Keys(s.Files))},
			{"screenshots", slices.Sorted(maps.Keys(s.Screenshots))},
		} {
			for _, pl := range field.keys {
				if _, ok := known[pl]; !ok {
					report(field.name, sp+"."+field.name+"."+pl, pl)
				}
			}
		}
	})
	return out
}

func ruleUnknownFormFactor(p *project.Project, _ *Context) []diag.Diagnostic {
	var out []diag.Diagnostic
	screens(p, func(s *registry.Screen) {
		for _, ff := range slices.Sorted(maps.Keys(s.Layouts)) {
			if _, ok := p.Config.FormFactors[ff]; !ok {
				out = append(out, finding("unknown-form-factor", registryFile(p), s.FieldLine("layouts"),
					screenPath(s)+".layouts."+ff,
					"unknown form factor %s; define it under formFactors in %s", ff, config.FileName))
			}
		}
	})
	return out
}

func ruleUnknownArea(p *project.Project, _ *Context) []diag.Diagnostic {
	var out []diag.Diagnostic
	screens(p, func(s *registry.Screen) {
		if s.Area != "" && !slices.Contains(p.Config.Areas, s.Area) {
			out = append(out, finding("unknown-area", registryFile(p), s.FieldLine("area"), screenPath(s)+".area",
				"unknown area %s; add it to areas in %s", s.Area, config.FileName))
		}
	})
	return out
}

func rulePlatformNoteMissing(p *project.Project, _ *Context) []diag.Diagnostic {
	var out []diag.Diagnostic
	screens(p, func(s *registry.Screen) {
		if len(s.Platforms) == 0 || s.PlatformNote != "" {
			return
		}
		for _, pl := range p.Config.PlatformOrder {
			if !slices.Contains(s.Platforms, pl) {
				out = append(out, finding("platform-note-missing", registryFile(p), s.FieldLine("platforms"),
					screenPath(s)+".platforms",
					"%s is not on every platform (not on %s); add a platformNote saying why", s.ID, pl))
				return
			}
		}
	})
	return out
}

// --- screens: edges and status ----------------------------------------------

func ruleEdgeUnresolved(p *project.Project, _ *Context) []diag.Diagnostic {
	var out []diag.Diagnostic
	screens(p, func(s *registry.Screen) {
		nodes(s, func(n node) {
			if n.To != "" && p.Registry.Screens[n.To] == nil {
				out = append(out, finding("edge-unresolved", registryFile(p), n.Line, n.Path,
					"to %s is not a registered screen", n.To))
			}
		})
	})
	return out
}

func ruleEdgePlatformMismatch(p *project.Project, _ *Context) []diag.Diagnostic {
	var out []diag.Diagnostic
	screens(p, func(s *registry.Screen) {
		from := platformsOf(p, s)
		nodes(s, func(n node) {
			target := p.Registry.Screens[n.To]
			if target == nil || n.Owner.PlatformNote != "" {
				return
			}
			to := platformsOf(p, target)
			if !slices.ContainsFunc(from, func(pl string) bool { return slices.Contains(to, pl) }) {
				out = append(out, finding("edge-platform-mismatch", registryFile(p), n.Line, n.Path,
					"%s (%s) shares no platform with %s (%s); add a platformNote to this node",
					n.To, strings.Join(to, ", "), s.ID, strings.Join(from, ", ")))
			}
		})
	})
	return out
}

func ruleStatusConflict(p *project.Project, _ *Context) []diag.Diagnostic {
	var out []diag.Diagnostic
	screens(p, func(s *registry.Screen) {
		pl, proposed := proposedOn(s, platformsOf(p, s))
		if !proposed {
			return
		}
		nodes(s, func(n node) {
			if n.Status == registry.Shipped {
				out = append(out, finding("status-conflict", registryFile(p), n.Line, n.Path,
					"status shipped under %s, which is proposed%s", s.ID, onPlatform(pl)))
			}
		})
	})
	return out
}

func onPlatform(pl string) string {
	if pl == "" {
		return ""
	}
	return " on " + pl
}

// --- flows ------------------------------------------------------------------

// regionIn reports whether any of ts has a region named name.
func regionIn(name string, ts []tree) bool {
	found := false
	for _, t := range ts {
		registry.WalkFrom(t.regions, t.path, func(r *registry.Region, _ string) {
			found = found || r.Name == name
		})
	}
	return found
}

func ruleRefUnresolved(p *project.Project, _ *Context) []diag.Diagnostic {
	const id = "ref-unresolved"
	var out []diag.Diagnostic
	flowEach(p, func(file, _ string, f *flows.Flow) {
		if f.Entry != "" && p.Registry.Screens[f.Entry] == nil {
			out = append(out, finding(id, file, frontMatterLine(p, file, f, "entry"), "entry",
				"entry %s is not a registered screen", f.Entry))
		}
		for _, ref := range f.Refs {
			s := p.Registry.Screens[ref.Screen]
			switch {
			case s == nil:
				out = append(out, finding(id, file, ref.Line, "", "@%s is not a registered screen", ref.Screen))
			case ref.Region != "" && !regionIn(ref.Region, trees(s)):
				out = append(out, finding(id, file, ref.Line, "",
					"@%s#%s: %s has no region %s in any layout", ref.Screen, ref.Region, ref.Screen, ref.Region))
			}
		}
	})
	return out
}

func ruleFlowIDMismatch(p *project.Project, _ *Context) []diag.Diagnostic {
	var out []diag.Diagnostic
	flowEach(p, func(file, stem string, f *flows.Flow) {
		if f.ID != "" && f.ID != stem {
			out = append(out, finding("flow-id-mismatch", file, frontMatterLine(p, file, f, "id"), "id",
				"id %s does not match the file name; use %s", f.ID, stem))
		}
	})
	return out
}

// proposedRegion reports whether a region named name is proposed in a tree
// platform pl draws: the layout for each of its form factors, or the default
// layout when it has none.
func proposedRegion(p *project.Project, s *registry.Screen, name, pl string) bool {
	ffs := p.Config.Platforms[pl].FormFactors
	ts := []tree{{"layout", s.Layout}}
	if len(ffs) > 0 {
		ts = nil
		for _, ff := range ffs {
			ts = append(ts, tree{s.LayoutPath(ff), s.LayoutFor(ff)})
		}
	}
	proposed := false
	for _, t := range ts {
		registry.WalkFrom(t.regions, t.path, func(r *registry.Region, _ string) {
			proposed = proposed || (r.Name == name && r.Status == registry.Proposed)
		})
	}
	return proposed
}

func ruleShippedFlowProposedRef(p *project.Project, _ *Context) []diag.Diagnostic {
	const id = "shipped-flow-proposed-ref"
	var out []diag.Diagnostic
	flowEach(p, func(file, _ string, f *flows.Flow) {
		if f.Status != registry.Shipped {
			return
		}
		platforms := f.Platforms
		if len(platforms) == 0 {
			platforms = p.Config.PlatformOrder
		}
		// check reports the first of the flow's platforms, among those the
		// screen is on, on which the screen, or the region in it, is
		// proposed.
		check := func(screenID, region string, line int, where, what string) {
			s := p.Registry.Screens[screenID]
			if s == nil {
				return // ref-unresolved reports it
			}
			on := platformsOf(p, s)
			for _, pl := range platforms {
				if !slices.Contains(on, pl) {
					continue
				}
				if s.Status.For(pl) == registry.Proposed || (region != "" && proposedRegion(p, s, region, pl)) {
					out = append(out, finding(id, file, line, where,
						"shipped flow references %s, which is proposed on %s", what, pl))
					return
				}
			}
		}
		if f.Entry != "" {
			check(f.Entry, "", frontMatterLine(p, file, f, "entry"), "entry", f.Entry)
		}
		for _, ref := range f.Refs {
			what := "@" + ref.Screen
			if ref.Region != "" {
				what += "#" + ref.Region
			}
			check(ref.Screen, ref.Region, ref.Line, "", what)
		}
	})
	return out
}

// --- vocabularies -----------------------------------------------------------

// vocabularyFields are the registry fields a vocabulary may validate.
var vocabularyFields = map[string]bool{"requires": true}

// loadVocabulary reads the requires vocabulary. It returns the allowed
// values (nil when there is no usable vocabulary) and any
// vocabulary-source-invalid findings. A file path that is not a valid
// project path is never opened; path-invalid reports it.
func loadVocabulary(p *project.Project) (map[string]bool, []diag.Diagnostic) {
	var out []diag.Diagnostic
	src := p.Sources[config.FileName]
	bad := func(line int, where, format string, args ...any) {
		out = append(out, finding("vocabulary-source-invalid", config.FileName, line, where, format, args...))
	}
	for _, key := range slices.Sorted(maps.Keys(p.Config.Vocabularies)) {
		if !vocabularyFields[key] {
			bad(keyLine(src, "vocabularies", key), "vocabularies."+key,
				"vocabularies.%s is not supported; only requires can have a vocabulary", key)
		}
	}
	v, ok := p.Config.Vocabularies["requires"]
	if !ok || strings.Contains(v.File, `\`) || !fs.ValidPath(v.File) {
		return nil, out
	}
	fileLine := valueLine(src, 0, "vocabularies", "requires", "file")
	selectLine := valueLine(src, 0, "vocabularies", "requires", "select")

	sel, selErr := selector.Compile(v.Select)
	if selErr != nil {
		bad(selectLine, "vocabularies.requires.select", "%v", selErr)
	}
	doc, docErr := readDocument(p.FS, v.File)
	if docErr != nil {
		bad(fileLine, "vocabularies.requires.file", "vocabulary %s: %v", v.File, docErr)
	}
	if selErr != nil || docErr != nil {
		return nil, out
	}
	values, err := sel.Strings(doc)
	if err != nil {
		bad(selectLine, "vocabularies.requires.select", "vocabulary %s: %v", v.File, err)
		return nil, out
	}
	set := map[string]bool{}
	for _, s := range values {
		set[s] = true
	}
	return set, out
}

// readDocument reads and decodes a .json, .yaml or .yml file.
func readDocument(fsys fs.FS, name string) (any, error) {
	data, err := fs.ReadFile(fsys, name)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, errors.New("file does not exist")
		}
		return nil, err
	}
	var v any
	switch path.Ext(name) {
	case ".json":
		if err := json.Unmarshal(data, &v); err != nil {
			return nil, fmt.Errorf("not valid JSON: %w", err)
		}
	case ".yaml", ".yml":
		n, ds := yamlx.Decode(data, name)
		if n == nil {
			return nil, fmt.Errorf("not valid YAML: %s", ds[0].Message)
		}
		if err := n.Decode(&v); err != nil {
			return nil, fmt.Errorf("not valid YAML: %w", err)
		}
	default:
		return nil, errors.New("must be a .json, .yaml or .yml file")
	}
	return v, nil
}

func ruleVocabularySourceInvalid(p *project.Project, _ *Context) []diag.Diagnostic {
	_, out := loadVocabulary(p)
	return out
}

func ruleVocabularyUnknown(p *project.Project, _ *Context) []diag.Diagnostic {
	allowed, _ := loadVocabulary(p)
	if allowed == nil {
		return nil
	}
	file := p.Config.Vocabularies["requires"].File
	var out []diag.Diagnostic
	screens(p, func(s *registry.Screen) {
		nodes(s, func(n node) {
			if n.Requires != "" && !allowed[n.Requires] {
				out = append(out, finding("vocabulary-unknown", registryFile(p), n.Line, n.Path+".requires",
					"requires %s is not in the vocabulary from %s", n.Requires, file))
			}
		})
	})
	return out
}
