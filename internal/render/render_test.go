// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package render

import (
	"bytes"
	"encoding/xml"
	"flag"
	"io"
	"os"
	"path"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/registry"
)

var update = flag.Bool("update", false, "rewrite testdata/*.svg from the fixtures")

// leaf returns a region with no children.
func leaf(name, kind, label string) *registry.Region {
	return &registry.Region{Name: name, Kind: kind, Label: label}
}

// box returns a container region.
func box(name, kind string, children ...*registry.Region) *registry.Region {
	return &registry.Region{Name: name, Kind: kind, Children: children}
}

// timeline is the spec's trip.timeline: a pinned bar, a list, a primary
// action that needs a capability, and pinned tabs; plus a web-wide override
// with a row, a sidebar nav and a column.
func timeline(presentation string) *registry.Screen {
	add := leaf("add-activity", "primary-action", "Add activity")
	add.Requires = "editLogistics"
	add.To = "activity.editor"
	tabs := &registry.Region{Name: "tabs", Kind: "tabs", Items: []registry.NavItem{
		{Label: "Timeline", To: "trip.timeline"},
		{Label: "Checklist", To: "trip.checklist"},
		{Label: "Costs", To: "trip.costs", Requires: "viewCosts", Status: registry.Proposed},
	}}
	nav := &registry.Region{Name: "tabs", Kind: "nav", Width: registry.Width{Px: 240}, Items: tabs.Items}
	list := &registry.Region{
		Name: "activities", Kind: "list",
		Item:  &registry.Region{Kind: "card", Label: "Time · activity · attendance", To: "activity.detail"},
		Empty: &registry.Empty{Label: "No activities yet"},
	}
	return &registry.Screen{
		ID: "trip.timeline", Title: "Timeline", Presentation: presentation,
		Layout: []*registry.Region{
			box("app-bar", "bar", leaf("title", "text", "Trip name · dates"), leaf("info", "action", "Info")),
			leaf("day-heading", "header", "Day · place · weather"),
			list,
			add,
			tabs,
		},
		Layouts: map[string][]*registry.Region{
			"web-wide": {
				{Name: "shell", Kind: "row", Children: []*registry.Region{
					nav,
					box("main", "column",
						box("app-bar", "bar", leaf("title", "text", "Trip name · dates"), leaf("info", "action", "Info")),
						leaf("day-heading", "header", "Day · place · weather"),
						&registry.Region{Name: "activities", Kind: "list", Item: list.Item},
						&registry.Region{Name: "details", Kind: "section", Width: registry.Width{Num: 1, Den: 3}},
						add,
					),
				}},
			},
		},
	}
}

// everyKind is a screen using every kind once, plus an unknown kind, a
// proposed region and a label long enough to truncate.
func everyKind(presentation string) *registry.Screen {
	proposed := leaf("map", "map", "Route map")
	proposed.Status = registry.Proposed
	long := leaf("notice", "banner", "A banner whose label is far too long to fit inside the frame of a phone, so it is cut")
	field := leaf("name", "field", "Name")
	field.Requires = "editTrip"
	return &registry.Screen{
		ID: "trip.everything", Title: "Everything", Presentation: presentation,
		Layout: []*registry.Region{
			{Name: "top", Kind: "bar", Children: []*registry.Region{
				{Name: "back", Kind: "action", Label: "Back", Width: registry.Width{Px: 60}},
				{Name: "heading", Kind: "text", Width: registry.Width{Num: 1, Den: 2}},
				leaf("more", "menu", "More"),
			}},
			long,
			box("body", "section",
				leaf("hero", "media", "Cover photo"),
				proposed,
				&registry.Region{Name: "sidebar", Kind: "nav", Items: []registry.NavItem{{Label: "One"}, {Label: "Two"}}},
				&registry.Region{Name: "actions", Kind: "menu", Items: []registry.NavItem{{Label: "Share"}, {Label: "Delete"}}},
			),
			box("details", "column", field, leaf("notes", "form", "Notes")),
			leaf("mystery", "sparkle", "Unknown kind"),
			leaf("save", "primary-action", ""),
		},
	}
}

