// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package core

import (
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"math"
	"path"
	"slices"
	"strconv"
	"strings"

	"go.yaml.in/yaml/v3"

	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/flows"
	"github.com/c65llc/starboard/internal/format"
	"github.com/c65llc/starboard/internal/registry"
	"github.com/c65llc/starboard/internal/yamlx"
)

// The errors Edit returns besides those every function does.
var (
	// ErrUnknownOp: an EditOp's Op is not one Edit knows.
	ErrUnknownOp = errors.New("unknown edit op")
	// ErrBadPath: an EditOp's Path does not name a region of the screen.
	ErrBadPath = errors.New("invalid region path")
	// ErrBadEdit: an EditOp's Key, Value or Index cannot be applied.
	ErrBadEdit = errors.New("invalid edit")
)

// EditOp is one change to a project. Op says which:
//
//   - set: sets Key to Value on the screen Screen (Path "") or on the
//     region or nav item at Path. Key may be dotted, such as status.web or
//     layouts.tablet; missing mappings on the way are created. A null Value
//     removes the key.
//   - addScreen: Value is a mapping holding the new screen's id and its
//     fields, such as title, area and presentation.
//   - removeScreen: removes Screen.
//   - insertRegion: inserts the region mapping Value at Index among Path's
//     children: the top-level layout when Path is "", a layout override's
//     top level for layouts.<formFactor>, else the children of the region
//     at Path.
//   - removeRegion: removes the region or nav item at Path.
//   - moveRegion: moves the region or nav item at Path to Index within the
//     same list.
//   - setFlowMeta: sets Key in the front matter of the flow Flow, a flow
//     file's stem as Model gives it; a null Value removes it.
//   - writeFlowBody: Value is the flow's new body, everything after the
//     front matter, which is kept.
//   - addFlow: creates <content>/flows/<Flow>.md, Flow being a new flow ID
//     (flows.IDPattern), with front matter id: Flow plus Value's keys (a
//     mapping holding at least a title; only flow front matter keys) and an
//     empty Steps section.
//
// Path is a region path as Model gives it: layout[2].children[0],
// layout[1].item, layout[3].items[0] or layouts.tablet[0].
type EditOp struct {
	Op     string `json:"op"`
	Screen string `json:"screen"`
	Path   string `json:"path"`
	Key    string `json:"key"`
	Value  any    `json:"value"`
	Index  int    `json:"index"`
	Flow   string `json:"flow"`
}

// EditResult is an edit's outcome: the files it changed, in canonical
// form, and the lint findings of the edited project, not strict.
type EditResult struct {
	Files       map[string]string `json:"files"`
	Diagnostics []diag.Diagnostic `json:"diagnostics"`
}

