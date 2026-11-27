// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package format

import (
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.yaml.in/yaml/v3"

	"github.com/c65llc/starboard/internal/registry"
)

var update = flag.Bool("update", false, "rewrite testdata/out from testdata/in")

// areas is the area order the golden screens files are formatted with.
var areas = []string{"trip", "activity"}

// formatFile formats src by the kind its testdata name gives: config-*,
// screens-* or *.md.
func formatFile(name string, src []byte) ([]byte, error) {
	switch {
	case strings.HasPrefix(name, "config-"):
		return Config(src)
	case strings.HasPrefix(name, "screens-"):
		return Screens(src, areas)
	case strings.HasSuffix(name, ".md"):
		return Flow(src)
	}
	return nil, fmt.Errorf("testdata/in/%s: name must start with config- or screens-, or end in .md", name)
}

func inputs(t testing.TB) []string {
	t.Helper()
	names, err := fs.Glob(os.DirFS("testdata/in"), "*")
	require.NoError(t, err)
	require.NotEmpty(t, names)
	return names
}

// read reads a file under testdata.
func read(t testing.TB, name string) []byte {
	t.Helper()
	data, err := fs.ReadFile(os.DirFS("testdata"), strings.TrimPrefix(name, "testdata/"))
	require.NoError(t, err)
	return data
}

func TestFormatGolden(t *testing.T) {
	for _, name := range inputs(t) {
		t.Run(name, func(t *testing.T) {
			got, err := formatFile(name, read(t, path.Join("testdata/in", name)))
			require.NoError(t, err)
			out := path.Join("testdata/out", name)
			if *update {
				require.NoError(t, os.WriteFile(out, got, 0o600))
			}
			assert.Equal(t, string(read(t, out)), string(got))
		})
	}
}

func TestFormatIdempotent(t *testing.T) {
	for _, name := range inputs(t) {
		t.Run(name, func(t *testing.T) {
			want := read(t, path.Join("testdata/out", name))
			got, err := formatFile(name, want)
			require.NoError(t, err)
			assert.Equal(t, string(want), string(got))
		})
	}
}

func TestFormatCRLF(t *testing.T) {
	for _, name := range inputs(t) {
		t.Run(name, func(t *testing.T) {
			lf := read(t, path.Join("testdata/in", name))
			crlf := []byte(strings.ReplaceAll(string(lf), "\n", "\r\n"))
			got, err := formatFile(name, crlf)
			require.NoError(t, err)
			assert.NotContains(t, string(got), "\r")
			assert.Equal(t, string(read(t, path.Join("testdata/out", name))), string(got))
		})
	}
}

func TestFormatPreservesComments(t *testing.T) {
	for name, tc := range map[string]struct{ src, want string }{
		"head, line and foot": {
			src: `# document head

# head of the screens key
screens: # screens line
  # screen head
  trip.timeline: # screen line
    area: trip # area line
    title: Timeline
    presentation: root
    layout:
      # region head
      - kind: header # kind line
        region: heading
        label: Day
        # region foot
      # flow region head
      - {region: add, kind: primary-action, label: Add} # flow region line
  # screen foot, read as the next screen's head
  trip.week:
    title: Week
    area: trip
    presentation: tab
# document foot
`,
			want: `# document head

# head of the screens key
screens: # screens line
  # screen head
  trip.timeline: # screen line
    title: Timeline
    area: trip # area line
    presentation: root
    layout:
      # region head
      - region: heading
        kind: header # kind line
        label: Day
        # region foot
      # flow region head
      - {region: add, kind: primary-action, label: Add} # flow region line
  # screen foot, read as the next screen's head
  trip.week:
    title: Week
    area: trip
    presentation: tab
# document foot
`,
		},
		// The YAML reader gives a comment that ends a block to the deepest
		// last node, here the flow region; the region goes in block style
		// so the comment can follow its last key.
		"trailing comment after a flow region": {
			src: `screens:
  a.b:
    title: A
    area: a
    presentation: root
    layout:
      - {region: add, kind: action} # line
  # trailing
`,
			want: `screens:
  a.b:
    title: A
    area: a
    presentation: root
    layout:
      - region: add # line
        kind: action
        # trailing
`,
		},
		"line comment on a block-only flow region": {
			src: `screens:
  a.b:
    title: A
    area: a
    presentation: root
    layout:
      - {region: bar, kind: bar, children: [{region: x, kind: text}]} # bar
      - region: list
        kind: list
        item: {region: row, kind: card, children: []} # item
`,
			want: `screens:
  a.b:
    title: A
    area: a
    presentation: root
    layout:
      - region: bar # bar
        kind: bar
        children:
          - {region: x, kind: text}
      - region: list
        kind: list
        item: # item
          region: row
          kind: card
          children: []
`,
		},
	} {
		got, err := Screens([]byte(tc.src), nil)
		require.NoError(t, err, name)
		assert.Equal(t, tc.want, string(got), name)
		again, err := Screens(got, nil)
		require.NoError(t, err, name)
		assert.Equal(t, tc.want, string(again), name)
	}
}