// menuIn is a container of kind (a bar or a row) holding a header and a
// menu of three items, its last item changed by last: the layout that drew
// a bar's menu items 8 px tall with truncated labels.
func menuIn(kind string, last func(*registry.NavItem)) *registry.Screen {
	items := []registry.NavItem{{Label: "Sort by date"}, {Label: "Select"}, {Label: "Settings"}}
	if last != nil {
		last(&items[2])
	}
	return &registry.Screen{
		ID: "notes.list", Title: "Notes", Presentation: "root",
		Layout: []*registry.Region{
			box("app-bar", kind, leaf("title", "header", "Notes"), &registry.Region{Name: "more", Kind: "menu", Label: "More", Items: items}),
			leaf("body", "text", "Body"),
		},
	}
}

func proposedItem(it *registry.NavItem) { it.Status = registry.Proposed }
func requiresItem(it *registry.NavItem) { it.Requires = "editNotes" }

type fixture struct {
	name   string
	screen *registry.Screen
	ff     string
}

var fixtures = []fixture{
	{"root-phone", everyKind("root"), "phone"},
	{"push-tablet", everyKind("push"), "tablet"},
	{"tab-phone", timeline("tab"), "phone"},
	{"sheet-phone", timeline("sheet"), "phone"},
	{"dialog-phone", &registry.Screen{
		ID: "trip.confirm", Title: "Delete trip?", Presentation: "dialog",
		Layout: []*registry.Region{
			leaf("message", "text", "This deletes the trip for everyone"),
			box("buttons", "row", leaf("cancel", "action", "Cancel"), leaf("delete", "primary-action", "Delete")),
		},
	}, "phone"},
	{"window-desktop", timeline("window"), "desktop"},
	{"route-web-narrow", timeline("route"), "web-narrow"},
	{"tab-web-wide", timeline("tab"), "web-wide"},
	{"menu-bar-phone", menuIn("bar", nil), "phone"},
	{"menu-bar-proposed-phone", menuIn("bar", proposedItem), "phone"},
	{"menu-bar-requires-phone", menuIn("bar", requiresItem), "phone"},
	{"menu-row-phone", menuIn("row", nil), "phone"},
}

func formFactor(t testing.TB, name string) config.FormFactor {
	t.Helper()
	ff, ok := config.DefaultFormFactors[name]
	require.True(t, ok, name)
	return ff
}

func golden(t *testing.T, name string, got []byte) {
	t.Helper()
	file := path.Join("testdata", name+".svg")
	if *update {
		require.NoError(t, os.WriteFile(file, got, 0o600))
	}
	want, err := os.ReadFile(file) //nolint:gosec // a fixed testdata path
	require.NoError(t, err)
	assert.Equal(t, string(want), string(got))
}

func TestWireframeGolden(t *testing.T) {
	for _, f := range fixtures {
		t.Run(f.name, func(t *testing.T) {
			golden(t, f.name, Wireframe(f.screen, f.ff, formFactor(t, f.ff)))
		})
	}
}

func TestWireframeHighlightedGolden(t *testing.T) {
	got := WireframeHighlighted(timeline("tab"), "phone", formFactor(t, "phone"), "add-activity", 3)
	golden(t, "tab-phone-highlight-add-activity", got)
	plain := Wireframe(timeline("tab"), "phone", formFactor(t, "phone"))
	assert.NotEqual(t, string(plain), string(got))
	// The only differences are one inserted outline and one badge.
	assert.Equal(t, 1, strings.Count(string(got), `stroke="#0B6B4E"`))
	badge := badgeOf(t, got)
	assert.Contains(t, badge, `fill="#0B6B4E"`)
	assert.Contains(t, badge, ">3</text>")
	stripped := strings.Replace(strings.Replace(string(got), outlineOf(t, got), "", 1), badge, "", 1)
	assert.Equal(t, string(plain), stripped)
}

// outlineOf returns the highlight element in svg, with its newline.
func outlineOf(t *testing.T, svg []byte) string {
	t.Helper()
	for _, line := range strings.SplitAfter(string(svg), "\n") {
		if strings.Contains(line, `stroke="#0B6B4E"`) {
			return line
		}
	}
	t.Fatal("no highlight outline")
	return ""
}

// badgeOf returns the numbered badge's lines in svg, with their newlines.
func badgeOf(t *testing.T, svg []byte) string {
	t.Helper()
	var b strings.Builder
	for _, line := range strings.SplitAfter(string(svg), "\n") {
		if strings.Contains(line, `class="badge"`) {
			b.WriteString(line)
		}
	}
	if b.Len() == 0 {
		t.Fatal("no badge")
	}
	return b.String()
}

