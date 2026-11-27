// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package format

import (
	"bytes"
	"cmp"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"go.yaml.in/yaml/v3"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/flows"
	"github.com/c65llc/starboard/internal/registry"
	"github.com/c65llc/starboard/internal/yamlx"
)

// MaxFlowWidth is the widest line, in runes, a node is written on in flow
// style ({…} or […]), counting its indent and the "- " or "key: " before it.
const MaxFlowWidth = 100

// The canonical key orders. A key not listed keeps its place relative to the
// other unlisted keys, after the listed ones.
var (
	configKeys   = []string{"version", "content", "platforms", "formFactors", "vocabularies", "areas", "lint"}
	platformKeys = []string{"formFactors", "roots", "screenFiles"}
	topKeys      = []string{"screens", "unmapped"}
	screenKeys   = []string{
		"title", "area", "purpose", "presentation", "status", "platforms", "platformNote",
		"states", "files", "screenshots", "layout", "layouts",
	}
	regionKeys = []string{
		"region", "kind", "label", "to", "requires", "status", "platformNote", "width",
		"children", "item", "empty", "items",
	}
	navItemKeys  = []string{"label", "to", "requires", "status"}
	unmappedKeys = []string{"path", "reason"}
	flowKeys     = []string{"id", "title", "status", "actors", "entry", "platforms"}
)

// leafSet holds the mappings that may be written in flow style: layout
// regions with no children, item or items, and navigation items.
type leafSet map[*yaml.Node]bool

// shaper puts a document's keys and entries in canonical order and marks the
// mappings that may go in flow style.
type shaper func(root *yaml.Node, leaves leafSet)

// Config formats starboard.yaml: keys in canonical order, at top level and
// in each platform; 2-space indent; LF line endings and a final newline.
func Config(src []byte) ([]byte, error) {
	return formatYAML(src, config.FileName, configShape)
}

func configShape(root *yaml.Node, _ leafSet) {
	reorder(root, configKeys)
	for _, platforms := range values(root, "platforms") {
		for _, p := range mapValues(platforms) {
			reorder(p, platformKeys)
		}
	}
}

// Screens formats screens.yaml: keys in canonical order; screens ordered by
// their area's index in areaOrder (unknown areas last), then by ID; each
// layout region with no children, item or items, and each navigation item,
// on one line when it fits in MaxFlowWidth runes; 2-space indent; LF line
// endings and a final newline.
func Screens(src []byte, areaOrder []string) ([]byte, error) {
	return formatYAML(src, registry.FileName, screensShape(areaOrder))
}

func screensShape(areaOrder []string) shaper {
	return func(root *yaml.Node, leaves leafSet) {
		reorder(root, topKeys)
		for _, screens := range values(root, "screens") {
			sortScreens(screens, areaOrder)
			for _, s := range mapValues(screens) {
				reorder(s, screenKeys)
				for _, l := range values(s, "layout") {
					regions(l, leaves)
				}
				for _, ls := range values(s, "layouts") {
					for _, l := range mapValues(ls) {
						regions(l, leaves)
					}
				}
			}
		}
		for _, u := range values(root, "unmapped") {
			for _, e := range seqItems(u) {
				reorder(e, unmappedKeys)
			}
		}
	}
}

// frontMatter formats a flow document's front matter YAML.
func frontMatter(src []byte) ([]byte, error) {
	return formatYAML(src, "front matter", frontMatterShape)
}

func frontMatterShape(root *yaml.Node, _ leafSet) {
	reorder(root, flowKeys)
}

func regions(seq *yaml.Node, leaves leafSet) {
	for _, r := range seqItems(seq) {
		region(r, leaves)
	}
}

func region(n *yaml.Node, leaves leafSet) {
	if n.Kind != yaml.MappingNode {
		return
	}
	reorder(n, regionKeys)
	leaf := true
	for i := 0; i+1 < len(n.Content); i += 2 {
		v := n.Content[i+1]
		switch n.Content[i].Value {
		case "children":
			leaf = false
			regions(v, leaves)
		case "item":
			leaf = false
			region(v, leaves)
		case "items":
			leaf = false
			for _, it := range seqItems(v) {
				reorder(it, navItemKeys)
				leaves[it] = true
			}
		}
	}
	leaves[n] = leaf
}