// leaf returns a screens.yaml with one leaf region whose rendered flow line
// is exactly width runes, using a label of multi-byte characters.
func leaf(t *testing.T, width int) string {
	t.Helper()
	const prefix = "      - {region: a, kind: text, label: "
	n := width - len(prefix) - len("}")
	require.Positive(t, n)
	label := strings.Repeat("é", n-n/2) + strings.Repeat("日", n/2)
	src := "screens:\n  a.b:\n    title: A\n    area: a\n    presentation: root\n    layout:\n" +
		prefix + label + "}\n"
	line := strings.Split(src, "\n")[6]
	require.Equal(t, width, utf8.RuneCountInString(line))
	require.Greater(t, len(line), 100, "the label must be multi-byte")
	return src
}

func TestFormatUnicodeWidth(t *testing.T) {
	for _, width := range []int{98, 100} {
		src := leaf(t, width)
		got, err := Screens([]byte(src), nil)
		require.NoError(t, err)
		assert.Equal(t, src, string(got), "a %d-rune line stays in flow style", width)
	}
	got, err := Screens([]byte(leaf(t, 101)), nil)
	require.NoError(t, err)
	assert.Contains(t, string(got), "      - region: a\n        kind: text\n        label: ", "a 101-rune line goes in block style")
}

func TestFormatFlowStyleRules(t *testing.T) {
	src := `screens:
  a.b:
    title: A
    area: a
    presentation: root
    states: [loading, empty]
    layout:
      - region: tabs
        kind: tabs
        items:
          - label: One
            to: a.b
      - region: list
        kind: list
        item: {region: row, kind: card}
      - region: odd
        kind: text
        label: [not, a, string]
      - {region: noted, kind: text,
         # inside
         label: x}
      - {}
`
	want := `screens:
  a.b:
    title: A
    area: a
    presentation: root
    states: [loading, empty]
    layout:
      - region: tabs
        kind: tabs
        items:
          - {label: One, to: a.b}
      - region: list
        kind: list
        item: {region: row, kind: card}
      - region: odd
        kind: text
        label: [not, a, string]
      - region: noted
        kind: text
        # inside
        label: x
      - {}
`
	got, err := Screens([]byte(src), nil)
	require.NoError(t, err)
	assert.Equal(t, want, string(got))
}

func TestFormatScreenOrder(t *testing.T) {
	src := `screens:
  z.a: {title: Z, area: nowhere, presentation: root}
  b.b: {title: B, area: second, presentation: root}
  a.a: {title: A, area: second, presentation: root}
  c.c: {area: first}
  m.m: {title: M}
  c.c: {area: second}
`
	got, err := Screens([]byte(src), []string{"first", "second"})
	require.NoError(t, err)
	var ids []string
	for _, line := range strings.Split(string(got), "\n") {
		if strings.HasPrefix(line, "  ") && !strings.HasPrefix(line, "   ") {
			ids = append(ids, strings.TrimSpace(line))
		}
	}
	// A duplicate ID sorts with its first occurrence and keeps its place
	// after it; an unknown or missing area sorts last.
	assert.Equal(t, []string{"c.c:", "c.c:", "a.a:", "b.b:", "m.m:", "z.a:"}, ids)
}