func TestWireframeHighlightedBadgeIsDrawnLast(t *testing.T) {
	// The badge sits above every other element, outside the clipped body.
	got := string(WireframeHighlighted(timeline("tab"), "phone", formFactor(t, "phone"), "activities", 12))
	lines := strings.Split(strings.TrimSuffix(got, "\n"), "\n")
	require.GreaterOrEqual(t, len(lines), 3)
	assert.Equal(t, "</svg>", lines[len(lines)-1])
	assert.Contains(t, lines[len(lines)-2], ">12</text>")
	assert.Contains(t, lines[len(lines)-3], "<circle")
	assert.Equal(t, 2, strings.Count(got, `class="badge"`)) // one circle, one number
}

func TestWireframeHighlightedUnknownRegion(t *testing.T) {
	ff := formFactor(t, "phone")
	for _, region := range []string{"no-such-region", ""} {
		assert.Equal(t, string(Wireframe(timeline("tab"), "phone", ff)),
			string(WireframeHighlighted(timeline("tab"), "phone", ff, region, 1)), region)
	}
}

func TestWireframeHighlightedUsesFormFactorLayout(t *testing.T) {
	// "shell" exists only in the web-wide override.
	s := timeline("tab")
	assert.Contains(t, string(WireframeHighlighted(s, "web-wide", formFactor(t, "web-wide"), "shell", 1)), "#0B6B4E")
	assert.NotContains(t, string(WireframeHighlighted(s, "phone", formFactor(t, "phone"), "shell", 1)), "#0B6B4E")
}

func TestWireframeDeterministic(t *testing.T) {
	for _, f := range fixtures {
		ff := formFactor(t, f.ff)
		first := Wireframe(f.screen, f.ff, ff)
		for range 50 {
			require.Equal(t, first, Wireframe(f.screen, f.ff, ff), f.name)
		}
	}
}

// overflowing has more fixed-height regions than a phone can hold.
func overflowing() *registry.Screen {
	var layout []*registry.Region
	for i := range 20 {
		layout = append(layout, leaf("card-"+strconv.Itoa(i), "card", "Card"))
	}
	return &registry.Screen{ID: "trip.long", Title: "Long", Presentation: "push", Layout: layout}
}

const marker = `>…</text>`

func TestWireframeOverflowMarker(t *testing.T) {
	ff := formFactor(t, "phone")
	got := string(Wireframe(overflowing(), "phone", ff))
	assert.Equal(t, 1, strings.Count(got, marker))
	assert.Contains(t, got, `clip-path="url(#sb-clip)"`)
	// Cards wholly past the frame are not drawn at all.
	assert.NotContains(t, got, ">card-19<")
	assert.Contains(t, got, ">card-0<")

	for _, f := range fixtures {
		assert.NotContains(t, string(Wireframe(f.screen, f.ff, formFactor(t, f.ff))), marker, f.name)
	}
}

func TestWireframeOverflowMarkerInPanels(t *testing.T) {
	ff := formFactor(t, "phone")
	for _, p := range []string{"sheet", "dialog", "window"} {
		s := overflowing()
		s.Presentation = p
		assert.Equal(t, 1, strings.Count(string(Wireframe(s, "phone", ff)), marker), p)
	}
}

func TestWireframeOverflowSideways(t *testing.T) {
	s := &registry.Screen{ID: "a.b", Title: "Wide", Layout: []*registry.Region{
		{Name: "r", Kind: "row", Children: []*registry.Region{
			{Name: "wide", Kind: "card", Width: registry.Width{Px: 2000}},
			leaf("gone", "card", ""),
		}},
	}}
	got := string(Wireframe(s, "phone", formFactor(t, "phone")))
	assert.Contains(t, got, marker)
	assert.NotContains(t, got, ">gone<")
}

func TestWireframeEscapesText(t *testing.T) {
	s := &registry.Screen{ID: "a.b", Title: `T<"&>`, Presentation: "root", Layout: []*registry.Region{
		leaf("x", "text", `<script>&"`),
	}}
	got := string(Wireframe(s, "phone", formFactor(t, "phone")))
	assert.NotContains(t, got, "<script>")
	assert.Contains(t, got, "&lt;script&gt;&amp;&#34;")
	assert.Contains(t, got, `aria-label="T&lt;&#34;&amp;&gt; — phone"`)
	assertWellFormed(t, []byte(got))
}

func TestWireframeTitle(t *testing.T) {
	got := string(Wireframe(&registry.Screen{ID: "a.b"}, "phone", formFactor(t, "phone")))
	assert.Contains(t, got, "<title>a.b — phone</title>")
	assert.Contains(t, got, `role="img"`)
}