// sortScreens orders the screens mapping by area rank, then ID. A repeated
// ID takes the rank of its first occurrence, so it stays after it.
func sortScreens(m *yaml.Node, areaOrder []string) {
	rank := map[string]int{}
	for i := 0; i+1 < len(m.Content); i += 2 {
		if _, seen := rank[m.Content[i].Value]; !seen {
			rank[m.Content[i].Value] = areaRank(m.Content[i+1], areaOrder)
		}
	}
	sortPairs(m, func(a, b *yaml.Node) int {
		return cmp.Or(cmp.Compare(rank[a.Value], rank[b.Value]), strings.Compare(a.Value, b.Value))
	})
}

// areaRank is the index of screen's area in areaOrder, or len(areaOrder).
func areaRank(screen *yaml.Node, areaOrder []string) int {
	// Only the first area key counts, as in the parser.
	if as := values(screen, "area"); len(as) > 0 && as[0].Kind == yaml.ScalarNode {
		if i := slices.Index(areaOrder, as[0].Value); i >= 0 {
			return i
		}
	}
	return len(areaOrder)
}

// reorder sorts m's keys by their index in order, keeping unlisted keys in
// their relative order after the listed ones. Anything but a mapping is
// left alone.
func reorder(m *yaml.Node, order []string) {
	rank := func(k *yaml.Node) int {
		if i := slices.Index(order, k.Value); i >= 0 && k.Kind == yaml.ScalarNode {
			return i
		}
		return len(order)
	}
	sortPairs(m, func(a, b *yaml.Node) int { return cmp.Compare(rank(a), rank(b)) })
}

// sortPairs stably sorts a mapping's key/value pairs by their keys.
func sortPairs(m *yaml.Node, by func(a, b *yaml.Node) int) {
	if m.Kind != yaml.MappingNode {
		return
	}
	pairs := make([][2]*yaml.Node, 0, len(m.Content)/2)
	for i := 0; i+1 < len(m.Content); i += 2 {
		pairs = append(pairs, [2]*yaml.Node{m.Content[i], m.Content[i+1]})
	}
	slices.SortStableFunc(pairs, func(a, b [2]*yaml.Node) int { return by(a[0], b[0]) })
	m.Content = m.Content[:0]
	for _, p := range pairs {
		m.Content = append(m.Content, p[0], p[1])
	}
}

// values returns the values of every key in mapping m.
func values(m *yaml.Node, key string) []*yaml.Node {
	var out []*yaml.Node
	if m.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(m.Content); i += 2 {
		if k := m.Content[i]; k.Kind == yaml.ScalarNode && k.Value == key {
			out = append(out, m.Content[i+1])
		}
	}
	return out
}

// mapValues returns every value of mapping m.
func mapValues(m *yaml.Node) []*yaml.Node {
	var out []*yaml.Node
	if m.Kind != yaml.MappingNode {
		return nil
	}
	for i := 1; i < len(m.Content); i += 2 {
		out = append(out, m.Content[i])
	}
	return out
}

// seqItems returns the items of sequence n.
func seqItems(n *yaml.Node) []*yaml.Node {
	if n.Kind != yaml.SequenceNode {
		return nil
	}
	return n.Content
}

// maxPasses bounds how many times formatYAML re-reads its own output.
const maxPasses = 4

// formatYAML is the shared formatter: settle with maxPasses.
func formatYAML(src []byte, name string, shape shaper) ([]byte, error) {
	out, _, err := settle(src, name, shape, maxPasses)
	return out, err
}

// settle runs pass until the output is a fixed point: the YAML reader does
// not always put a comment back on the node the writer wrote it after, so
// one pass can move a comment that the next leaves alone. It re-reads its
// output at most limit times, and returns how many passes made new output
// (1 when the first pass is already a fixed point). It fails if the output
// does not settle, or if it would change the data or drop a comment.
func settle(src []byte, name string, shape shaper, limit int) ([]byte, int, error) {
	out, err := pass(src, name, shape)
	if err != nil {
		return nil, 0, err
	}
	for passes := 1; passes <= limit; passes++ {
		next, err := pass(out, name, shape)
		if err != nil {
			return nil, 0, err
		}
		if bytes.Equal(next, out) {
			if !sameData(src, out) {
				return nil, 0, errors.New(name + ": formatting would change the data")
			}
			if m := missingComment(src, out); m != "" {
				return nil, 0, errors.New(name + ": formatting would drop a comment: " + m)
			}
			return out, passes, nil
		}
		out = next
	}
	return nil, 0, errors.New(name + ": formatting does not settle")
}

