// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package registry

import (
	"fmt"
	"regexp"
	"strconv"

	"go.yaml.in/yaml/v3"

	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/yamlx"
)

// parser accumulates diagnostics while walking the document.
type parser struct {
	yamlx.Parser
}

// Parse reads screens.yaml. The Registry is nil only when the YAML itself
// cannot be read or holds more than one document (yaml-syntax), or uses
// anchors, aliases or merge keys (yaml-alias-not-allowed). Any other problem
// is reported and the rest of the file is still parsed. Every diagnostic's
// File is screens.yaml, and they are sorted.
func Parse(data []byte) (*Registry, []diag.Diagnostic) {
	root, ds := yamlx.Decode(data, FileName)
	if root == nil {
		return nil, ds
	}
	p := parser{yamlx.Parser{File: FileName, Invalid: "schema-invalid"}}
	reg := &Registry{Screens: map[string]*Screen{}}
	p.root(root, reg)
	diag.Sort(p.Diags)
	return reg, p.Diags
}

var topKeys = map[string]bool{"screens": true, "unmapped": true}

func (p *parser) root(n *yaml.Node, reg *Registry) {
	entries, _ := p.Mapping(n, "", topKeys)
	for _, e := range entries {
		switch e.Key {
		case "screens":
			p.screens(e, reg)
		case "unmapped":
			p.unmapped(e, reg)
		}
	}
}

// screens reads the screens mapping by hand: a repeated ID is a
// duplicate-screen, not a duplicate key.
func (p *parser) screens(e yamlx.Entry, reg *Registry) {
	n := e.V
	if yamlx.IsNull(n) {
		return
	}
	if n.Kind != yaml.MappingNode {
		p.Invalidf(n, e.Field, "%s must be a mapping", e.Field)
		return
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		k, v := n.Content[i], n.Content[i+1]
		path := yamlx.Join(e.Field, k.Value)
		if first, dup := reg.Screens[k.Value]; dup {
			p.Report("duplicate-screen", k, path, "screen %s is already defined on line %d", k.Value, first.Line)
			continue
		}
		if !IDPattern.MatchString(k.Value) {
			p.Report("id-invalid", k, path,
				"screen ID %s must be two or more dot-separated segments of lowercase letters, digits and hyphens, each starting with a letter", k.Value)
		}
		s := &Screen{ID: k.Value, Line: k.Line}
		reg.Screens[k.Value] = s
		reg.Order = append(reg.Order, k.Value)
		p.screen(k, v, path, s)
	}
}

var screenKeys = map[string]bool{
	"title": true, "area": true, "purpose": true, "presentation": true,
	"status": true, "platforms": true, "states": true, "files": true,
	"screenshots": true, "layout": true, "layouts": true, "platformNote": true,
}

// requiredScreenKeys must be present on every screen. purpose is optional:
// the missing-purpose quality rule covers it.
var requiredScreenKeys = []string{"title", "area", "presentation"}

// screen reads one screen's fields; k is its ID's key node.
func (p *parser) screen(k, n *yaml.Node, path string, s *Screen) {
	fields, ok := p.Mapping(n, path, screenKeys)
	if !ok {
		return
	}
	present := map[string]bool{}
	for _, f := range fields {
		present[f.Key] = true
	}
	for _, key := range requiredScreenKeys {
		if !present[key] {
			p.Invalidf(k, path, "%s.%s is required", path, key)
		}
	}
	s.FieldLines = map[string]int{}
	for _, f := range fields {
		s.FieldLines[f.Key] = f.K.Line
		switch f.Key {
		case "title":
			s.Title, _ = p.Str(f.V, f.Field)
		case "area":
			s.Area, _ = p.Str(f.V, f.Field)
		case "purpose":
			s.Purpose, _ = p.Str(f.V, f.Field)
		case "platformNote":
			s.PlatformNote, _ = p.Str(f.V, f.Field)
		case "presentation":
			if v, ok := p.Str(f.V, f.Field); ok {
				s.Presentation = v
				if !Presentations[v] {
					p.Report("unknown-presentation", f.V, f.Field,
						"unknown presentation %s; use root, push, tab, sheet, dialog, window or route", v)
				}
			}
		case "status":
			s.Status = p.screenStatus(f)
		case "platforms":
			s.Platforms = yamlx.Values(p.StrList(f.V, f.Field))
		case "states":
			s.States = yamlx.Values(p.StrList(f.V, f.Field))
		case "files":
			s.Files = p.files(f)
		case "screenshots":
			s.Screenshots = p.screenshots(f)
		case "layout":
			s.Layout = p.tree(f.V, f.Field)
		case "layouts":
			s.Layouts = p.layouts(f)
		}
	}
}

// status returns n's value if it is shipped or proposed.
func (p *parser) status(n *yaml.Node, path string) (string, bool) {
	if n.Kind == yaml.ScalarNode && n.Tag == "!!str" && (n.Value == Shipped || n.Value == Proposed) {
		return n.Value, true
	}
	p.Invalidf(n, path, "%s must be shipped or proposed", path)
	return "", false
}