func TestWireframeTruncatesLabels(t *testing.T) {
	got := string(Wireframe(everyKind("root"), "phone", formFactor(t, "phone")))
	assert.Contains(t, got, "…</text>")
	assert.NotContains(t, got, "so it is cut")
	// Region names are never truncated.
	assert.Contains(t, got, ">notice<")
}

func TestWireframeLabelFallsBackToName(t *testing.T) {
	got := string(Wireframe(everyKind("root"), "phone", formFactor(t, "phone")))
	assert.Equal(t, 2, strings.Count(got, ">save</text>"), "label and name")
}

func TestWireframeProposedIsDashed(t *testing.T) {
	got := string(Wireframe(everyKind("root"), "phone", formFactor(t, "phone")))
	// everyKind: the proposed map; timeline: the proposed Costs tab.
	assert.Equal(t, 1, strings.Count(got, `stroke-dasharray="6 4"`))
	got = string(Wireframe(timeline("tab"), "phone", formFactor(t, "phone")))
	assert.Equal(t, 1, strings.Count(got, `stroke-dasharray="6 4"`))
}

func TestWireframeRequiresShowsLockAndName(t *testing.T) {
	got := string(Wireframe(timeline("tab"), "phone", formFactor(t, "phone")))
	assert.Contains(t, got, ">editLogistics</text>")
	assert.Contains(t, got, ">viewCosts</text>")
	assert.Equal(t, 2, strings.Count(got, `class="lock"`))
}

func TestFrameRadius(t *testing.T) {
	for name, want := range map[string]string{
		"phone": `rx="28"`, "tablet": `rx="20"`, "desktop": `rx="8"`,
		"web-wide": `rx="8"`, "web-narrow": `rx="8"`, "watch": `rx="8"`,
	} {
		got := string(Wireframe(&registry.Screen{ID: "a.b"}, name, config.FormFactor{Width: 300, Height: 400}))
		assert.Contains(t, got, `<rect class="frame" x="24" y="24" width="300" height="400" `+want, name)
	}
}

func TestNum(t *testing.T) {
	for in, want := range map[float64]string{
		0: "0", -0.1: "0", 1.24: "1", 1.25: "1.5", 1.74: "1.5", 1.75: "2", 1000000: "1000000", -3.3: "-3.5",
	} {
		assert.Equal(t, want, num(in), in)
	}
}

func TestTruncate(t *testing.T) {
	assert.Equal(t, "abc", truncate("abc", 100, 10))
	assert.Equal(t, "ab…", truncate("abcdef", 18, 10)) // 3 runes of 6 px
	assert.Empty(t, truncate("abcdef", 5, 10))
	assert.Empty(t, truncate("abcdef", -5, 10))
}

// TestWireframeStructure checks properties every overflow-free golden
// should have: it is well-formed XML, every region name appears exactly once
// as a name label, and nothing is placed outside the viewBox.
func TestWireframeStructure(t *testing.T) {
	for _, f := range fixtures {
		t.Run(f.name, func(t *testing.T) {
			ff := formFactor(t, f.ff)
			svg := Wireframe(f.screen, f.ff, ff)
			assertWellFormed(t, svg)
			names := nameTexts(t, svg)
			for _, n := range regionNames(f.screen.LayoutFor(f.ff)) {
				assert.Equal(t, 1, names[n], n)
			}
			assertInsideViewBox(t, svg, float64(ff.Width+2*margin), float64(ff.Height+2*margin))
		})
	}
}

func regionNames(rs []*registry.Region) []string {
	var out []string
	for _, r := range rs {
		if r.Name != "" {
			out = append(out, r.Name)
		}
		out = append(out, regionNames(r.Children)...)
		if r.Item != nil {
			out = append(out, regionNames([]*registry.Region{r.Item})...)
		}
	}
	return out
}

func assertWellFormed(t *testing.T, svg []byte) {
	t.Helper()
	d := xml.NewDecoder(bytes.NewReader(svg))
	for {
		_, err := d.Token()
		if err == io.EOF {
			return
		}
		require.NoError(t, err)
	}
}

// nameTexts counts the monospace name labels by their text.
func nameTexts(t *testing.T, svg []byte) map[string]int {
	t.Helper()
	counts := map[string]int{}
	d := xml.NewDecoder(bytes.NewReader(svg))
	inName := false
	for {
		tok, err := d.Token()
		if err == io.EOF {
			return counts
		}
		require.NoError(t, err)
		switch tok := tok.(type) {
		case xml.StartElement:
			inName = tok.Name.Local == "text" && attr(tok, "class") == "name"
		case xml.CharData:
			if inName {
				counts[string(tok)]++
			}
		case xml.EndElement:
			inName = false
		}
	}
}