func TestFormatConfigEmptyAndComments(t *testing.T) {
	for _, src := range []string{"", "\n\n", "  \n"} {
		got, err := Config([]byte(src))
		require.NoError(t, err)
		assert.Empty(t, got, "%q", src)
	}
	got, err := Config([]byte("# only a comment\r\n# and another"))
	require.NoError(t, err)
	assert.Equal(t, "# only a comment\n# and another\n", string(got))
}

func TestFormatErrors(t *testing.T) {
	for name, src := range map[string]string{
		"syntax":     "a: [b\n",
		"alias":      "a: &x 1\nb: *x\n",
		"merge":      "a: {b: 1}\nc:\n  <<: {d: 2}\n",
		"two docs":   "a: 1\n---\nb: 2\n",
		"bad second": "a: 1\n---\n[\n",
	} {
		_, err := Config([]byte(src))
		assert.Error(t, err, name)
		_, err = Screens([]byte(src), nil)
		assert.Error(t, err, name)
	}
}

// zeroLines clears every Line in reg and sorts Order, the two things a
// format may change without changing the registry's meaning.
func zeroLines(reg *registry.Registry) {
	if reg == nil {
		return
	}
	reg.Order = nil
	for i := range reg.Unmapped {
		reg.Unmapped[i].Line = 0
	}
	for _, s := range reg.Screens {
		s.Line = 0
		zeroRegions(s.Layout)
		for _, l := range s.Layouts {
			zeroRegions(l)
		}
	}
}

func zeroRegions(rs []*registry.Region) {
	for _, r := range rs {
		if r == nil {
			continue
		}
		r.Line = 0
		for i := range r.Items {
			r.Items[i].Line = 0
		}
		zeroRegions(r.Children)
		zeroRegions([]*registry.Region{r.Item})
	}
}

func FuzzFormatIdempotent(f *testing.F) {
	for _, name := range inputs(f) {
		f.Add(read(f, path.Join("testdata/in", name)))
	}
	f.Fuzz(func(t *testing.T, src []byte) {
		once, err := Screens(src, areas)
		if err != nil && strings.Contains(err.Error(), "would drop a comment") {
			return // refusing is the safe answer when yaml.v3 would lose one
		}
		if err != nil {
			// Only input that does not parse, is not UTF-8, has a lone CR
			// or a byte order mark past the start, has a key that is not a
			// scalar or is empty, or has a local tag is refused.
			lf := strings.TrimPrefix(strings.ReplaceAll(string(src), "\r\n", "\n"), "\uFEFF")
			var doc yaml.Node
			if reg, _ := registry.Parse(src); reg != nil && utf8.Valid(src) &&
				!strings.ContainsAny(lf, "\r\uFEFF") &&
				yaml.Unmarshal(src, &doc) == nil && !badKey(&doc) && !localTag(&doc) {
				t.Fatalf("Screens refused parseable input: %v\ninput:\n%s", err, src)
			}
			return
		}
		twice, err := Screens(once, areas)
		require.NoError(t, err, "formatted output must parse:\n%s", once)
		require.Equal(t, string(once), string(twice), "formatting twice must equal once")
		// Every comment the reader sees in the input is in the output. The
		// output may hold more: the reader can miss one in odd input (such
		// as a comment after an empty list item), which the output keeps.
		have := map[string]int{}
		for _, l := range commentLines(t, once) {
			have[l]++
		}
		for _, l := range commentLines(t, src) {
			if have[l]--; have[l] < 0 {
				t.Fatalf("formatting dropped comment %q\ninput:\n%s\noutput:\n%s", l, src, once)
			}
		}

		before, _ := registry.Parse(src)
		after, _ := registry.Parse(once)
		zeroLines(before)
		zeroLines(after)
		if !reflect.DeepEqual(before, after) {
			t.Fatalf("formatting changed the registry\ninput:\n%s\noutput:\n%s", src, once)
		}
	})
}