// missingComment returns the first comment line of a, in sorted order, that
// b does not have as many times, or "" when b keeps them all. Lines are
// trimmed and blank ones skipped. A document with no content keeps its
// comments only as text, so they are read from the text.
func missingComment(a, b []byte) string {
	have := map[string]int{}
	for _, l := range commentsOf(b) {
		have[l]++
	}
	for _, l := range commentsOf(a) {
		if have[l] == 0 {
			return l
		}
		have[l]--
	}
	return ""
}

// commentsOf returns the trimmed, non-blank comment lines of src, sorted,
// or nil when src is not readable YAML.
func commentsOf(src []byte) []string {
	var doc yaml.Node
	if yaml.Unmarshal(src, &doc) != nil {
		return nil
	}
	var out []string
	add := func(text string) {
		for _, l := range strings.Split(text, "\n") {
			if l = strings.TrimSpace(l); l != "" {
				out = append(out, l)
			}
		}
	}
	if len(doc.Content) == 0 {
		for _, l := range strings.Split(toLF(string(src)), "\n") {
			if l = strings.TrimSpace(strings.TrimPrefix(l, flows.BOM)); strings.HasPrefix(l, "#") {
				add(l)
			}
		}
	}
	var walk func(n *yaml.Node)
	walk = func(n *yaml.Node) {
		add(n.HeadComment)
		add(n.LineComment)
		add(n.FootComment)
		for _, c := range n.Content {
			walk(c)
		}
	}
	walk(&doc)
	slices.Sort(out)
	return out
}

// sameData reports whether a and b, both readable YAML, hold the same data:
// the same scalars with the same tags, the same sequences in order, and the
// same key/value pairs in each mapping in any order. Styles, comments and
// positions do not count.
func sameData(a, b []byte) bool {
	var x, y yaml.Node
	if yaml.Unmarshal(a, &x) != nil || yaml.Unmarshal(b, &y) != nil {
		return false
	}
	return key(&x) == key(&y)
}

// key writes n's data as a string that is equal for equal data: mapping
// pairs are sorted, so key order does not count. An empty document and any
// null (empty, ~ or null) are equal.
func key(n *yaml.Node) string {
	switch {
	case n.Kind == yaml.DocumentNode && len(n.Content) == 1:
		return key(n.Content[0])
	case n.Kind == 0, n.Kind == yaml.DocumentNode, n.Kind == yaml.ScalarNode && n.Tag == "!!null":
		return "null"
	}
	switch n.Kind {
	case yaml.ScalarNode:
		return fmt.Sprintf("%s%q", n.ShortTag(), n.Value)
	case yaml.MappingNode:
		pairs := make([]string, 0, len(n.Content)/2)
		for i := 0; i+1 < len(n.Content); i += 2 {
			pairs = append(pairs, key(n.Content[i])+":"+key(n.Content[i+1]))
		}
		slices.Sort(pairs)
		return "{" + strings.Join(pairs, ",") + "}"
	}
	parts := make([]string, 0, len(n.Content))
	for _, c := range n.Content {
		parts = append(parts, key(c))
	}
	return fmt.Sprintf("%d[%s]", n.Kind, strings.Join(parts, ","))
}

