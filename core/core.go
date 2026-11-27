// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package core is Starboard's public, pure API: every function takes a
// project as Files, a map from project-relative slash path to contents,
// and returns values that marshal to JSON with lowerCamelCase field names,
// lists and maps never null. The field names are part of the API: the
// WebAssembly bundle and the web app read them. core never touches the
// operating system, so it compiles to js/wasm.
//
// Every function returns ErrInvalidPath for a key that is not a
// project-relative slash path and ErrNoProject when Files has no
// starboard.yaml.
package core

import (
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"path"
	"slices"
	"strconv"
	"strings"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/flows"
	"github.com/c65llc/starboard/internal/format"
	"github.com/c65llc/starboard/internal/generate"
	"github.com/c65llc/starboard/internal/lint"
	"github.com/c65llc/starboard/internal/project"
	"github.com/c65llc/starboard/internal/registry"
	"github.com/c65llc/starboard/internal/render"
)

// Files is a project: file contents keyed by project-relative slash path,
// such as "starboard.yaml" or "docs/flows/screens.yaml".
type Files map[string]string

// The errors core returns, each wrapped with the name it is about. Test
// for them with errors.Is.
var (
	// ErrNoProject: Files has no starboard.yaml.
	ErrNoProject = project.ErrNoProject
	// ErrInvalidPath: a key of Files is not a project-relative slash path.
	ErrInvalidPath = errors.New("file name must be a project-relative path written with /")
	// ErrNotLoaded: the project did not load cleanly enough for the
	// operation. Lint reports why.
	ErrNotLoaded = errors.New("the project has load errors; fix the errors lint reports, then retry")
	// ErrUnknownScreen: no screen has the ID asked for.
	ErrUnknownScreen = errors.New("unknown screen")
	// ErrUnknownFormFactor: no form factor has the name asked for.
	ErrUnknownFormFactor = errors.New("unknown form factor")
	// ErrNoFormFactor: no form factor was asked for and the screen has
	// none of its own.
	ErrNoFormFactor = errors.New("screen has no form factor")
	// ErrUnknownFlow: no flow has the ID asked for.
	ErrUnknownFlow = errors.New("unknown flow")
)

