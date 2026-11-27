// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package registry parses screens.yaml, the screen registry, into a model of
// screens and their layout trees, and walks those trees for regions and
// edges.
package registry

import "regexp"

// FileName is the registry's name; diagnostics from Parse carry it.
const FileName = "screens.yaml"

// The status values a screen, region or nav item may have.
const (
	Shipped  = "shipped"
	Proposed = "proposed"
)

// Status is a screen's status: one value for every platform (All), or one
// per platform (Per).
type Status struct {
	All string
	Per map[string]string
}

// For returns the status on platform: Per[platform], else All, else shipped.
func (s Status) For(platform string) string {
	if v, ok := s.Per[platform]; ok {
		return v
	}
	if s.All != "" {
		return s.All
	}
	return Shipped
}

// NavItem is one entry of a tabs, nav or menu region's items.
type NavItem struct {
	Label, To, Requires, Status string
	Line                        int
}

// Empty is a list's empty state.
type Empty struct{ Label string }

// Width is a region's width within a row: Px pixels, or the fraction
// Num/Den. It is the zero value when unset.
type Width struct{ Px, Num, Den int }

// Region is one node of a layout tree. Children is set only on containers,
// Item and Empty only on lists, and Items only on navigation kinds.
type Region struct {
	Name, Kind, Label, To, Requires, Status, PlatformNote string
	Width                                                 Width
	Children                                              []*Region
	Item                                                  *Region
	Empty                                                 *Empty
	Items                                                 []NavItem
	Line                                                  int
}

// Screen is one registered screen. Files and Screenshots are keyed by
// platform, Layouts by form factor. Line is the line of the screen's ID;
// FieldLines holds the line of each field written, keyed by its name.
type Screen struct {
	ID, Title, Area, Purpose, Presentation, PlatformNote string
	Status                                               Status
	Platforms                                            []string
	States                                               []string
	Files                                                map[string][]string
	Screenshots                                          map[string]string
	Layout                                               []*Region
	Layouts                                              map[string][]*Region
	Line                                                 int
	FieldLines                                           map[string]int
}

// FieldLine is the line of the field named, or the screen's own line when
// the field is not written.
func (s *Screen) FieldLine(field string) int {
	if n, ok := s.FieldLines[field]; ok {
		return n
	}
	return s.Line
}

// LayoutFor returns the layout for formFactor: its override if there is
// one, else the default layout.
func (s *Screen) LayoutFor(formFactor string) []*Region {
	if l, ok := s.Layouts[formFactor]; ok {
		return l
	}
	return s.Layout
}

// LayoutPath returns the path of the tree LayoutFor gives for formFactor:
// "layouts.<formFactor>" for an override, else "layout".
func (s *Screen) LayoutPath(formFactor string) string {
	if _, ok := s.Layouts[formFactor]; ok {
		return "layouts." + formFactor
	}
	return "layout"
}

// Unmapped is a screen-pattern file deliberately left out of the registry.
type Unmapped struct {
	Path, Reason string
	Line         int
}

// Registry is a parsed screens.yaml. Order is the screen IDs in file order.
type Registry struct {
	Screens  map[string]*Screen
	Order    []string
	Unmapped []Unmapped
}

// Containers are the kinds that may hold children.
var Containers = map[string]bool{"column": true, "row": true, "section": true, "bar": true}

// NavKinds are the navigation kinds, the ones that may hold items.
var NavKinds = map[string]bool{"tabs": true, "nav": true, "menu": true}

// Kinds is every region kind the renderer knows.
var Kinds = map[string]bool{
	"column": true, "row": true, "section": true, "bar": true,
	"tabs": true, "nav": true, "menu": true,
	"header": true, "text": true, "list": true, "card": true, "media": true,
	"map": true, "banner": true, "form": true, "field": true,
	"action": true, "primary-action": true,
}

// Presentations are the ways a screen may be presented.
var Presentations = map[string]bool{
	"root": true, "push": true, "tab": true, "sheet": true,
	"dialog": true, "window": true, "route": true,
}

// IDPattern is the form of a screen ID: two or more dot-separated segments.
var IDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`)

// RegionPattern is the form of a region name.
var RegionPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