// pass formats src once. It drops a leading byte order mark, reads CRLF as
// LF, and refuses a lone CR, any other byte order mark, anything but UTF-8,
// a mapping key that is not a scalar or is empty, and a local tag. It
// decodes src as one document, shapes it, writes every collection in block
// style except the flow candidates that fit, and encodes it with a 2-space
// indent.
func pass(src []byte, name string, shape shaper) ([]byte, error) {
	text := strings.TrimPrefix(toLF(string(src)), flows.BOM)
	if !utf8.ValidString(text) {
		return nil, errors.New(name + ": must be UTF-8")
	}
	if strings.Contains(text, flows.BOM) {
		// The YAML reader skips some of these and keeps others as text.
		return nil, errors.New(name + ": a byte order mark may only start the file")
	}
	if strings.Contains(text, "\r") {
		// The YAML reader is not consistent about a lone CR.
		return nil, errors.New(name + ": lines must end in LF or CRLF, not a lone CR")
	}
	doc, ds := yamlx.DecodeDocument([]byte(text), name)
	if doc == nil {
		d := ds[0]
		return nil, fmt.Errorf("%s:%d: %s", name, d.Line, d.Message)
	}
	if badKey(doc) {
		// No Starboard file has one, and the encoder does not write them
		// back faithfully: a collection key moves its comments, an empty
		// key comes back as a string.
		return nil, errors.New(name + ": mapping keys must be scalars and not empty")
	}
	if localTag(doc) {
		// No Starboard file has one, and the encoder can write one it
		// cannot read back.
		return nil, errors.New(name + ": local tags such as !x are not allowed")
	}
	if len(doc.Content) == 0 {
		// Empty, or only comments, which the decoder does not keep.
		return tidy(text), nil
	}
	leaves := leafSet{}
	shape(doc.Content[0], leaves)
	block(doc)
	nullItems(doc)
	keepBlockScalars(doc)
	trimComments(doc)
	sinkFeet(doc.Content[0], true)
	if r := doc.Content[0]; r.Kind == yaml.ScalarNode && r.FootComment != "" {
		// The reader gives a comment after a lone scalar to the document.
		if doc.FootComment != "" {
			r.FootComment += "\n" + doc.FootComment
		}
		doc.FootComment, r.FootComment = r.FootComment, ""
	}

	var cands []*yaml.Node
	candidates(doc, leaves, &cands)
	for _, c := range cands {
		c.Style |= yaml.FlowStyle
	}
	trial, err := encode(doc)
	if err != nil {
		return nil, err
	}
	// Read the trial back for each candidate's column, then put each one
	// that does not fit back in block style. Should the trial not read back
	// as the same shape, every candidate goes in block style, and
	// formatYAML's next pass checks the result.
	var back yaml.Node
	_ = yaml.Unmarshal(trial, &back)
	var cols []int
	flowColumns(&back, &cols)
	for i, c := range cands {
		if len(cols) != len(cands) || !fits(c, cols[i]) {
			c.Style &^= yaml.FlowStyle
		}
	}
	raiseLines(doc.Content[0], nil)
	return final(doc)
}

// final encodes doc. When the result reads back as an empty document, as a
// lone "---" or "!" does, it is tidied like any other document with no
// content, so formatting it again changes nothing.
func final(doc *yaml.Node) ([]byte, error) {
	out, err := encode(doc)
	if err != nil {
		return nil, err
	}
	if back, _ := yamlx.DecodeDocument(out, ""); back != nil && len(back.Content) == 0 {
		return tidy(string(out)), nil
	}
	return out, nil
}

// badKey reports whether any mapping under n has a key that is a mapping,
// a sequence or empty.
func badKey(n *yaml.Node) bool {
	for i, c := range n.Content {
		if n.Kind == yaml.MappingNode && i%2 == 0 && (c.Kind != yaml.ScalarNode || emptyNull(c)) || badKey(c) {
			return true
		}
	}
	return false
}

// standardTag is the form of the YAML schema's own tags, such as !!str.
var standardTag = regexp.MustCompile(`^!![a-z]+$`)

// localTag reports whether any node under n has a tag that is not a
// standard one such as !!str: a local tag such as !x, or a verbatim one.
func localTag(n *yaml.Node) bool {
	for _, c := range n.Content {
		if c.Tag != "" && !standardTag.MatchString(c.Tag) || localTag(c) {
			return true
		}
	}
	return false
}

// isBlock reports whether n is a non-empty collection in block style.
func isBlock(n *yaml.Node) bool {
	return (n.Kind == yaml.MappingNode || n.Kind == yaml.SequenceNode) &&
		len(n.Content) > 0 && n.Style&yaml.FlowStyle == 0
}

// sinkFeet moves each foot comment the encoder would write where the
// decoder does not read it back — on a collection, or on a key below the
// top level whose value is a collection — to the deepest last node under
// it, which is where the decoder puts a comment that ends a block. A foot
// comment on the top-level mapping goes to its last key. It runs while
// every collection is in block style.
func sinkFeet(n *yaml.Node, top bool) {
	if n.Kind == yaml.MappingNode {
		for i := 0; i+1 < len(n.Content); i += 2 {
			if k, v := n.Content[i], n.Content[i+1]; !top && k.FootComment != "" && isBlock(v) {
				addFoot(deepestLast(v), k.FootComment)
				k.FootComment = ""
			}
		}
	}
	for _, c := range n.Content {
		sinkFeet(c, false)
	}
	if n.FootComment == "" || !isBlock(n) {
		return
	}
	target := deepestLast(n)
	if top && n.Kind == yaml.MappingNode {
		target = n.Content[len(n.Content)-2]
	}
	addFoot(target, n.FootComment)
	n.FootComment = ""
}