func TestFormatCommentPlacement(t *testing.T) {
	long := "[aaaaaaaaaa, bbbbbbbbbb, cccccccccc, dddddddddd, eeeeeeeeee, ffffffffff, gggggggggg, hhhhhhhhhh, iiiiiiiiii]"
	for name, tc := range map[string]struct{ src, want string }{
		// A foot comment on a key whose flow list goes in block style
		// follows the list's last item.
		"key foot under a list that goes block": {
			"a:\n  l: " + long + "\n  # foot\nz: 1\n",
			"a:\n  l:\n    - aaaaaaaaaa\n    - bbbbbbbbbb\n    - cccccccccc\n    - dddddddddd\n    - eeeeeeeeee\n" +
				"    - ffffffffff\n    - gggggggggg\n    - hhhhhhhhhh\n    - iiiiiiiiii\n    # foot\nz: 1\n",
		},
		"foot of a top-level flow mapping": {
			"{a: 1, b: [x]}\n# foot\n",
			"a: 1\nb: [x]\n\n# foot\n",
		},
		"foot of a flow mapping that goes block": {
			"l:\n  - {region: n, kind: nav, items: [{label: A}]}\n  # foot\n",
			"l:\n  - region: n\n    kind: nav\n    items:\n      - label: A\n        # foot\n",
		},
		"feet that meet": {
			"x:\n  l:\n    - a # c\n    # f1\n  # f2\n",
			"x:\n  l:\n    - a # c\n    # f1\n    # f2\n",
		},
		"line comment of a mapping whose first value is block": {
			"unmapped:\n  - {path: {x: 1}} # c\n",
			"unmapped:\n  - path: # c\n      x: 1\n",
		},
		"line comment of nested lists": {
			"unmapped:\n  - [[[a]]] # c\n",
			"unmapped:\n  - - - [a] # c\n",
		},
		"line comment of a tagged block collection": {
			"a: !!seq [b: 1] # c\nd: !!map # e\n  f: 1\n",
			"a: !!seq\n  - b: 1 # c\nd: !!map\n  f: 1 # e\n",
		},
		"multi-line line comment": {
			"! #\n00\n\n0 #",
			"|- #\n  00\n  0\n\n#\n",
		},
		"paragraphs of a comment between entries": {
			"# one\n\n# two\na: 1\n\n# three\n\n# four\nb: 2\n",
			"# one\n\n# two\na: 1\n# three\n# four\nb: 2\n",
		},
		"trailing whitespace in comments": {
			"# head  \na: 1 # line\t\n",
			"# head\na: 1 # line\n",
		},
	} {
		got, err := Screens([]byte(tc.src), nil)
		require.NoError(t, err, name)
		assert.Equal(t, tc.want, string(got), name)
		again, err := Screens(got, nil)
		require.NoError(t, err, name)
		assert.Equal(t, tc.want, string(again), name)
	}
}

func TestFormatOddShapes(t *testing.T) {
	// Formatting follows the schema where it can and leaves the rest alone.
	for _, src := range []string{
		"screens: [a]\nunmapped: x\n",
		"screens:\n  a.b: [x]\n  c.d:\n    layout: x\n    layouts: [y]\n  e.f:\n    layouts:\n      phone: z\n    layout:\n      - x\n      - region: r\n        kind: tabs\n        items: none\n",
		"- a\n- b: [c]\n",
	} {
		got, err := Screens([]byte(src), nil)
		require.NoError(t, err, src)
		again, err := Screens(got, nil)
		require.NoError(t, err, src)
		assert.Equal(t, string(got), string(again), src)
	}
	for _, src := range []string{"platforms: [ios]\n", "platforms:\n  ios: [phone]\n"} {
		got, err := Config([]byte(src))
		require.NoError(t, err)
		assert.Equal(t, src, string(got))
	}
}

func TestFormatNotUTF8(t *testing.T) {
	_, err := Screens([]byte("\xff\xfe"), nil)
	assert.ErrorContains(t, err, "must be UTF-8")
}

func TestFormatBOM(t *testing.T) {
	got, err := Config([]byte("\uFEFFversion: 1\n"))
	require.NoError(t, err)
	assert.Equal(t, "version: 1\n", string(got))
}