// screenStatus reads a scalar status or a mapping of platform to status.
func (p *parser) screenStatus(f yamlx.Entry) Status {
	switch f.V.Kind {
	case yaml.ScalarNode:
		v, _ := p.status(f.V, f.Field)
		return Status{All: v}
	case yaml.MappingNode:
		entries, _ := p.Mapping(f.V, f.Field, nil)
		st := Status{Per: map[string]string{}}
		for _, e := range entries {
			if v, ok := p.status(e.V, e.Field); ok {
				st.Per[e.Key] = v
			}
		}
		return st
	}
	p.Invalidf(f.V, f.Field, "%s must be shipped or proposed, or a mapping of platform to either", f.Field)
	return Status{}
}

func (p *parser) files(f yamlx.Entry) map[string][]string {
	entries, _ := p.Mapping(f.V, f.Field, nil)
	if len(entries) == 0 {
		return nil
	}
	out := map[string][]string{}
	for _, e := range entries {
		out[e.Key] = yamlx.Values(p.StrList(e.V, e.Field))
	}
	return out
}

func (p *parser) screenshots(f yamlx.Entry) map[string]string {
	entries, _ := p.Mapping(f.V, f.Field, nil)
	if len(entries) == 0 {
		return nil
	}
	out := map[string]string{}
	for _, e := range entries {
		if v, ok := p.Str(e.V, e.Field); ok {
			out[e.Key] = v
		}
	}
	return out
}

func (p *parser) layouts(f yamlx.Entry) map[string][]*Region {
	entries, _ := p.Mapping(f.V, f.Field, nil)
	if len(entries) == 0 {
		return nil
	}
	out := map[string][]*Region{}
	for _, e := range entries {
		out[e.Key] = p.tree(e.V, e.Field)
	}
	return out
}

// tree reads one layout tree. Region names are unique within it, including
// inside list items.
func (p *parser) tree(n *yaml.Node, path string) []*Region {
	return p.regions(n, path, map[string]bool{})
}

func (p *parser) regions(n *yaml.Node, path string, names map[string]bool) []*Region {
	if yamlx.IsNull(n) {
		return nil
	}
	if n.Kind != yaml.SequenceNode {
		p.Invalidf(n, path, "%s must be a list of regions", path)
		return nil
	}
	var out []*Region
	for i, c := range n.Content {
		if r := p.region(c, fmt.Sprintf("%s[%d]", path, i), names, true); r != nil {
			out = append(out, r)
		}
	}
	return out
}

var regionKeys = map[string]bool{
	"region": true, "kind": true, "label": true, "to": true, "requires": true,
	"status": true, "platformNote": true, "width": true, "children": true,
	"item": true, "empty": true, "items": true,
}

// region reads one region node; named says whether its region name is
// required. It returns nil only when n is not a mapping.
func (p *parser) region(n *yaml.Node, path string, names map[string]bool, named bool) *Region {
	fields, ok := p.Mapping(n, path, regionKeys)
	if !ok {
		return nil
	}
	r := &Region{Line: n.Line}
	var children, item, empty, items *yamlx.Entry
	hasName, hasKind := false, false
	for i := range fields {
		f := &fields[i]
		switch f.Key {
		case "region":
			hasName = true
			if v, ok := p.Str(f.V, f.Field); ok {
				r.Name = v
				p.name(f.V, f.Field, v, names)
			}
		case "kind":
			hasKind = true
			if v, ok := p.Str(f.V, f.Field); ok {
				r.Kind = v
				if !Kinds[v] {
					p.Report("unknown-kind", f.V, f.Field, "unknown region kind %s", v)
				}
			}
		case "label":
			r.Label, _ = p.Str(f.V, f.Field)
		case "to":
			r.To, _ = p.Str(f.V, f.Field)
		case "requires":
			r.Requires, _ = p.Str(f.V, f.Field)
		case "platformNote":
			r.PlatformNote, _ = p.Str(f.V, f.Field)
		case "status":
			r.Status, _ = p.status(f.V, f.Field)
		case "width":
			r.Width = p.width(f.V, f.Field)
		case "children":
			children = f
		case "item":
			item = f
		case "empty":
			empty = f
		case "items":
			items = f
		}
	}
	if named && !hasName {
		p.Invalidf(n, path, "%s.region is required", path)
	}
	if !hasKind {
		p.Invalidf(n, path, "%s.kind is required", path)
	}
	// A missing or unknown kind is reported once; its subtree is still read.
	known := Kinds[r.Kind]
	if children != nil {
		if known && !Containers[r.Kind] {
			p.Invalidf(n, children.Field, "children is allowed only on column, row, section and bar, not %s", r.Kind)
		} else {
			r.Children = p.regions(children.V, children.Field, names)
		}
	}
	if item != nil {
		if known && r.Kind != "list" {
			p.Invalidf(n, item.Field, "item is allowed only on list, not %s", r.Kind)
		} else {
			r.Item = p.region(item.V, item.Field, names, false)
		}
	}
	if empty != nil {
		if known && r.Kind != "list" {
			p.Invalidf(n, empty.Field, "empty is allowed only on list, not %s", r.Kind)
		} else {
			r.Empty = p.empty(empty.V, empty.Field)
		}
	}
	if items != nil {
		if known && !NavKinds[r.Kind] {
			p.Invalidf(n, items.Field, "items is allowed only on tabs, nav and menu, not %s", r.Kind)
		} else {
			r.Items = p.navItems(items.V, items.Field)
		}
	}
	return r
}