// Edit applies ops to f in order and returns the files they change,
// formatted, and the lint of the result. Each op changes only the nodes it
// targets, so comments elsewhere stay; a removed node's own comments go
// with it. Edit is atomic: on any error it returns the error and an empty
// EditResult, and f is never changed. It returns ErrNotLoaded when
// starboard.yaml, or a file an op edits, does not parse.
func Edit(f Files, ops []EditOp) (EditResult, error) {
	_, p, _, err := load(f)
	if err != nil {
		return EditResult{}, err
	}
	if p == nil {
		return EditResult{}, ErrNotLoaded
	}
	content := path.Clean(p.Config.Content)
	if !fs.ValidPath(content) || strings.Contains(content, `\`) {
		return EditResult{}, fmt.Errorf("%w: content %s is outside the project", ErrNotLoaded, p.Config.Content)
	}
	e := &editor{
		content: content,
		regName: path.Join(content, registry.FileName),
		flows:   map[string]string{},
		docs:    map[string]*flowDoc{},
	}
	e.regSrc = f[e.regName]
	for _, file := range p.FlowFiles {
		e.flows[strings.TrimSuffix(path.Base(file), ".md")] = file
	}
	for i, op := range ops {
		if err := e.apply(op, f); err != nil {
			return EditResult{}, fmt.Errorf("op %d (%s): %w", i, op.Op, err)
		}
	}
	changed, err := e.output(p.Config.Areas)
	if err != nil {
		return EditResult{}, err
	}
	for name, data := range changed {
		if f[name] == data {
			delete(changed, name)
		}
	}
	next := maps.Clone(f)
	maps.Copy(next, changed)
	res, _ := Lint(next, false) // Lint fails only as load does, and load passed
	return EditResult{Files: changed, Diagnostics: res.Diagnostics}, nil
}

// editor holds the decoded files ops have touched.
type editor struct {
	content string
	regName string
	regSrc  string
	reg     *yaml.Node // the registry's document node, once decoded
	flows   map[string]string
	docs    map[string]*flowDoc // by stem, once decoded
}

// flowDoc is a flow split at its front matter. fm is nil while the front
// matter is untouched; raw keeps its text.
type flowDoc struct {
	hasFM bool
	raw   string
	fm    *yaml.Node
	body  string
}

var opNames = []string{"addFlow", "addScreen", "insertRegion", "moveRegion", "removeRegion", "removeScreen", "set", "setFlowMeta", "writeFlowBody"}

func (e *editor) apply(op EditOp, f Files) error {
	switch op.Op {
	case "setFlowMeta", "writeFlowBody":
		d, err := e.flow(op.Flow, f)
		if err != nil {
			return err
		}
		if op.Op == "writeFlowBody" {
			body, ok := op.Value.(string)
			if !ok {
				return fmt.Errorf("%w: a flow body must be a string", ErrBadEdit)
			}
			d.body = body
			return nil
		}
		if err := d.decode(op.Flow); err != nil {
			return err
		}
		return setKey(d.fm.Content[0], op.Key, op.Value)
	case "addScreen":
		return e.addScreen(op.Value)
	case "addFlow":
		return e.addFlow(op.Flow, op.Value, f)
	case "set", "removeScreen", "insertRegion", "removeRegion", "moveRegion":
		screens, err := e.screens()
		if err != nil {
			return err
		}
		i := pairIndex(screens, op.Screen)
		switch {
		case i < 0:
			return unknown(ErrUnknownScreen, op.Screen, mapKeys(screens))
		case op.Op == "removeScreen":
			screens.Content = slices.Delete(screens.Content, i, i+2)
			return nil
		case screens.Content[i+1].Kind != yaml.MappingNode:
			return fmt.Errorf("%w: screen %s is not a mapping", ErrBadEdit, op.Screen)
		}
		return regionOp(op, screens.Content[i+1])
	}
	return unknown(ErrUnknownOp, op.Op, opNames)
}

// regionOp applies a set, insertRegion, removeRegion or moveRegion to
// screen.
func regionOp(op EditOp, screen *yaml.Node) error {
	if op.Op == "insertRegion" {
		return insertRegion(screen, op)
	}
	if op.Op == "set" && op.Path == "" {
		return setKey(screen, op.Key, op.Value)
	}
	t, err := resolve(screen, op.Screen, op.Path)
	if err != nil {
		return err
	}
	switch {
	case op.Op == "set" && (t.kind == regionKind || t.kind == navItemKind):
		return setKey(t.node, op.Key, op.Value)
	case op.Op != "set" && t.parent != nil:
		if op.Op == "removeRegion" {
			t.parent.Content = slices.Delete(t.parent.Content, t.index, t.index+1)
			return nil
		}
		if err := inRange(op.Index, len(t.parent.Content)-1); err != nil {
			return err
		}
		t.parent.Content = slices.Insert(slices.Delete(t.parent.Content, t.index, t.index+1), op.Index, t.node)
		return nil
	}
	return fmt.Errorf("%w: %s: %s is not a region the op applies to", ErrBadPath, op.Path, op.Op)
}

func insertRegion(screen *yaml.Node, op EditOp) error {
	r, err := valueNode(op.Value)
	if err != nil {
		return err
	}
	if r.Kind != yaml.MappingNode {
		return fmt.Errorf("%w: a region must be a mapping", ErrBadEdit)
	}
	list, key := screen, "layout"
	if op.Path != "" {
		t, err := resolve(screen, op.Screen, op.Path)
		switch {
		case err != nil:
			return err
		case t.kind == regionListKind:
			if err := inRange(op.Index, len(t.node.Content)); err != nil {
				return err
			}
			t.node.Content = slices.Insert(t.node.Content, op.Index, r)
			return nil
		case t.kind != regionKind:
			return fmt.Errorf("%w: %s: regions go in a layout or a region's children", ErrBadPath, op.Path)
		}
		list, key = t.node, "children"
	}
	seq := lookup(list, key)
	if seq == nil || yamlx.IsNull(seq) {
		seq = &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
		setPair(list, key, seq)
	}
	if seq.Kind != yaml.SequenceNode {
		return fmt.Errorf("%w: %s is not a list", ErrBadEdit, yamlx.Join(op.Path, key))
	}
	if err := inRange(op.Index, len(seq.Content)); err != nil {
		return err
	}
	seq.Content = slices.Insert(seq.Content, op.Index, r)
	return nil
}

func inRange(i, last int) error {
	if i < 0 || i > last {
		return fmt.Errorf("%w: index %d is outside 0..%d", ErrBadEdit, i, last)
	}
	return nil
}

func (e *editor) addScreen(v any) error {
	n, err := valueNode(v)
	if err != nil {
		return err
	}
	if n.Kind != yaml.MappingNode {
		return fmt.Errorf("%w: a new screen must be a mapping with an id", ErrBadEdit)
	}
	i := pairIndex(n, "id")
	if i < 0 || n.Content[i+1].Kind != yaml.ScalarNode || n.Content[i+1].Value == "" {
		return fmt.Errorf("%w: a new screen needs an id", ErrBadEdit)
	}
	id := n.Content[i+1].Value
	n.Content = slices.Delete(n.Content, i, i+2)
	screens, err := e.screens()
	if err != nil {
		return err
	}
	if pairIndex(screens, id) >= 0 {
		return fmt.Errorf("%w: screen %s already exists", ErrBadEdit, id)
	}
	setPair(screens, id, n)
	return nil
}

// newFlowBody is a new flow's body: an empty Steps section.
const newFlowBody = "\n## Steps\n"

func (e *editor) addFlow(id string, v any, f Files) error {
	if !flows.IDPattern.MatchString(id) {
		return fmt.Errorf("%w: a flow ID is lowercase letters, digits and hyphens, starting with a letter, such as add-activity; not %q", ErrBadEdit, id)
	}
	file := path.Join(e.content, "flows", id+".md")
	if _, ok := e.flows[id]; ok {
		return fmt.Errorf("%w: flow %s already exists", ErrBadEdit, id)
	}
	if _, ok := f[file]; ok {
		return fmt.Errorf("%w: %s already exists", ErrBadEdit, file)
	}
	n, err := valueNode(v)
	if err != nil {
		return err
	}
	if n.Kind != yaml.MappingNode {
		return fmt.Errorf("%w: a new flow must be a mapping with a title", ErrBadEdit)
	}
	fm := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
	setPair(fm, "id", &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: id})
	for i := 0; i < len(n.Content); i += 2 {
		key := n.Content[i].Value
		if key == "id" || !slices.Contains(flows.Keys, key) {
			return fmt.Errorf("%w: a new flow's front matter may set %s, not %s", ErrBadEdit, strings.Join(flows.Keys[1:], ", "), key)
		}
	}
	for _, key := range flows.Keys[1:] {
		if val := lookup(n, key); val != nil && !yamlx.IsNull(val) {
			setPair(fm, key, val)
		}
	}
	if t := lookup(fm, "title"); t == nil || t.Kind != yaml.ScalarNode || t.Value == "" {
		return fmt.Errorf("%w: a new flow needs a title", ErrBadEdit)
	}
	e.flows[id] = file
	e.docs[id] = &flowDoc{hasFM: true, fm: &yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{fm}}, body: newFlowBody}
	return nil
}

// screens returns the registry's screens mapping, decoding the registry on
// first use. A missing or empty registry, or a null screens, starts one.
func (e *editor) screens() (*yaml.Node, error) {
	if e.reg == nil {
		doc, err := mappingDoc(e.regSrc, e.regName)
		if err != nil {
			return nil, err
		}
		e.reg = doc
	}
	root := e.reg.Content[0]
	screens := lookup(root, "screens")
	if screens == nil || yamlx.IsNull(screens) {
		screens = &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
		setPair(root, "screens", screens)
	}
	if screens.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("%w: %s: screens must be a mapping", ErrNotLoaded, e.regName)
	}
	return screens, nil
}

// flow returns the flow whose stem is id, split on first use.
func (e *editor) flow(id string, f Files) (*flowDoc, error) {
	if d, ok := e.docs[id]; ok {
		return d, nil
	}
	file, ok := e.flows[id]
	if !ok {
		return nil, unknown(ErrUnknownFlow, id, slices.Sorted(maps.Keys(e.flows)))
	}
	d := splitFlow(f[file])
	e.docs[id] = d
	return d, nil
}

// splitFlow splits a flow as the flow parser does: front matter only when
// the first line is --- and another --- closes it.
func splitFlow(src string) *flowDoc {
	text := strings.TrimPrefix(strings.ReplaceAll(src, "\r\n", "\n"), flows.BOM)
	lines := strings.Split(text, "\n")
	if flows.IsDelimiter(lines[0]) {
		for i := 1; i < len(lines); i++ {
			if flows.IsDelimiter(lines[i]) {
				return &flowDoc{hasFM: true, raw: strings.Join(lines[1:i], "\n"), body: strings.Join(lines[i+1:], "\n")}
			}
		}
	}
	return &flowDoc{body: text}
}

// decode reads d's front matter, an empty mapping when it has none.
func (d *flowDoc) decode(id string) error {
	if d.fm != nil {
		return nil
	}
	doc, err := mappingDoc(d.raw, "the front matter of "+id)
	d.hasFM, d.fm = true, doc
	return err
}

// mappingDoc decodes src, the YAML of what, as a document whose root is a
// mapping; an empty document gets an empty one.
func mappingDoc(src, what string) (*yaml.Node, error) {
	doc, ds := yamlx.DecodeDocument([]byte(src), what)
	switch {
	case doc == nil:
		return nil, fmt.Errorf("%w: %s does not parse: %s", ErrNotLoaded, what, ds[0].Message)
	case len(doc.Content) == 0:
		doc.Kind = yaml.DocumentNode
		doc.Content = []*yaml.Node{{Kind: yaml.MappingNode, Tag: "!!map"}}
	case doc.Content[0].Kind != yaml.MappingNode:
		return nil, fmt.Errorf("%w: %s must be a mapping", ErrNotLoaded, what)
	}
	return doc, nil
}

// output encodes and formats every file an op touched.
func (e *editor) output(areas []string) (map[string]string, error) {
	out := map[string]string{}
	if e.reg != nil {
		src, err := encodeYAML(e.reg)
		if err != nil {
			return nil, err
		}
		got, err := format.Screens([]byte(src), areas)
		if err != nil {
			return nil, fmt.Errorf("%w: %s cannot be formatted: %w", ErrBadEdit, e.regName, err)
		}
		out[e.regName] = string(got)
	}
	for id, d := range e.docs {
		var text strings.Builder
		if d.hasFM {
			fm := d.raw + "\n"
			if d.fm != nil {
				enc, err := encodeYAML(d.fm)
				if err != nil {
					return nil, err
				}
				fm = enc
			}
			text.WriteString("---\n" + fm + "---\n")
		}
		text.WriteString(d.body)
		got, err := format.Flow([]byte(text.String()))
		if err != nil {
			return nil, fmt.Errorf("%w: flow %s cannot be formatted: %w", ErrBadEdit, id, err)
		}
		out[e.flows[id]] = string(got)
	}
	return out, nil
}

// encodeYAML writes the edited documents, whose nodes are all decoded or
// built by valueNode; the formatter then gives each its canonical layout.
// The encoder fails only on a malformed node, which would be a bug in Edit.
func encodeYAML(doc *yaml.Node) (string, error) {
	data, err := yaml.Marshal(doc)
	if err != nil {
		return "", fmt.Errorf("%w: %w", ErrBadEdit, err)
	}
	return string(data), nil
}

// lookup returns the value of key in mapping m, or nil.
func lookup(m *yaml.Node, key string) *yaml.Node {
	if m == nil {
		return nil
	}
	if i := pairIndex(m, key); i >= 0 {
		return m.Content[i+1]
	}
	return nil
}

// pairIndex is the index of key's first occurrence in mapping m, or -1.
func pairIndex(m *yaml.Node, key string) int {
	if m.Kind != yaml.MappingNode {
		return -1
	}
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return i
		}
	}
	return -1
}

func mapKeys(m *yaml.Node) []string {
	var out []string
	for i := 0; i+1 < len(m.Content); i += 2 {
		out = append(out, m.Content[i].Value)
	}
	slices.Sort(out)
	return out
}

// setPair sets key to v in mapping m, adding it at the end when missing.
// A scalar replacing a scalar keeps the old one's comments.
func setPair(m *yaml.Node, key string, v *yaml.Node) {
	if i := pairIndex(m, key); i >= 0 {
		old := m.Content[i+1]
		if old.Kind == yaml.ScalarNode && v.Kind == yaml.ScalarNode {
			v.HeadComment, v.LineComment, v.FootComment = old.HeadComment, old.LineComment, old.FootComment
		}
		m.Content[i+1] = v
		return
	}
	k := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}
	m.Content = append(m.Content, k, v)
}

// setKey sets the dotted key in mapping m to value, creating the mappings
// on the way; a nil value removes the key.
func setKey(m *yaml.Node, key string, value any) error {
	parts := strings.Split(key, ".")
	if slices.Contains(parts, "") {
		return fmt.Errorf("%w: key %q must be a name or a dotted path of names", ErrBadEdit, key)
	}
	for i, k := range parts[:len(parts)-1] {
		next := lookup(m, k)
		if next == nil || yamlx.IsNull(next) {
			if value == nil {
				return nil // nothing to remove
			}
			next = &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
			setPair(m, k, next)
		}
		if next.Kind != yaml.MappingNode {
			return fmt.Errorf("%w: %s is not a mapping", ErrBadEdit, strings.Join(parts[:i+1], "."))
		}
		m = next
	}
	last := parts[len(parts)-1]
	if value == nil {
		if i := pairIndex(m, last); i >= 0 {
			m.Content = slices.Delete(m.Content, i, i+2)
		}
		return nil
	}
	v, err := valueNode(value)
	if err != nil {
		return err
	}
	setPair(m, last, v)
	return nil
}

// valueNode builds the YAML node for a value as JSON decodes one: nil, a
// string, a bool, a number, a list or a string-keyed map of them.
func valueNode(v any) (*yaml.Node, error) {
	scalar := func(tag, value string) *yaml.Node {
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: tag, Value: value}
	}
	switch v := v.(type) {
	case nil:
		return scalar("!!null", "null"), nil
	case string:
		n := &yaml.Node{}
		n.SetString(v)
		return n, nil
	case bool:
		return scalar("!!bool", strconv.FormatBool(v)), nil
	case int:
		return scalar("!!int", strconv.Itoa(v)), nil
	case float64:
		switch {
		case math.IsNaN(v) || math.IsInf(v, 0):
			return nil, fmt.Errorf("%w: %v is not a number YAML can hold", ErrBadEdit, v)
		case v == math.Trunc(v) && math.Abs(v) < 1e15:
			return scalar("!!int", strconv.FormatInt(int64(v), 10)), nil
		}
		return scalar("!!float", strconv.FormatFloat(v, 'g', -1, 64)), nil
	case []any:
		n := &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
		for _, c := range v {
			cn, err := valueNode(c)
			if err != nil {
				return nil, err
			}
			n.Content = append(n.Content, cn)
		}
		return n, nil
	case map[string]any:
		n := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
		for _, k := range slices.Sorted(maps.Keys(v)) {
			cn, err := valueNode(v[k])
			if err != nil {
				return nil, err
			}
			n.Content = append(n.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: k}, cn)
		}
		return n, nil
	}
	return nil, fmt.Errorf("%w: a value of type %T", ErrBadEdit, v)
}