// deepestLast follows the last entry of each block collection down from n
// and returns the key or scalar it ends on.
func deepestLast(n *yaml.Node) *yaml.Node {
	for {
		last := n.Content[len(n.Content)-1]
		switch {
		case isBlock(last):
			n = last
		case n.Kind == yaml.MappingNode:
			return n.Content[len(n.Content)-2]
		default:
			return last
		}
	}
}

func addFoot(n *yaml.Node, comment string) {
	if n.FootComment != "" {
		comment = n.FootComment + "\n" + comment
	}
	n.FootComment = comment
}

// raiseLines moves the line comment of each collection written in block
// style to the node on its first line that the decoder gives it to: the key
// it is the value of, else its first key or scalar.
//
// A block collection with an explicit tag (!x) is written with the tag after
// its key's line comment, which does not read back, so then the comment, and
// any the key already has, goes to the collection's first line instead.
func raiseLines(n, key *yaml.Node) {
	tagged := isBlock(n) && n.Style&yaml.TaggedStyle != 0
	if tagged && key != nil && key.LineComment != "" {
		addLine(firstOnLine(n), key.LineComment)
		key.LineComment = ""
	}
	if n.LineComment != "" && isBlock(n) {
		target := key
		if target == nil || tagged {
			target = firstOnLine(n)
		}
		addLine(target, n.LineComment)
		n.LineComment = ""
	}
	// The encoder drops a key's line comment when the value is a non-empty
	// flow collection; it can follow the collection instead.
	if key != nil && key.LineComment != "" && len(n.Content) > 0 && n.Style&yaml.FlowStyle != 0 {
		if n.LineComment != "" {
			key.LineComment += " " + n.LineComment
		}
		n.LineComment = key.LineComment
		key.LineComment = ""
	}
	for i, c := range n.Content {
		var k *yaml.Node
		if n.Kind == yaml.MappingNode && i%2 == 1 {
			k = n.Content[i-1]
		}
		raiseLines(c, k)
	}
}

func addLine(n *yaml.Node, comment string) {
	if n.LineComment != "" {
		comment = n.LineComment + " " + comment
	}
	n.LineComment = comment
}

// firstOnLine returns the node a comment at the end of n's first line
// belongs to: the first value if it is not a block collection, else the
// first key, or for a sequence the first scalar it starts with.
func firstOnLine(n *yaml.Node) *yaml.Node {
	for {
		first := n.Content[0]
		if n.Kind == yaml.MappingNode {
			if isBlock(n.Content[1]) {
				return first
			}
			return n.Content[1]
		}
		if !isBlock(first) {
			return first
		}
		n = first
	}
}

// nullItems spells each empty null list item "null": a comment after an
// empty list item does not read back in place.
func nullItems(n *yaml.Node) {
	for _, c := range n.Content {
		if n.Kind == yaml.SequenceNode && emptyNull(c) {
			c.Value = "null"
		}
		nullItems(c)
	}
}

func emptyNull(n *yaml.Node) bool {
	return n.Kind == yaml.ScalarNode && n.Tag == "!!null" && n.Value == ""
}

// keepBlockScalars writes in double-quoted style each literal (|) or folded
// (>) scalar that the encoder cannot write in its own style without changing
// its value, as with a folded scalar holding a more-indented line, and each
// that needs keep chomping (|+), whose value would swallow any blank line
// written after it.
func keepBlockScalars(n *yaml.Node) {
	if n.Kind == yaml.ScalarNode && n.Style&(yaml.LiteralStyle|yaml.FoldedStyle) != 0 {
		bare := yaml.Node{Kind: yaml.ScalarNode, Tag: n.Tag, Value: n.Value, Style: n.Style}
		var back yaml.Node
		out, err := encode(&bare)
		header, _, _ := strings.Cut(string(out), "\n")
		if err != nil || strings.Contains(header, "+") || yaml.Unmarshal(out, &back) != nil ||
			len(back.Content) == 0 || back.Content[0].Value != n.Value {
			n.Style = n.Style&^(yaml.LiteralStyle|yaml.FoldedStyle) | yaml.DoubleQuotedStyle
		}
	}
	for _, c := range n.Content {
		keepBlockScalars(c)
	}
}