// name checks a region name's form and its uniqueness within the tree.
func (p *parser) name(n *yaml.Node, path, v string, names map[string]bool) {
	if !RegionPattern.MatchString(v) {
		p.Report("id-invalid", n, path, "region name %s must match %s", v, RegionPattern)
	}
	if names[v] {
		p.Report("duplicate-region", n, path, "region %s is already used in this layout", v)
	}
	names[v] = true
}

var fractionRE = regexp.MustCompile(`^([1-9][0-9]*)/([1-9][0-9]*)$`)

// width reads a positive pixel count or a string fraction no greater than 1.
func (p *parser) width(n *yaml.Node, path string) Width {
	if n.Kind == yaml.ScalarNode {
		switch n.Tag {
		case "!!int":
			var v int
			if n.Decode(&v) == nil && v > 0 {
				return Width{Px: v}
			}
		case "!!str":
			if m := fractionRE.FindStringSubmatch(n.Value); m != nil {
				num, errNum := strconv.Atoi(m[1])
				den, errDen := strconv.Atoi(m[2])
				if errNum == nil && errDen == nil && num <= den {
					return Width{Num: num, Den: den}
				}
			}
		}
	}
	p.Invalidf(n, path, "%s must be a positive integer (pixels) or a fraction such as \"1/3\"", path)
	return Width{}
}

var emptyKeys = map[string]bool{"label": true}

func (p *parser) empty(n *yaml.Node, path string) *Empty {
	fields, ok := p.Mapping(n, path, emptyKeys)
	if !ok {
		return nil
	}
	e := &Empty{}
	if len(fields) == 0 {
		p.Invalidf(n, path, "%s.label is required", path)
	}
	for _, f := range fields {
		e.Label, _ = p.Str(f.V, f.Field)
	}
	return e
}

var navItemKeys = map[string]bool{"label": true, "to": true, "requires": true, "status": true}

func (p *parser) navItems(n *yaml.Node, path string) []NavItem {
	if yamlx.IsNull(n) {
		return nil
	}
	if n.Kind != yaml.SequenceNode {
		p.Invalidf(n, path, "%s must be a list", path)
		return nil
	}
	var out []NavItem
	for i, c := range n.Content {
		ip := fmt.Sprintf("%s[%d]", path, i)
		fields, ok := p.Mapping(c, ip, navItemKeys)
		if !ok {
			continue
		}
		it := NavItem{Line: c.Line}
		hasLabel := false
		for _, f := range fields {
			switch f.Key {
			case "label":
				hasLabel = true
				it.Label, _ = p.Str(f.V, f.Field)
			case "to":
				it.To, _ = p.Str(f.V, f.Field)
			case "requires":
				it.Requires, _ = p.Str(f.V, f.Field)
			case "status":
				it.Status, _ = p.status(f.V, f.Field)
			}
		}
		if !hasLabel {
			p.Invalidf(c, ip, "%s.label is required", ip)
		}
		out = append(out, it)
	}
	return out
}

var unmappedKeys = map[string]bool{"path": true, "reason": true}

// unmapped reads the unmapped list; an entry with a problem is dropped.
func (p *parser) unmapped(e yamlx.Entry, reg *Registry) {
	if yamlx.IsNull(e.V) {
		return
	}
	if e.V.Kind != yaml.SequenceNode {
		p.Invalidf(e.V, e.Field, "%s must be a list", e.Field)
		return
	}
	for i, c := range e.V.Content {
		ip := fmt.Sprintf("%s[%d]", e.Field, i)
		fields, ok := p.Mapping(c, ip, unmappedKeys)
		if !ok {
			continue
		}
		got := map[string]string{}
		valid := true
		for _, f := range fields {
			s, ok := p.Str(f.V, f.Field)
			valid = valid && ok
			got[f.Key] = s
		}
		for _, k := range []string{"path", "reason"} {
			if _, present := got[k]; !present && valid {
				p.Invalidf(c, ip, "%s.%s is required", ip, k)
				valid = false
			}
		}
		if valid {
			reg.Unmapped = append(reg.Unmapped, Unmapped{Path: got["path"], Reason: got["reason"], Line: c.Line})
		}
	}
}