func TestFormatMustSettle(t *testing.T) {
	// With no pass left to confirm the first one, formatting fails rather
	// than return output it has not seen settle.
	_, _, err := settle([]byte("content: docs\nversion: 1\n"), "starboard.yaml", configShape, 0)
	assert.ErrorContains(t, err, "starboard.yaml: formatting does not settle")
}

func TestSameData(t *testing.T) {
	for _, tc := range []struct {
		a, b string
		same bool
	}{
		{"a: 1\nb: [x, y]\n", "b:\n  - x\n  - y\na: 1 # c\n", true},
		{"", "---\n", true},
		{"!\n", "", true},
		{"a: 1\n", "a: '1'\n", false},
		{"a: x\n", "a: y\n", false},
		{"[x, y]\n", "[y, x]\n", false},
		{"[x]\n", "{x: 1}\n", false},
		{"a: [\n", "a: 1\n", false},
		{"a: 1\n", "a: [\n", false},
	} {
		assert.Equal(t, tc.same, sameData([]byte(tc.a), []byte(tc.b)), "%q vs %q", tc.a, tc.b)
	}
}

func TestFormatLoneCR(t *testing.T) {
	_, err := Config([]byte("a: 0\r\r\n  0\rb: 1\r"))
	assert.ErrorContains(t, err, "lone CR")
}

func TestFormatInnerBOM(t *testing.T) {
	_, err := Config([]byte("a: 1\n\uFEFFb: 2\n"))
	assert.ErrorContains(t, err, "byte order mark")
}

func TestFormatLocalTag(t *testing.T) {
	_, err := Config([]byte("a: !x 1\n"))
	assert.ErrorContains(t, err, "local tags")
}

func TestFormatComplexKey(t *testing.T) {
	_, err := Screens([]byte("? [a]\n: b\n"), nil)
	assert.ErrorContains(t, err, "keys must be scalars")
}

func TestFormatNulls(t *testing.T) {
	_, err := Config([]byte("? \n: x\n"))
	assert.ErrorContains(t, err, "not empty")
	got, err := Config([]byte("a:\n  -\n  - b\n"))
	require.NoError(t, err)
	assert.Equal(t, "a: [null, b]\n", string(got))
}

func TestFormatKeepsBlockScalars(t *testing.T) {
	// A folded scalar with a more-indented line does not survive the
	// encoder's folded style, so it is written double-quoted; a plain
	// literal keeps its style.
	got, err := Config([]byte("a: >\n  0\n   0\nb: |\n  x\n  y\n"))
	require.NoError(t, err)
	assert.Equal(t, "a: \"0\\n 0\\n\"\nb: |\n  x\n  y\n", string(got))
	// Keep chomping (|+) would swallow the blank line before a comment.
	got, err = Config([]byte("|+\n\n#"))
	require.NoError(t, err)
	assert.Equal(t, "\"\\n\"\n\n#\n", string(got))
}

// commentLines returns every non-blank comment line in src's YAML nodes,
// trimmed and sorted. It is the test's own reading, kept apart from the
// formatter's.
func commentLines(t testing.TB, src []byte) []string {
	t.Helper()
	var doc yaml.Node
	require.NoError(t, yaml.Unmarshal(src, &doc))
	var out []string
	if len(doc.Content) == 0 {
		// The reader keeps no comments of a document with no content.
		for _, l := range strings.Split(string(src), "\n") {
			if l = strings.TrimSpace(l); strings.HasPrefix(l, "#") {
				out = append(out, l)
			}
		}
	}
	var walk func(n *yaml.Node)
	walk = func(n *yaml.Node) {
		for _, c := range []string{n.HeadComment, n.LineComment, n.FootComment} {
			for _, l := range strings.Split(c, "\n") {
				if l = strings.TrimSpace(l); l != "" {
					out = append(out, l)
				}
			}
		}
		for _, c := range n.Content {
			walk(c)
		}
	}
	walk(&doc)
	slices.Sort(out)
	return out
}