// load checks f's names and loads it as a project. p is nil when
// starboard.yaml does not parse; ds then says why.
func load(f Files) (project.MemFS, *project.Project, []diag.Diagnostic, error) {
	fsys := project.MemFS{}
	for name, data := range f {
		if !fs.ValidPath(name) || name == "." || strings.Contains(name, `\`) {
			return nil, nil, nil, fmt.Errorf("%w: %q", ErrInvalidPath, name)
		}
		fsys[name] = []byte(data)
	}
	p, ds, err := project.Load(fsys)
	return fsys, p, ds, err
}

// loadClean is load, refusing a project with any load error, as the CLI's
// generate and lint --fix do: generating from a partly read project would
// drop the pages of whatever was not read.
func loadClean(f Files) (project.MemFS, *project.Project, error) {
	fsys, p, ds, err := load(f)
	if err != nil {
		return nil, nil, err
	}
	if p == nil || hasErrors(ds) {
		return nil, nil, ErrNotLoaded
	}
	return fsys, p, nil
}

// loadAny is load, refusing only a project whose starboard.yaml does not
// parse.
func loadAny(f Files) (*project.Project, error) {
	_, p, _, err := load(f)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, ErrNotLoaded
	}
	return p, nil
}

func hasErrors(ds []diag.Diagnostic) bool {
	return slices.ContainsFunc(ds, func(d diag.Diagnostic) bool { return d.Severity == diag.Error })
}

func strs(m map[string][]byte) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = string(v)
	}
	return out
}

// unknown wraps err with name and the sorted choices.
func unknown(err error, name string, choices []string) error {
	return fmt.Errorf("%w: %s; use one of %s", err, name, strings.Join(choices, ", "))
}

// LintResult is a lint run: the sorted findings, how many are errors and
// warnings, and whether the run passed, which is what the CLI's exit
// status says: no errors and, when strict, no warnings.
type LintResult struct {
	Diagnostics []diag.Diagnostic `json:"diagnostics"`
	Errors      int               `json:"errors"`
	Warnings    int               `json:"warnings"`
	Passed      bool              `json:"passed"`
}

// Lint lints f as `starboard lint` does. Freshness of the generated files
// is checked only when the project loads without errors. A starboard.yaml
// that does not parse is a finding, not an error.
func Lint(f Files, strict bool) (LintResult, error) {
	_, p, ds, err := load(f)
	if err != nil {
		return LintResult{}, err
	}
	var generated map[string][]byte
	if p != nil && !hasErrors(ds) {
		generated = generate.All(p)
	}
	res := lint.Run(p, ds, lint.Options{Strict: strict, Generated: generated})
	return LintResult{
		Diagnostics: res.Diagnostics,
		Errors:      res.Errors,
		Warnings:    res.Warnings,
		Passed:      res.Errors == 0 && (!strict || res.Warnings == 0),
	}, nil
}

// Format returns the files `starboard fmt` would rewrite, in their
// canonical form; files already canonical are left out. A file that cannot
// be formatted is left out too, and lint reports it as not-formatted. When
// starboard.yaml does not parse, nothing is formatted.
func Format(f Files) (map[string]string, error) {
	_, p, _, err := load(f)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return map[string]string{}, nil
	}
	changed, _ := format.Project(p)
	return strs(changed), nil
}

// Generate returns every file `starboard generate` writes, keyed by
// project-relative path. It returns ErrNotLoaded for a project with load
// errors, as the CLI refuses one.
func Generate(f Files) (map[string]string, error) {
	_, p, err := loadClean(f)
	if err != nil {
		return nil, err
	}
	return strs(generate.All(p)), nil
}

// FixResult is what `starboard lint --fix` would do: the files to write,
// keyed by project-relative path, and the sorted files to remove.
type FixResult struct {
	Write  map[string]string `json:"write"`
	Remove []string          `json:"remove"`
}

// Fix returns the changes `starboard lint --fix` makes: the sources
// formatted, then the generated files written from the formatted sources,
// and every obsolete generated file removed. It returns ErrNotLoaded for a
// project with load errors, as the CLI refuses one.
func Fix(f Files) (FixResult, error) {
	fsys, p, err := loadClean(f)
	if err != nil {
		return FixResult{}, err
	}
	formatted, _ := format.Project(p) // what cannot be formatted stays a not-formatted finding
	maps.Copy(fsys, formatted)
	res := FixResult{Write: strs(formatted), Remove: []string{}}
	// Generate from the formatted sources, as the CLI does after writing them.
	p, ds, err := project.Load(fsys)
	if err != nil {
		return FixResult{}, err
	}
	if p != nil && !hasErrors(ds) { // formatting never breaks a project, but never generate from one
		ch := lint.Fix(p)
		maps.Copy(res.Write, strs(ch.Write))
		res.Remove = append(res.Remove, ch.Remove...)
	}
	return res, nil
}

// Render returns the SVG wireframe of the screen screenID on formFactor,
// the same bytes `starboard render` prints. An empty formFactor is the
// screen's first, as the CLI chooses.
func Render(f Files, screenID, formFactor string) (string, error) {
	p, err := loadAny(f)
	if err != nil {
		return "", err
	}
	s, ok := p.Registry.Screens[screenID]
	if !ok {
		return "", unknown(ErrUnknownScreen, screenID, slices.Sorted(maps.Keys(p.Registry.Screens)))
	}
	if formFactor == "" {
		ffs := generate.FormFactors(p, s)
		if len(ffs) == 0 {
			return "", fmt.Errorf("%w: %s; pass a form factor", ErrNoFormFactor, screenID)
		}
		formFactor = ffs[0]
	}
	size, err := formFactorSize(p, formFactor)
	if err != nil {
		return "", err
	}
	return string(render.Wireframe(s, formFactor, size)), nil
}

// formFactorSize is the configured size of the form factor name.
func formFactorSize(p *project.Project, name string) (config.FormFactor, error) {
	size, ok := p.Config.FormFactors[name]
	if !ok {
		return config.FormFactor{}, unknown(ErrUnknownFormFactor, name, slices.Sorted(maps.Keys(p.Config.FormFactors)))
	}
	return size, nil
}

// ModelResult is everything the web app lists: the screens in registry
// order and the flows in file order, and what its editor offers: the
// configured areas in config order, the form a screen ID must have (a
// regular expression), and every region kind and screen presentation,
// sorted.
type ModelResult struct {
	Screens   []Screen `json:"screens"`
	Flows     []Flow   `json:"flows"`
	Areas     []string `json:"areas"`
	IDPattern string   `json:"idPattern"`
	// RefPattern finds @screen.id#region references (internal/flows.RefPattern):
	// group 1 is what precedes the @, 2 the screen, 3 the region.
	RefPattern string `json:"refPattern"`
	// FlowIDPattern is the form of a new flow's ID, its file's stem.
	FlowIDPattern string `json:"flowIdPattern"`
	// FlowKeys are the front matter keys a flow may set.
	FlowKeys      []string `json:"flowKeys"`
	Kinds         []string `json:"kinds"`
	Presentations []string `json:"presentations"`
}

// Screen is one registered screen. Status is its status on each of
// Platforms, the configured platforms it is on in config order.
// FormFactors are those it is drawn on. Layout is the default region tree
// and Layouts the per-form-factor overrides. Edges are the default
// layout's, as the app map draws them. Files are its implementation files
// by platform, as written. Line is the line of its ID in screens.yaml.
type Screen struct {
	ID           string              `json:"id"`
	Title        string              `json:"title"`
	Area         string              `json:"area"`
	Purpose      string              `json:"purpose"`
	Presentation string              `json:"presentation"`
	Status       map[string]string   `json:"status"`
	Platforms    []string            `json:"platforms"`
	FormFactors  []string            `json:"formFactors"`
	Layout       []Region            `json:"layout"`
	Layouts      map[string][]Region `json:"layouts"`
	Edges        []Edge              `json:"edges"`
	Files        map[string][]string `json:"files"`
	Line         int                 `json:"line"`
}

// Region is one node of a layout tree. Width is as written: pixels such
// as "240", a fraction such as "1/3", or "". Path locates it in
// screens.yaml below the screen, such as "layout[1].item". Item and Empty
// are null unless the region is a list that has them.
type Region struct {
	Name         string      `json:"name"`
	Kind         string      `json:"kind"`
	Label        string      `json:"label"`
	To           string      `json:"to"`
	Requires     string      `json:"requires"`
	Status       string      `json:"status"`
	PlatformNote string      `json:"platformNote"`
	Width        string      `json:"width"`
	Children     []Region    `json:"children"`
	Item         *Region     `json:"item"`
	Empty        *EmptyState `json:"empty"`
	Items        []NavItem   `json:"items"`
	Path         string      `json:"path"`
	Line         int         `json:"line"`
}

// EmptyState is a list's empty state.
type EmptyState struct {
	Label string `json:"label"`
}

// NavItem is one entry of a tabs, nav or menu region.
type NavItem struct {
	Label    string `json:"label"`
	To       string `json:"to"`
	Requires string `json:"requires"`
	Status   string `json:"status"`
	Path     string `json:"path"`
	Line     int    `json:"line"`
}

// Edge is one navigation from a screen: a to on a region or nav item.
// Region is the region holding it, or a nameless list item's nearest named
// ancestor.
type Edge struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Region string `json:"region"`
	Path   string `json:"path"`
	Line   int    `json:"line"`
}

// Flow is one flow document. ID is its file's stem, the key Walkthrough
// takes; lint's flow-id-mismatch keeps the front matter id equal to it.
type Flow struct {
	ID     string `json:"id"`
	File   string `json:"file"`
	Title  string `json:"title"`
	Status string `json:"status"`
	Entry  string `json:"entry"`
	// FrontMatterID is the front matter's id, which lint keeps equal to ID.
	FrontMatterID string     `json:"frontMatterId"`
	Actors        []string   `json:"actors"`
	Platforms     []string   `json:"platforms"`
	Steps         []FlowStep `json:"steps"`
}

// FlowStep is one numbered step. Screen and Region are its first
// reference's, or "" when it has none. Branches are its sub-bullets.
type FlowStep struct {
	Number   int      `json:"number"`
	Text     string   `json:"text"`
	Screen   string   `json:"screen"`
	Region   string   `json:"region"`
	Branches []string `json:"branches"`
	Line     int      `json:"line"`
}

// Model returns f's screens and flows as far as they loaded: a registry
// that does not parse gives no screens. It returns ErrNotLoaded only when
// starboard.yaml does not parse.
func Model(f Files) (ModelResult, error) {
	p, err := loadAny(f)
	if err != nil {
		return ModelResult{}, err
	}
	m := ModelResult{
		Screens: []Screen{}, Flows: []Flow{},
		Areas:         nonNil(slices.Clone(p.Config.Areas)),
		IDPattern:     registry.IDPattern.String(),
		RefPattern:    flows.RefPattern.String(),
		FlowIDPattern: flows.IDPattern.String(),
		FlowKeys:      slices.Clone(flows.Keys),
		Kinds:         slices.Sorted(maps.Keys(registry.Kinds)),
		Presentations: slices.Sorted(maps.Keys(registry.Presentations)),
	}
	for _, id := range p.Registry.Order {
		m.Screens = append(m.Screens, screenOf(p, p.Registry.Screens[id]))
	}
	for _, file := range p.FlowFiles {
		stem := strings.TrimSuffix(path.Base(file), ".md")
		m.Flows = append(m.Flows, flowOf(stem, file, p))
	}
	return m, nil
}

func screenOf(p *project.Project, s *registry.Screen) Screen {
	out := Screen{
		ID: s.ID, Title: s.Title, Area: s.Area, Purpose: s.Purpose, Presentation: s.Presentation,
		Status:      map[string]string{},
		Platforms:   nonNil(generate.Platforms(p, s)),
		FormFactors: nonNil(generate.FormFactors(p, s)),
		Layout:      regionsOf(s.Layout, "layout"),
		Layouts:     map[string][]Region{},
		Edges:       []Edge{},
		Files:       map[string][]string{},
		Line:        s.Line,
	}
	for pl, paths := range s.Files {
		out.Files[pl] = nonNil(paths)
	}
	for _, pl := range out.Platforms {
		out.Status[pl] = s.Status.For(pl)
	}
	for ff, tree := range s.Layouts {
		out.Layouts[ff] = regionsOf(tree, "layouts."+ff)
	}
	for _, e := range registry.Edges(s, "") {
		out.Edges = append(out.Edges, Edge{From: e.From, To: e.To, Region: e.Region, Path: e.Path, Line: e.Line})
	}
	return out
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// regionsOf converts a tree whose path is root, with the paths
// registry.WalkFrom gives.
func regionsOf(rs []*registry.Region, root string) []Region {
	out := make([]Region, 0, len(rs))
	for i, r := range rs {
		out = append(out, regionOf(r, fmt.Sprintf("%s[%d]", root, i)))
	}
	return out
}

func regionOf(r *registry.Region, at string) Region {
	out := Region{
		Name: r.Name, Kind: r.Kind, Label: r.Label, To: r.To, Requires: r.Requires, Status: r.Status,
		PlatformNote: r.PlatformNote, Width: widthOf(r.Width),
		Children: regionsOf(r.Children, at+".children"),
		Items:    make([]NavItem, 0, len(r.Items)),
		Path:     at, Line: r.Line,
	}
	if r.Item != nil {
		item := regionOf(r.Item, at+".item")
		out.Item = &item
	}
	if r.Empty != nil {
		out.Empty = &EmptyState{Label: r.Empty.Label}
	}
	for i, it := range r.Items {
		out.Items = append(out.Items, NavItem{
			Label: it.Label, To: it.To, Requires: it.Requires, Status: it.Status,
			Path: fmt.Sprintf("%s.items[%d]", at, i), Line: it.Line,
		})
	}
	return out
}

// widthOf writes w as screens.yaml does.
func widthOf(w registry.Width) string {
	switch {
	case w.Px > 0:
		return strconv.Itoa(w.Px)
	case w.Den > 0:
		return fmt.Sprintf("%d/%d", w.Num, w.Den)
	}
	return ""
}

func flowOf(stem, file string, p *project.Project) Flow {
	fl := p.Flows[stem]
	out := Flow{
		ID: stem, File: file, Title: fl.Title, Status: fl.Status, Entry: fl.Entry, FrontMatterID: fl.ID,
		Actors: nonNil(slices.Clone(fl.Actors)), Platforms: nonNil(slices.Clone(fl.Platforms)), Steps: []FlowStep{},
	}
	for _, st := range fl.Steps {
		step := FlowStep{Number: st.Number, Text: st.Text, Branches: nonNil(st.Branches), Line: st.Line}
		if st.Ref != nil {
			step.Screen, step.Region = st.Ref.Screen, st.Ref.Region
		}
		out.Steps = append(out.Steps, step)
	}
	return out
}