// trimComments trims trailing whitespace from every line of every comment,
// and joins the paragraphs of the head comment of every entry but the first.
// A line comment keeps only its first line; the rest, which the encoder
// would write into a block scalar's text, goes to the foot comment.
func trimComments(n *yaml.Node) {
	for _, c := range []*string{&n.HeadComment, &n.LineComment, &n.FootComment} {
		*c = string(tidy(*c))
		*c = strings.TrimSuffix(*c, "\n")
	}
	if first, rest, ok := strings.Cut(n.LineComment, "\n"); ok {
		n.LineComment = first
		if n.FootComment != "" {
			rest += "\n" + n.FootComment
		}
		n.FootComment = rest
	}
	for i, c := range n.Content {
		trimComments(c)
		if i > 0 {
			c.HeadComment = joinParagraphs(c.HeadComment)
		}
	}
}

// joinParagraphs drops the blank lines in comment. The encoder writes a
// head comment right after the entry before it, and the reader would give
// that entry every paragraph but the last.
func joinParagraphs(comment string) string {
	for strings.Contains(comment, "\n\n") {
		comment = strings.ReplaceAll(comment, "\n\n", "\n")
	}
	return comment
}

// block clears the flow style of every collection under n.
func block(n *yaml.Node) {
	if n.Kind == yaml.MappingNode || n.Kind == yaml.SequenceNode {
		n.Style &^= yaml.FlowStyle
	}
	for _, c := range n.Content {
		block(c)
	}
}

// candidates collects, in document order, the outermost nodes that may go
// in flow style: a non-empty sequence of scalars, or a non-empty leaf
// mapping, that is plain, has no foot comment of its own and, for a
// mapping, has no sequence under it.
func candidates(n *yaml.Node, leaves leafSet, out *[]*yaml.Node) {
	if len(n.Content) > 0 && n.FootComment == "" && plain(n) {
		switch {
		case n.Kind == yaml.SequenceNode && scalars(n.Content),
			n.Kind == yaml.MappingNode && leaves[n] && !hasSequence(n):
			*out = append(*out, n)
			return
		}
	}
	for _, c := range n.Content {
		candidates(c, leaves, out)
	}
}

// plain reports whether no node under n carries a comment or is an empty
// null, which flow style cannot write: the encoder would write an empty
// quoted string instead.
func plain(n *yaml.Node) bool {
	for _, c := range n.Content {
		if c.HeadComment != "" || c.LineComment != "" || c.FootComment != "" ||
			emptyNull(c) || !plain(c) {
			return false
		}
	}
	return true
}

func scalars(ns []*yaml.Node) bool {
	for _, n := range ns {
		if n.Kind != yaml.ScalarNode {
			return false
		}
	}
	return true
}

func hasSequence(n *yaml.Node) bool {
	for _, c := range n.Content {
		if c.Kind == yaml.SequenceNode || hasSequence(c) {
			return true
		}
	}
	return false
}

// flowColumns collects the 1-based column of every outermost non-empty
// flow collection under n, in document order.
func flowColumns(n *yaml.Node, cols *[]int) {
	if (n.Kind == yaml.MappingNode || n.Kind == yaml.SequenceNode) &&
		n.Style&yaml.FlowStyle != 0 && len(n.Content) > 0 {
		*cols = append(*cols, n.Column)
		return
	}
	for _, c := range n.Content {
		flowColumns(c, cols)
	}
}

// fits reports whether c, written in flow style starting at column col,
// is one line of at most MaxFlowWidth runes.
func fits(c *yaml.Node, col int) bool {
	bare := *c
	bare.HeadComment, bare.LineComment, bare.FootComment = "", "", ""
	text, err := encode(&bare)
	line := strings.TrimSuffix(string(text), "\n")
	return err == nil && !strings.Contains(line, "\n") && col-1+utf8.RuneCountInString(line) <= MaxFlowWidth
}

// encode writes n as YAML with a 2-space indent.
func encode(n *yaml.Node) ([]byte, error) {
	var b bytes.Buffer
	enc := yaml.NewEncoder(&b)
	enc.SetIndent(2)
	if err := enc.Encode(n); err != nil {
		return nil, err
	}
	if err := enc.Close(); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

// toLF turns CRLF into LF.
func toLF(s string) string { return strings.ReplaceAll(s, "\r\n", "\n") }

// tidy trims trailing whitespace from every line of text and trailing blank
// lines from its end, and ends it with one newline unless it is empty.
func tidy(text string) []byte {
	lines := strings.Split(text, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " \t\r\f\v")
	}
	out := strings.TrimRight(strings.Join(lines, "\n"), "\n")
	if out == "" {
		return []byte{}
	}
	return []byte(out + "\n")
}