func TestFormatKeepsOrRefusesComments(t *testing.T) {
	// Whatever yaml.v3 does with these, fmt either keeps every comment or
	// refuses the file.
	for _, src := range []string{
		"a: [x, # c\n  y]\n",
		"a: [x, y # c\n  ]\n",
		"a: {b: 1, # c\n  c: 2}\n",
		"a: [\n  # c\n  x]\n",
		"a: # c\n  b: 1\n",
		"a:\n  # c\n  b: 1\n",
		"a: # c\n  - b\n",
		"a:\n  # c\n  - b\n",
		"a: # c\n  {b: 1}\n",
		"a: !!map # c\n  b: 1\n",
		"a: | # c\n  x\n",
		"- # c\n  a: 1\n",
		"[[[]#\n]#\n]",
	} {
		got, err := Screens([]byte(src), nil)
		if err != nil {
			assert.ErrorContains(t, err, "would drop a comment", src)
			continue
		}
		assert.Equal(t, commentLines(t, []byte(src)), commentLines(t, got), "%q -> %q", src, got)
	}
}

func TestFormatRefusesToDropComment(t *testing.T) {
	// yaml.v3 cannot write back comments inside nested empty flow lists.
	_, err := Screens([]byte("[[[]#\n]#\n]"), nil)
	assert.ErrorContains(t, err, "screens.yaml: formatting would drop a comment: #")
}

func TestFormatKeyCommentOnFlowValue(t *testing.T) {
	// yaml.v3 drops a key's line comment when its value is written in flow
	// style, so the comment goes on the value.
	got, err := Screens([]byte("a: # c\n  - b\n"), nil)
	require.NoError(t, err)
	assert.Equal(t, "a: [b] # c\n", string(got))
}

func TestMissingComment(t *testing.T) {
	assert.Empty(t, missingComment([]byte("a: 1 # x\n"), []byte("# x\na: 1\n")))
	assert.Equal(t, "# y", missingComment([]byte("a: 1 # x\n# y\n"), []byte("a: 1 # x\n")))
	assert.Equal(t, "# x", missingComment([]byte("a: 1 # x\nb: 2 # x\n"), []byte("a: 1 # x\nb: 2\n")))
	assert.Equal(t, "", missingComment([]byte("a: [\n"), []byte("a: 1\n")), "unreadable input has no comments to lose")
}

// seeds returns the inputs committed under testdata/fuzz/<name>.
func seeds(t testing.TB, name string) [][]byte {
	t.Helper()
	dir := os.DirFS(path.Join("testdata/fuzz", name))
	files, err := fs.Glob(dir, "*")
	require.NoError(t, err)
	var out [][]byte
	for _, f := range files {
		data, err := fs.ReadFile(dir, f)
		require.NoError(t, err)
		lines := strings.Split(strings.TrimSpace(string(data)), "\n")
		lit := strings.TrimSuffix(strings.TrimPrefix(lines[len(lines)-1], "[]byte("), ")")
		s, err := strconv.Unquote(lit)
		require.NoError(t, err, f)
		out = append(out, []byte(s))
	}
	return out
}

// frontMatterOf returns the YAML between a flow file's --- lines.
func frontMatterOf(src []byte) []byte {
	lines := strings.Split(string(src), "\n")
	return []byte(strings.Join(lines[1:closing(lines)], "\n"))
}

func TestFormatSettlesInOnePass(t *testing.T) {
	for _, name := range inputs(t) {
		for _, dir := range []string{"testdata/in", "testdata/out"} {
			src := read(t, path.Join(dir, name))
			var passes int
			var err error
			switch {
			case strings.HasPrefix(name, "config-"):
				_, passes, err = settle(src, "x", configShape, maxPasses)
			case strings.HasPrefix(name, "screens-"):
				_, passes, err = settle(src, "x", screensShape(areas), maxPasses)
			default:
				_, passes, err = settle(frontMatterOf(src), "x", frontMatterShape, maxPasses)
			}
			require.NoError(t, err, name)
			assert.Equal(t, 1, passes, "%s/%s", dir, name)
		}
	}
	for _, seed := range seeds(t, "FuzzFormatIdempotent") {
		if _, passes, err := settle(seed, "x", screensShape(areas), maxPasses); err == nil {
			assert.Equal(t, 1, passes, "seed %q", seed)
		}
	}
}