func attr(e xml.StartElement, name string) string {
	for _, a := range e.Attr {
		if a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}

func assertInsideViewBox(t *testing.T, svg []byte, w, h float64) {
	t.Helper()
	d := xml.NewDecoder(bytes.NewReader(svg))
	for {
		tok, err := d.Token()
		if err == io.EOF {
			return
		}
		require.NoError(t, err)
		e, ok := tok.(xml.StartElement)
		if !ok || e.Name.Local == "svg" {
			continue
		}
		get := func(n string) float64 {
			v, err := strconv.ParseFloat(attr(e, n), 64)
			if err != nil {
				return 0
			}
			return v
		}
		x, y := get("x")+get("cx"), get("y")+get("cy")
		assert.True(t, x >= 0 && x+get("width") <= w, "%s x out of viewBox: %v", e.Name.Local, e.Attr)
		assert.True(t, y >= 0 && y+get("height") <= h, "%s y out of viewBox: %v", e.Name.Local, e.Attr)
	}
}

func TestNatural(t *testing.T) {
	card := leaf("", "card", "")
	for _, c := range []struct {
		r    *registry.Region
		want float64
	}{
		{leaf("a", "text", ""), 24},
		{leaf("a", "sparkle", ""), minFlex},
		{leaf("a", "form", ""), cardH},
		{&registry.Region{Kind: "list"}, caption + 3*cardH + 2*gap + pad},
		{&registry.Region{Kind: "list", Item: leaf("", "text", "")}, caption + 3*24 + 2*gap + pad},
		{&registry.Region{Kind: "column"}, minFlex},
		{box("a", "section", card, card), caption + 2*cardH + gap + pad},
		{&registry.Region{Kind: "row"}, minFlex},
		{box("a", "row", card, leaf("", "text", "")), caption + cardH + pad},
		{&registry.Region{Kind: "nav"}, minFlex},
		{&registry.Region{Kind: "nav", Items: []registry.NavItem{{}, {}}}, caption + 2*navItemH + gap + pad},
	} {
		assert.Equal(t, c.want, natural(c.r), "%+v", c.r)
	}
}

func TestDialogIsCappedToTheFrame(t *testing.T) {
	s := overflowing()
	s.Presentation = "dialog"
	got := string(Wireframe(s, "phone", formFactor(t, "phone")))
	// 844 tall frame, less a 24 px margin above and below.
	assert.Contains(t, got, `<rect class="panel" x="63" y="48" width="312" height="796" rx="12"`)
	assert.Contains(t, got, marker)
}

func TestNavItemsPastTheFrameAreClipped(t *testing.T) {
	items := make([]registry.NavItem, 30)
	for i := range items {
		items[i] = registry.NavItem{Label: "Item " + strconv.Itoa(i)}
	}
	s := &registry.Screen{ID: "a.b", Layout: []*registry.Region{
		box("shell", "row", &registry.Region{Name: "side", Kind: "nav", Items: items}),
	}}
	got := string(Wireframe(s, "phone", formFactor(t, "phone")))
	assert.Contains(t, got, ">Item 0<")
	assert.NotContains(t, got, ">Item 29<")
	assert.Contains(t, got, marker)
}

// boxes lists the rects of class class, as x, y, width, height.
func boxes(t *testing.T, svg []byte, class string) [][4]float64 {
	t.Helper()
	var out [][4]float64
	d := xml.NewDecoder(bytes.NewReader(svg))
	for {
		tok, err := d.Token()
		if err == io.EOF {
			return out
		}
		require.NoError(t, err)
		if e, ok := tok.(xml.StartElement); ok && e.Name.Local == "rect" && attr(e, "class") == class {
			var b [4]float64
			for i, n := range []string{"x", "y", "width", "height"} {
				b[i], err = strconv.ParseFloat(attr(e, n), 64)
				require.NoError(t, err)
			}
			out = append(out, b)
		}
	}
}

// A menu directly inside a bar is one button, as an app bar shows a closed
// menu: its label and a disclosure mark, as wide as that needs, so the
// header beside it keeps its label. Nothing is cut, no item is squeezed in.
func TestMenuInABarIsAButton(t *testing.T) {
	svg := Wireframe(menuIn("bar", nil), "phone", formFactor(t, "phone"))
	got := string(svg)
	assert.Contains(t, got, ">Notes<")
	assert.Contains(t, got, ">More ▾<")
	assert.NotContains(t, got, "…<")
	assert.NotContains(t, got, `class="item"`)
	assert.NotContains(t, got, "stroke-dasharray")
	assert.NotContains(t, got, `class="lock"`)
	rs := boxes(t, svg, "region")
	bar, title, more := rs[0], rs[1], rs[2]
	assert.Less(t, more[2], bar[2]/3, "menu width")
	assert.Greater(t, title[2], more[2], "header width")
	assert.LessOrEqual(t, more[0]+more[2], bar[0]+bar[2])
}

// The button keeps what its hidden items say: dashed when one is proposed,
// the lock and capability when one requires it.
func TestMenuInABarKeepsItemMarks(t *testing.T) {
	proposed := string(Wireframe(menuIn("bar", proposedItem), "phone", formFactor(t, "phone")))
	assert.Regexp(t, `<rect class="region" x="[^"]+" y="54" width="[^"]+" height="28" [^>]*stroke-dasharray="6 4"/>`, proposed)
	requires := string(Wireframe(menuIn("bar", requiresItem), "phone", formFactor(t, "phone")))
	assert.Contains(t, requires, `class="lock"`)
	assert.Contains(t, requires, `>editNotes<`)
	assert.NotContains(t, requires, "…<")
}

// Outside a bar a menu is drawn as it always was: captioned, an equal share
// of its row, its items an equal share of it.
func TestMenuInARowIsUnchanged(t *testing.T) {
	svg := Wireframe(menuIn("row", nil), "phone", formFactor(t, "phone"))
	rs := boxes(t, svg, "region")
	assert.Equal(t, rs[1][2], rs[2][2], "header and menu share the row equally")
	items := boxes(t, svg, "item")
	require.Len(t, items, 3)
	assert.Equal(t, items[0][2], items[1][2])
	assert.Equal(t, items[1][2], items[2][2])
	assert.Contains(t, string(svg), ">More<")
}

// A compact menu's width counts its label (or name), its name tag and each
// capability once; it is never less than minFlex.
func TestMenuButtonWidth(t *testing.T) {
	m := &registry.Region{Name: "more", Kind: "menu", Requires: "edit", Items: []registry.NavItem{{Requires: "share"}, {Requires: "edit"}}}
	assert.Equal(t, "edit, share", menuRequires(m))
	want := textWidth("more ▾", labelSize) + 16 + textWidth("more", nameSize) + 12 + textWidth("edit, share", nameSize) + 18
	assert.Equal(t, want, menuButtonWidth(m))
	assert.Equal(t, float64(minFlex), menuButtonWidth(&registry.Region{Kind: "menu", Label: "M"}))
	m.Status = registry.Proposed
	assert.True(t, menuProposed(m))
}

// A name used twice (a duplicate-region finding, but still drawn) outlines
// every region of that name; the badge goes on the first.
func TestWireframeHighlightedRepeatedName(t *testing.T) {
	s := &registry.Screen{ID: "a.b", Presentation: "root", Layout: []*registry.Region{
		leaf("dup", "text", "One"), leaf("other", "text", "Two"), leaf("dup", "text", "Three"),
	}}
	got := string(WireframeHighlighted(s, "phone", formFactor(t, "phone"), "dup", 2))
	assert.Equal(t, 2, strings.Count(got, `class="highlight"`))
	assert.Equal(t, 1, strings.Count(got, `<circle class="badge"`))
}

// A step number of 0 or less is no step: the outline, but no badge.
func TestWireframeHighlightedNoBadgeForZero(t *testing.T) {
	got := string(WireframeHighlighted(timeline("tab"), "phone", formFactor(t, "phone"), "add-activity", 0))
	assert.Contains(t, got, `class="highlight"`)
	assert.NotContains(t, got, `class="badge"`)
}

// A menu in a bar that declares a Width is still a compact button, drawn at
// the width it declares.
func TestMenuInABarWithWidthIsACompactButton(t *testing.T) {
	s := menuIn("bar", nil)
	s.Layout[0].Children[1].Width = registry.Width{Px: 120}
	svg := Wireframe(s, "phone", formFactor(t, "phone"))
	rs := boxes(t, svg, "region")
	assert.Equal(t, 120.0, rs[2][2])
	assert.Contains(t, string(svg), ">More ▾<")
	assert.NotContains(t, string(svg), `class="item"`)
}
