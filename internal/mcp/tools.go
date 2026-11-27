// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package mcp

import (
	"bytes"
	"cmp"
	"encoding/base64"
	"encoding/json"
	"io/fs"
	"maps"
	"path"
	"slices"
	"strings"

	"github.com/c65llc/starboard/core"
	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/generate"
	"github.com/c65llc/starboard/internal/lint"
	"github.com/c65llc/starboard/internal/project"
	"github.com/c65llc/starboard/internal/registry"
)

// tool is one MCP tool. A write tool is left out in read-only mode.
type tool struct {
	name, title, description string
	input                    map[string]any // the JSON Schema of the arguments
	write                    bool
	run                      func(s *server, args json.RawMessage) (toolResult, error)
}

// toolInfo is a tool as tools/list describes it.
type toolInfo struct {
	Name        string         `json:"name"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	Annotations map[string]any `json:"annotations"`
}

// Schema helpers: an object of properties, some required, no others.
func object(required []string, props map[string]any) map[string]any {
	s := map[string]any{"type": "object", "properties": props, "additionalProperties": false}
	if len(required) > 0 {
		s["required"] = required
	}
	return s
}

func str(description string) map[string]any {
	return map[string]any{"type": "string", "description": description}
}

func enum(description string, values ...string) map[string]any {
	return map[string]any{"type": "string", "description": description, "enum": values}
}

// tools is every tool, in the order tools/list gives them.
var tools = []tool{
	{
		name: "starboard_screen_get", title: "Get a screen",
		description: "One registered screen as the reference holds it: title, area, purpose, presentation, status and files per platform, form factors, the layout tree (each region with its path), per-form-factor layout overrides and navigation edges; the flows that name it; and recordVersion, to pass to starboard_screen_set as baseVersion.",
		input:       object([]string{"id"}, map[string]any{"id": str("The screen ID, such as trip.timeline.")}),
		run:         screenGet,
	},
	{
		name: "starboard_flow_get", title: "Get a flow",
		description: "One flow: its front matter (title, status, entry, actors, platforms), its numbered steps with each step's screen and region, every screen it names with whether that screen is registered, and recordVersion, to pass to starboard_flow_set as baseVersion.",
		input:       object([]string{"id"}, map[string]any{"id": str("The flow ID, its file name without .md, such as add-activity.")}),
		run:         flowGet,
	},
	{
		name: "starboard_query", title: "Find screens and flows",
		description: "List the screens and flows that match every filter given; with none, list them all. A flow matches an area when it names a screen in it, and a platform when it applies to it. Flows have no presentation, so that filter leaves only screens.",
		input: object(nil, map[string]any{
			"kind":         enum("List only screens or only flows. Default: both.", "screens", "flows"),
			"area":         str("A configured area, such as trip."),
			"platform":     str("A configured platform, such as ios."),
			"status":       enum("A status. For screens, the status on platform when one is given, else on any platform.", "shipped", "proposed"),
			"presentation": str("A screen presentation: root, push, tab, sheet, dialog, window or route."),
		}),
		run: query,
	},
	{
		name: "starboard_refs", title: "Find references",
		description: "Everything that refers to a screen or a region: each @screen.id or @screen.id#region in a flow (its file, line and whether it is in the diagram), each flow whose entry it is, and, for a screen, each navigation (a region's or nav item's to) that leads to it.",
		input:       object([]string{"target"}, map[string]any{"target": str("A screen ID or a region: trip.timeline, @trip.timeline or @trip.timeline#add-activity.")}),
		run:         refs,
	},
	{
		name: "starboard_lint", title: "Lint the project",
		description: "Check the project as starboard lint --json does and return its report: {\"version\":1,\"errors\":[…],\"warnings\":[…]}, each finding with rule, severity, file, path, line, message, fix and docs. Act on the rule, not the wording.",
		input: object(nil, map[string]any{
			"files": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Only report findings in these project-relative files, such as docs/flows/screens.yaml."},
		}),
		run: lintTool,
	},
	{
		name: "starboard_render", title: "Render a wireframe",
		description: "A screen's grey-box wireframe as SVG, the same bytes starboard render prints, for one form factor. By default the SVG is returned as text; format image returns it as image/svg+xml image content for clients that display SVG.",
		input: object([]string{"screen"}, map[string]any{
			"screen":     str("The screen ID."),
			"formFactor": str("The form factor to draw, such as phone or web-wide. Default: the screen's first."),
			"region":     str("A region name to outline, as the web app shows the selected region."),
			"format":     enum("text (default) or image.", "text", "image"),
		}),
		run: render,
	},
	{
		name: "starboard_rules", title: "List lint rules",
		description: "Every lint rule as starboard rules --json lists it: ID, kind (correctness or quality), default severity, summary and documentation page.",
		input:       object(nil, map[string]any{}),
		run:         rules,
	},
	{
		name: "starboard_screen_set", title: "Create, update or delete a screen", write: true,
		description: "Create a screen, set or remove fields of one, or delete one, in the registry. Call it with preview: true first. Each key of fields is set to its value; a key may be dotted, such as files.ios or layouts.web-wide, and null removes it. A value replaces the key's whole value, so a layout is given as a whole tree of regions. Other keys and their comments stay. The registry is written formatted exactly as starboard fmt formats it, even when the change has lint errors; the result lists the files written, the screen's new recordVersion and the project's lint report.",
		input: object([]string{"id"}, map[string]any{
			"id":          str("The screen ID, such as trip.timeline. A new ID creates the screen."),
			"fields":      map[string]any{"type": "object", "description": "Fields to set, such as {\"title\": \"Timeline\", \"area\": \"trip\", \"status.web\": \"proposed\"}. Not id."},
			"delete":      map[string]any{"type": "boolean", "description": "Delete the screen instead. References to it are left for lint to report."},
			"preview":     map[string]any{"type": "boolean", "description": "Write nothing; return the files the edit would write, in full, and the lint report they would give. Preview first, then repeat the call without it."},
			"baseVersion": str("The recordVersion your read returned. If the record has changed since, the edit is refused as a conflict and nothing is written."),
		}),
		run: screenSet,
	},
	{
		name: "starboard_flow_set", title: "Create or update a flow", write: true,
		description: "Create a flow file, or set its front matter keys or replace its body. Call it with preview: true first. frontMatter keys are set to their values; null removes one. body replaces everything after the front matter. A new flow needs a frontMatter title. The file is written formatted exactly as starboard fmt formats it, even when the change has lint errors; the result lists the files written, the flow's new recordVersion and the project's lint report.",
		input: object([]string{"id"}, map[string]any{
			"id":          str("The flow ID, the file name without .md: lowercase letters, digits and hyphens, such as add-activity. A new ID creates <content>/flows/<id>.md."),
			"frontMatter": map[string]any{"type": "object", "description": "Front matter keys to set: title, status, actors, entry, platforms. Not id."},
			"body":        str("The new body: everything after the front matter, such as a Goal line, a Mermaid diagram and a ## Steps list."),
			"preview":     map[string]any{"type": "boolean", "description": "Write nothing; return the files the edit would write, in full, and the lint report they would give. Preview first, then repeat the call without it."},
			"baseVersion": str("The recordVersion your read returned. If the record has changed since, the edit is refused as a conflict and nothing is written."),
		}),
		run: flowSet,
	},
	{
		name: "starboard_generate", title: "Regenerate the generated pages", write: true,
		description: "Write <content>/generated (the app map, the screen catalog and the wireframes) as starboard generate does, and remove pages that are no longer generated. Refused while the project has load errors. Call it with preview: true first to list what would change.",
		input:       object(nil, map[string]any{"preview": map[string]any{"type": "boolean", "description": "List what would be written or removed, and change nothing."}}),
		run:         generateTool,
	},
}

// ToolSpec is a tool's wire name and whether it writes, for the tests that
// keep the shipped skills in step with the server.
type ToolSpec struct {
	Name   string
	Writes bool
}

// Tools lists every tool the server can offer, in tools/list order.
func Tools() []ToolSpec {
	out := make([]ToolSpec, len(tools))
	for i, t := range tools {
		out[i] = ToolSpec{Name: t.name, Writes: t.write}
	}
	return out
}

// listTools describes the tools the session offers.
func (s *server) listTools() []toolInfo {
	out := []toolInfo{}
	for _, t := range tools {
		if t.write && s.opts.ReadOnly {
			continue
		}
		ann := map[string]any{"title": t.title, "readOnlyHint": !t.write, "openWorldHint": false}
		if t.write {
			// Every write replaces what was there, and screen_set deletes.
			ann["destructiveHint"] = true
			ann["idempotentHint"] = true
		}
		out = append(out, toolInfo{Name: t.name, Title: t.title, Description: t.description, InputSchema: t.input, Annotations: ann})
	}
	return out
}

// tool finds the tool name among those the session offers.
func (s *server) tool(name string) (tool, bool) {
	i := slices.IndexFunc(tools, func(t tool) bool { return t.name == name })
	if i < 0 || (tools[i].write && s.opts.ReadOnly) {
		return tool{}, false
	}
	return tools[i], true
}

// decodeArgs decodes a tool's arguments into v, refusing unknown ones so a
// misspelt argument fails instead of being ignored.
func decodeArgs(raw json.RawMessage, v any) error {
	if len(bytes.TrimSpace(raw)) == 0 || string(bytes.TrimSpace(raw)) == "null" {
		raw = json.RawMessage("{}")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return argsError(err)
	}
	return nil
}

// encodeJSON encodes v as the CLI encodes its --json reports.
func encodeJSON(v any) []byte {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v) // the results are plain structs, maps and slices, which always encode
	return b.Bytes()
}

// load reads the project, refusing one whose starboard.yaml does not parse.
func (s *server) load() (*project.Project, []diag.Diagnostic, error) {
	p, ds, err := project.Load(s.fsys)
	if err != nil {
		return nil, nil, err
	}
	if p == nil {
		return nil, nil, failf("starboard.yaml does not parse; starboard_lint reports why: fix that, then retry")
	}
	return p, ds, nil
}

// model is core's model of the project's sources.
func (s *server) model() (*project.Project, core.ModelResult, error) {
	p, _, err := s.load()
	if err != nil {
		return nil, core.ModelResult{}, err
	}
	m, err := core.Model(sources(p))
	return p, m, err
}

// sources is what core reads of a project: starboard.yaml, the registry
// and the flow files.
func sources(p *project.Project) core.Files {
	f := core.Files{}
	for name, data := range p.Sources {
		f[name] = string(data)
	}
	return f
}

// flowRef is a flow as another result names it.
type flowRef struct {
	ID    string `json:"id"`
	File  string `json:"file"`
	Title string `json:"title"`
}

func screenGet(s *server, raw json.RawMessage) (toolResult, error) {
	var a struct {
		ID string `json:"id"`
	}
	if err := decodeArgs(raw, &a); err != nil {
		return toolResult{}, err
	}
	p, m, err := s.model()
	if err != nil {
		return toolResult{}, err
	}
	i := slices.IndexFunc(m.Screens, func(sc core.Screen) bool { return sc.ID == a.ID })
	if i < 0 {
		return toolResult{}, failf("unknown screen %q; starboard_query lists the screens", a.ID)
	}
	used := []flowRef{}
	for _, fl := range m.Flows {
		if slices.Contains(fl.Screens, a.ID) {
			used = append(used, flowRef{ID: fl.ID, File: fl.File, Title: fl.Title})
		}
	}
	return fencedJSON(encodeJSON(struct {
		Version       int         `json:"version"`
		RecordVersion string      `json:"recordVersion"`
		Screen        core.Screen `json:"screen"`
		Flows         []flowRef   `json:"flows"`
	}{1, screenVersion(p, a.ID), m.Screens[i], used})), nil
}

// screenRef is a screen as a flow names it.
type screenRef struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Area       string `json:"area"`
	Registered bool   `json:"registered"`
}

func flowGet(s *server, raw json.RawMessage) (toolResult, error) {
	var a struct {
		ID string `json:"id"`
	}
	if err := decodeArgs(raw, &a); err != nil {
		return toolResult{}, err
	}
	p, m, err := s.model()
	if err != nil {
		return toolResult{}, err
	}
	i := slices.IndexFunc(m.Flows, func(fl core.Flow) bool { return fl.ID == a.ID })
	if i < 0 {
		return toolResult{}, failf("unknown flow %q; starboard_query lists the flows", a.ID)
	}
	fl := m.Flows[i]
	named := []screenRef{}
	for _, id := range fl.Screens {
		ref := screenRef{ID: id}
		if j := slices.IndexFunc(m.Screens, func(sc core.Screen) bool { return sc.ID == id }); j >= 0 {
			ref.Title, ref.Area, ref.Registered = m.Screens[j].Title, m.Screens[j].Area, true
		}
		named = append(named, ref)
	}
	return fencedJSON(encodeJSON(struct {
		Version       int         `json:"version"`
		RecordVersion string      `json:"recordVersion"`
		Flow          core.Flow   `json:"flow"`
		Screens       []screenRef `json:"screens"`
	}{1, flowVersion(p, a.ID), fl, named})), nil
}

// screenSummary and flowSummary are query's rows.
type screenSummary struct {
	ID           string            `json:"id"`
	Title        string            `json:"title"`
	Area         string            `json:"area"`
	Presentation string            `json:"presentation"`
	Platforms    []string          `json:"platforms"`
	Status       map[string]string `json:"status"`
}

type flowSummary struct {
	ID        string   `json:"id"`
	File      string   `json:"file"`
	Title     string   `json:"title"`
	Status    string   `json:"status"`
	Entry     string   `json:"entry"`
	Platforms []string `json:"platforms"`
}

func query(s *server, raw json.RawMessage) (toolResult, error) {
	var a struct {
		Kind         string `json:"kind"`
		Area         string `json:"area"`
		Platform     string `json:"platform"`
		Status       string `json:"status"`
		Presentation string `json:"presentation"`
	}
	if err := decodeArgs(raw, &a); err != nil {
		return toolResult{}, err
	}
	if a.Kind != "" && a.Kind != "screens" && a.Kind != "flows" {
		return toolResult{}, failf("invalid kind %q; use screens or flows, or leave it out for both", a.Kind)
	}
	_, m, err := s.model()
	if err != nil {
		return toolResult{}, err
	}
	areaOf := map[string]string{}
	res := struct {
		Version int             `json:"version"`
		Screens []screenSummary `json:"screens"`
		Flows   []flowSummary   `json:"flows"`
	}{Version: 1, Screens: []screenSummary{}, Flows: []flowSummary{}}
	for _, sc := range m.Screens {
		areaOf[sc.ID] = sc.Area
		if a.Kind != "flows" && screenMatches(sc, a.Area, a.Platform, a.Status, a.Presentation) {
			res.Screens = append(res.Screens, screenSummary{
				ID: sc.ID, Title: sc.Title, Area: sc.Area, Presentation: sc.Presentation, Platforms: sc.Platforms, Status: sc.Status,
			})
		}
	}
	for _, fl := range m.Flows {
		switch {
		case a.Kind == "screens", a.Presentation != "",
			a.Area != "" && !slices.ContainsFunc(fl.Screens, func(id string) bool { return areaOf[id] == a.Area }),
			a.Platform != "" && len(fl.Platforms) > 0 && !slices.Contains(fl.Platforms, a.Platform),
			a.Status != "" && fl.Status != a.Status:
			continue
		}
		res.Flows = append(res.Flows, flowSummary{ID: fl.ID, File: fl.File, Title: fl.Title, Status: fl.Status, Entry: fl.Entry, Platforms: fl.Platforms})
	}
	return fencedJSON(encodeJSON(res)), nil
}

func screenMatches(sc core.Screen, area, platform, status, presentation string) bool {
	switch {
	case area != "" && sc.Area != area,
		presentation != "" && sc.Presentation != presentation,
		platform != "" && !slices.Contains(sc.Platforms, platform):
		return false
	case status == "":
		return true
	case platform != "":
		return sc.Status[platform] == status
	}
	return slices.Contains(slices.Collect(maps.Values(sc.Status)), status)
}

// reference is one place that refers to a screen or region. Kind is entry
// (a flow's entry), flow (an @ reference in a flow's text), diagram (one
// in its Mermaid diagram) or navigation (a to in the registry).
type reference struct {
	Kind   string `json:"kind"`
	File   string `json:"file"`
	Line   int    `json:"line,omitempty"`
	Flow   string `json:"flow,omitempty"`
	Screen string `json:"screen,omitempty"`
	Region string `json:"region,omitempty"`
	Path   string `json:"path,omitempty"`
}

func refs(s *server, raw json.RawMessage) (toolResult, error) {
	var a struct {
		Target string `json:"target"`
	}
	if err := decodeArgs(raw, &a); err != nil {
		return toolResult{}, err
	}
	screen, region, _ := strings.Cut(strings.TrimPrefix(a.Target, "@"), "#")
	if !registry.IDPattern.MatchString(screen) {
		return toolResult{}, failf("invalid target %q; write a screen ID such as trip.timeline, or @trip.timeline#region", a.Target)
	}
	p, _, err := s.load()
	if err != nil {
		return toolResult{}, err
	}
	found := []reference{}
	for _, file := range p.FlowFiles {
		stem := strings.TrimSuffix(path.Base(file), ".md")
		fl := p.Flows[stem]
		if fl.Entry == screen && region == "" {
			found = append(found, reference{Kind: "entry", File: file, Flow: stem})
		}
		for _, r := range fl.Refs {
			if r.Screen != screen || (region != "" && r.Region != region) {
				continue
			}
			kind := "flow"
			if r.InDiagram {
				kind = "diagram"
			}
			found = append(found, reference{Kind: kind, File: file, Line: r.Line, Flow: stem, Region: r.Region})
		}
	}
	if region == "" {
		regName := path.Join(path.Clean(p.Config.Content), registry.FileName)
		for _, id := range p.Registry.Order {
			sc := p.Registry.Screens[id]
			for _, ff := range append([]string{""}, slices.Sorted(maps.Keys(sc.Layouts))...) {
				for _, e := range registry.Edges(sc, ff) {
					if e.To == screen {
						found = append(found, reference{Kind: "navigation", File: regName, Line: e.Line, Screen: id, Region: e.Region, Path: e.Path})
					}
				}
			}
		}
	}
	slices.SortStableFunc(found, func(x, y reference) int {
		return cmp.Or(strings.Compare(x.File, y.File), cmp.Compare(x.Line, y.Line), strings.Compare(x.Kind, y.Kind), strings.Compare(x.Path, y.Path))
	})
	_, registered := p.Registry.Screens[screen]
	return fencedJSON(encodeJSON(struct {
		Version    int         `json:"version"`
		Screen     string      `json:"screen"`
		Region     string      `json:"region"`
		Registered bool        `json:"registered"`
		References []reference `json:"references"`
	}{1, screen, region, registered, found})), nil
}

// lintReport lints the project in fsys as starboard lint --json does and
// returns its report, narrowed to files when any are given.
func lintReport(fsys fs.FS, files []string) ([]byte, error) {
	p, ds, err := project.Load(fsys)
	if err != nil {
		return nil, err
	}
	var generated map[string][]byte
	if p != nil && !hasErrors(ds) { // as the CLI: freshness only for a project that loaded cleanly
		generated = generate.All(p)
	}
	found := lint.Run(p, ds, lint.Options{Generated: generated}).Diagnostics
	if len(files) > 0 {
		clean := make([]string, len(files))
		for i, f := range files {
			clean[i] = strings.TrimPrefix(path.Clean(f), "./")
		}
		found = slices.DeleteFunc(found, func(d diag.Diagnostic) bool { return !slices.Contains(clean, d.File) })
	}
	var b bytes.Buffer
	_ = diag.WriteJSON(&b, found) // a bytes.Buffer never fails a write
	return b.Bytes(), nil
}

func hasErrors(ds []diag.Diagnostic) bool {
	return slices.ContainsFunc(ds, func(d diag.Diagnostic) bool { return d.Severity == diag.Error })
}

func lintTool(s *server, raw json.RawMessage) (toolResult, error) {
	var a struct {
		Files []string `json:"files"`
	}
	if err := decodeArgs(raw, &a); err != nil {
		return toolResult{}, err
	}
	report, err := lintReport(s.fsys, a.Files)
	if err != nil {
		return toolResult{}, err
	}
	return fencedJSON(report), nil
}

func render(s *server, raw json.RawMessage) (toolResult, error) {
	var a struct {
		Screen     string `json:"screen"`
		FormFactor string `json:"formFactor"`
		Region     string `json:"region"`
		Format     string `json:"format"`
	}
	if err := decodeArgs(raw, &a); err != nil {
		return toolResult{}, err
	}
	if a.Format != "" && a.Format != "text" && a.Format != "image" {
		return toolResult{}, failf("invalid format %q; use text or image", a.Format)
	}
	p, _, err := s.load()
	if err != nil {
		return toolResult{}, err
	}
	svg, err := core.RenderHighlighted(sources(p), a.Screen, a.FormFactor, a.Region)
	if err != nil {
		return toolResult{}, err
	}
	if a.Format == "image" {
		// An image is pixels to the model, not text it could read as
		// instructions; the rule still follows it.
		return toolResult{Content: []content{
			{Type: "image", Data: base64.StdEncoding.EncodeToString([]byte(svg)), MimeType: "image/svg+xml"},
			{Type: "text", Text: UntrustedDataRule},
		}}, nil
	}
	return fencedSVG(svg), nil
}

func rules(_ *server, raw json.RawMessage) (toolResult, error) {
	if err := decodeArgs(raw, &struct{}{}); err != nil {
		return toolResult{}, err
	}
	var b bytes.Buffer
	_ = lint.WriteRulesJSON(&b) // a bytes.Buffer never fails a write
	return fencedJSON(b.Bytes()), nil
}

// checkBase refuses an edit when the caller read the record at a version
// other than now. An empty base skips the check.
func checkBase(base, now, what string) error {
	if base == "" || base == now {
		return nil
	}
	if now == "" {
		return failf("conflict: %s no longer exists; read the project again before you edit it", what)
	}
	return failf("conflict: %s changed since you read it (baseVersion %q, now %s); read it again and redo your edit on what is there now", what, base, now)
}

// edit applies ops to the project's sources with core.Edit. With preview it
// writes nothing and returns the files the edit would write, linted as they
// would be; otherwise it writes them. Either way the result carries the
// edited record's new version, from version, and the lint report.
func (s *server) edit(p *project.Project, ops []core.EditOp, preview bool, versionOf func(*project.Project) string) (toolResult, error) {
	res, err := core.Edit(sources(p), ops)
	if err != nil {
		return toolResult{audit: audit{preview: preview}}, err
	}
	written := nonNil(slices.Sorted(maps.Keys(res.Files)))
	after := fs.FS(s.fsys)
	if preview {
		over := project.MemFS{}
		for name, data := range res.Files {
			over[name] = []byte(data)
		}
		after = overlay{base: s.fsys, files: over}
	} else {
		for _, name := range written {
			if err := s.fsys.WriteFile(name, []byte(res.Files[name])); err != nil {
				return toolResult{audit: audit{preview: preview}}, err
			}
		}
	}
	done := audit{preview: preview}
	if !preview {
		done.written = written
	}
	report, err := lintReport(after, nil)
	if err != nil {
		return toolResult{audit: done}, err // the files are written: the audit line says so
	}
	version := ""
	if next, _, _ := project.Load(after); next != nil { // lintReport just loaded it, but a nil one would panic
		version = versionOf(next)
	}
	out := struct {
		Version       int             `json:"version"`
		Preview       bool            `json:"preview"`
		Written       []string        `json:"written"`
		Files         any             `json:"files,omitempty"` // a preview's files; absent from a write
		RecordVersion string          `json:"recordVersion"`
		Lint          json.RawMessage `json:"lint"`
	}{Version: 1, Preview: preview, Written: written, RecordVersion: version, Lint: report}
	if preview {
		files := res.Files
		if files == nil {
			files = map[string]string{}
		}
		out.Files = files
	}
	result := fencedJSON(encodeJSON(out))
	result.audit = done
	return result, nil
}

func hasKey(m map[string]any, key string) bool {
	_, ok := m[key]
	return ok
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func screenSet(s *server, raw json.RawMessage) (toolResult, error) {
	var a struct {
		ID          string         `json:"id"`
		Fields      map[string]any `json:"fields"`
		Delete      bool           `json:"delete"`
		Preview     bool           `json:"preview"`
		BaseVersion string         `json:"baseVersion"`
	}
	if err := decodeArgs(raw, &a); err != nil {
		return toolResult{}, err
	}
	switch {
	case a.ID == "":
		return toolResult{}, failf("id is required: the screen ID, such as trip.timeline")
	case a.Delete && len(a.Fields) > 0:
		return toolResult{}, failf("pass fields to set, or delete: true, not both")
	case !a.Delete && len(a.Fields) == 0:
		return toolResult{}, failf("fields is empty: pass the fields to set, such as {\"title\": \"Timeline\"}, or delete: true")
	case hasKey(a.Fields, "id"):
		return toolResult{}, failf("fields may not set id; the screen's ID is the id argument")
	}
	p, _, err := s.load()
	if err != nil {
		return toolResult{}, err
	}
	if err := checkBase(a.BaseVersion, screenVersion(p, a.ID), "screen "+a.ID); err != nil {
		return toolResult{}, err
	}
	var ops []core.EditOp
	_, exists := p.Registry.Screens[a.ID]
	switch {
	case a.Delete:
		ops = append(ops, core.EditOp{Op: "removeScreen", Screen: a.ID})
	case !exists && !registry.IDPattern.MatchString(a.ID):
		return toolResult{}, failf("invalid screen ID %q: two or more dot-separated parts of lowercase letters, digits and hyphens, each starting with a letter, such as trip.timeline", a.ID)
	case !exists:
		ops = append(ops, core.EditOp{Op: "addScreen", Value: map[string]any{"id": a.ID}})
	}
	for _, key := range slices.Sorted(maps.Keys(a.Fields)) {
		ops = append(ops, core.EditOp{Op: "set", Screen: a.ID, Key: key, Value: a.Fields[key]})
	}
	return s.edit(p, ops, a.Preview, func(next *project.Project) string { return screenVersion(next, a.ID) })
}

func flowSet(s *server, raw json.RawMessage) (toolResult, error) {
	var a struct {
		ID          string         `json:"id"`
		FrontMatter map[string]any `json:"frontMatter"`
		Body        *string        `json:"body"`
		Preview     bool           `json:"preview"`
		BaseVersion string         `json:"baseVersion"`
	}
	if err := decodeArgs(raw, &a); err != nil {
		return toolResult{}, err
	}
	switch {
	case a.ID == "":
		return toolResult{}, failf("id is required: the flow ID, such as add-activity")
	case len(a.FrontMatter) == 0 && a.Body == nil:
		return toolResult{}, failf("nothing to set: pass frontMatter, body or both")
	case hasKey(a.FrontMatter, "id"):
		return toolResult{}, failf("frontMatter may not set id; a flow's ID is its file name, the id argument")
	}
	p, _, err := s.load()
	if err != nil {
		return toolResult{}, err
	}
	if err := checkBase(a.BaseVersion, flowVersion(p, a.ID), "flow "+a.ID); err != nil {
		return toolResult{}, err
	}
	var ops []core.EditOp
	if _, exists := p.Flows[a.ID]; exists {
		for _, key := range slices.Sorted(maps.Keys(a.FrontMatter)) {
			ops = append(ops, core.EditOp{Op: "setFlowMeta", Flow: a.ID, Key: key, Value: a.FrontMatter[key]})
		}
	} else {
		fm := map[string]any{}
		maps.Copy(fm, a.FrontMatter)
		ops = append(ops, core.EditOp{Op: "addFlow", Flow: a.ID, Value: fm})
	}
	if a.Body != nil {
		ops = append(ops, core.EditOp{Op: "writeFlowBody", Flow: a.ID, Value: *a.Body})
	}
	return s.edit(p, ops, a.Preview, func(next *project.Project) string { return flowVersion(next, a.ID) })
}

func generateTool(s *server, raw json.RawMessage) (toolResult, error) {
	var a struct {
		Preview bool `json:"preview"`
	}
	if err := decodeArgs(raw, &a); err != nil {
		return toolResult{}, err
	}
	p, ds, err := s.load()
	if err != nil {
		return toolResult{audit: audit{preview: a.Preview}}, err
	}
	// As the CLI: generating from a partly read project would remove the
	// pages of everything that was not read.
	if hasErrors(ds) {
		return toolResult{audit: audit{preview: a.Preview}}, failf("the project has load errors, so nothing was generated; starboard_lint reports them: fix them, then retry")
	}
	gen := generate.All(p)
	changes, err := generate.Diff(p, gen)
	if err != nil {
		return toolResult{}, err
	}
	res := struct {
		Version int      `json:"version"`
		Preview bool     `json:"preview"`
		Written []string `json:"written"`
		Removed []string `json:"removed"`
	}{Version: 1, Preview: a.Preview, Written: []string{}, Removed: []string{}}
	done := audit{preview: a.Preview}
	for _, ch := range changes {
		if ch.Kind == generate.Extra {
			if !a.Preview {
				if err := s.fsys.Remove(ch.Path); err != nil {
					return toolResult{audit: done}, err
				}
				done.removed = append(done.removed, ch.Path)
			}
			res.Removed = append(res.Removed, ch.Path)
			continue
		}
		if !a.Preview {
			if err := s.fsys.WriteFile(ch.Path, gen[ch.Path]); err != nil {
				return toolResult{audit: done}, err
			}
			done.written = append(done.written, ch.Path)
		}
		res.Written = append(res.Written, ch.Path)
	}
	result := fencedJSON(encodeJSON(res))
	result.audit = done
	return result, nil
}
