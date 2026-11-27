// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package render draws a screen's layout region tree as a grey-box SVG
// wireframe. It is a simple box layout, not a layout engine: geometry,
// colours and fonts are fixed, and the output is byte-stable for a given
// screen and form factor.
package render

import (
	"encoding/xml"
	"math"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/registry"
)

// Geometry, in pixels.
const (
	margin    = 24 // around the frame
	gap       = 8  // between siblings
	pad       = 4  // inside a container, beside and below its children
	caption   = 16 // the strip at the top of a container for its label and name
	navItemH  = 36 // one nav item
	titleBarH = 28 // a window's title bar
	minFlex   = 40 // the least a fill-the-rest region gets, and an unknown kind's height
	cardH     = 72 // a list item's height when the list has no item, and a form's natural height
	dialogR   = 12 // a dialog panel's corner radius
	badgeR    = 9  // a highlight's step badge radius
	radiusBox = 4  // a region's corner radius
	eps       = 0.01
)

// Style.
const (
	white       = "#FFFFFF"
	fill        = "#ECECE6"
	strongFill  = "#C9C9C1"
	stroke      = "#9A9A92"
	nameFill    = "#5B5F66"
	labelFill   = "#2E3135"
	scrimFill   = "#808080"
	outline     = "#0B6B4E"
	labelFont   = "system-ui, -apple-system, Segoe UI, sans-serif"
	nameFont    = "ui-monospace, Menlo, Consolas, monospace"
	labelSize   = 12
	nameSize    = 9
	badgeSize   = 11
	charWidth   = 0.6 // a rune's estimated width, as a share of the font size
	dashPattern = "6 4"
)

// heights are the fixed-height kinds.
var heights = map[string]float64{
	"bar": 48, "tabs": 56, "header": 40, "text": 24, "field": 44,
	"action": 40, "primary-action": 48, "banner": 56, "media": 160,
	"map": 200, "card": 72, "menu": 40,
}

// flex are the kinds that share a stack's remaining height equally.
var flex = map[string]bool{"list": true, "form": true, "section": true, "column": true, "row": true}

// captioned kinds put their label and name in a caption strip at the top,
// above their children or items; other kinds centre the label.
var captioned = map[string]bool{
	"column": true, "row": true, "section": true, "bar": true,
	"list": true, "tabs": true, "nav": true, "menu": true,
}

type rect struct{ x, y, w, h float64 }

func (a rect) bottom() float64 { return a.y + a.h }
func (a rect) right() float64  { return a.x + a.w }

// shrink returns a inset by d on every side.
func (a rect) shrink(d float64) rect { return rect{a.x + d, a.y + d, a.w - 2*d, a.h - 2*d} }

// inner is the area a captioned region gives its children or items.
func (a rect) inner() rect { return rect{a.x + pad, a.y + caption, a.w - 2*pad, a.h - caption - pad} }

type renderer struct {
	b         strings.Builder
	highlight string
	badge     int
	badgeAt   *rect // the highlighted region's box, once drawn
	clipping  bool  // drawing inside clip, the clipped body
	clip      rect
	overflow  bool // something was clipped
}

// Wireframe draws s's layout for the form factor ffName, of size ff, as an
// SVG document.
func Wireframe(s *registry.Screen, ffName string, ff config.FormFactor) []byte {
	return render(s, ffName, ff, "", 0)
}

// WireframeHighlighted is Wireframe with a 2 px outline around the region
// named region and a round badge showing badge, the step number, on its top
// left corner. The badge is drawn last, so nothing covers it. If that
// layout has no such region, or the region is clipped away, it equals
// Wireframe.
func WireframeHighlighted(s *registry.Screen, ffName string, ff config.FormFactor, region string, badge int) []byte {
	return render(s, ffName, ff, region, badge)
}

func render(s *registry.Screen, ffName string, ff config.FormFactor, highlight string, badge int) []byte {
	r := &renderer{highlight: highlight, badge: badge}
	frame := rect{margin, margin, float64(ff.Width), float64(ff.Height)}
	width, height := frame.w+2*margin, frame.h+2*margin
	radius := frameRadius(ffName)
	title := s.Title
	if title == "" {
		title = s.ID
	}
	title += " — " + ffName
	layout := s.LayoutFor(ffName)

	r.open("svg", "xmlns", "http://www.w3.org/2000/svg", "width", num(width), "height", num(height),
		"viewBox", "0 0 "+num(width)+" "+num(height), "role", "img", "aria-label", title)
	r.b.WriteString(">\n<title>")
	r.esc(title)
	r.b.WriteString("</title>\n")
	r.el("rect", "class", "card", "x", "0", "y", "0", "width", num(width), "height", num(height), "fill", white)

	panel, panelRadius, content := frame, radius, frame
	switch s.Presentation {
	case "window":
		r.titleBar(frame, radius)
		content = rect{frame.x, frame.y + titleBarH, frame.w, frame.h - titleBarH}
	case "sheet", "dialog":
		r.parent(frame, radius)
		r.el("rect", "class", "scrim", "x", num(frame.x), "y", num(frame.y), "width", num(frame.w),
			"height", num(frame.h), "rx", num(radius), "fill", scrimFill, "fill-opacity", "0.4")
		if s.Presentation == "sheet" {
			panel = rect{frame.x, frame.y + 0.15*frame.h, frame.w, 0.85 * frame.h}
		} else {
			panelRadius = dialogR
			h := math.Min(naturalStack(layout)+2*inset(dialogR), frame.h-2*margin)
			w := 0.8 * frame.w
			panel = rect{frame.x + (frame.w-w)/2, frame.y + (frame.h-h)/2, w, h}
		}
		r.el("rect", "class", "panel", "x", num(panel.x), "y", num(panel.y), "width", num(panel.w),
			"height", num(panel.h), "rx", num(panelRadius), "fill", white, "stroke", stroke, "stroke-width", "2")
		content = panel
	}

	r.top(layout, content.shrink(inset(panelRadius)))

	r.el("rect", "class", "frame", "x", num(frame.x), "y", num(frame.y), "width", num(frame.w),
		"height", num(frame.h), "rx", num(radius), "fill", "none", "stroke", stroke, "stroke-width", "2")
	if r.overflow {
		cx, by := panel.x+panel.w/2, panel.bottom()
		r.el("rect", "class", "overflow", "x", num(cx-14), "y", num(by-7), "width", "28", "height", "14",
			"rx", "7", "fill", white, "stroke", stroke, "stroke-width", "1")
		r.text("…", "class", "overflow", "x", num(cx), "y", num(by+4), "text-anchor", "middle",
			"font-size", strconv.Itoa(labelSize), "font-family", labelFont, "fill", labelFill)
	}
	if a := r.badgeAt; a != nil {
		r.el("circle", "class", "badge", "cx", num(a.x), "cy", num(a.y), "r", strconv.Itoa(badgeR), "fill", outline)
		r.text(strconv.Itoa(r.badge), "class", "badge", "x", num(a.x), "y", num(a.y+4), "text-anchor", "middle",
			"font-size", strconv.Itoa(badgeSize), "font-weight", "600", "font-family", labelFont, "fill", white)
	}
	r.b.WriteString("</svg>\n")
	return []byte(r.b.String())
}

// frameRadius is the frame's corner radius for a form factor.
func frameRadius(ffName string) float64 {
	switch ffName {
	case "phone":
		return 28
	case "tablet":
		return 20
	}
	return 8
}

// inset is the space between a frame or panel of corner radius radius and
// its content, so that content clears the rounded corners.
func inset(radius float64) float64 { return math.Max(gap, radius/2) }

// titleBar draws a window's title bar with its three buttons.
func (r *renderer) titleBar(frame rect, radius float64) {
	c := math.Min(radius, titleBarH)
	d := "M" + num(frame.x) + " " + num(frame.y+c) +
		" A" + num(c) + " " + num(c) + " 0 0 1 " + num(frame.x+c) + " " + num(frame.y) +
		" H" + num(frame.right()-c) +
		" A" + num(c) + " " + num(c) + " 0 0 1 " + num(frame.right()) + " " + num(frame.y+c) +
		" V" + num(frame.y+titleBarH) + " H" + num(frame.x) + " Z"
	r.el("path", "class", "titlebar", "d", d, "fill", fill)
	r.el("line", "x1", num(frame.x), "y1", num(frame.y+titleBarH), "x2", num(frame.right()),
		"y2", num(frame.y+titleBarH), "stroke", stroke, "stroke-width", "1")
	for i := range 3 {
		r.el("circle", "cx", num(frame.x+14+float64(i)*16), "cy", num(frame.y+titleBarH/2), "r", "5",
			"fill", strongFill, "stroke", stroke, "stroke-width", "1")
	}
}

// parent draws the generic screen a sheet or dialog covers: a bar and as
// many cards as fit.
func (r *renderer) parent(frame rect, radius float64) {
	a := frame.shrink(inset(radius))
	y, h := a.y, heights["bar"]
	for y+h <= a.bottom() {
		r.el("rect", "class", "parent", "x", num(a.x), "y", num(y), "width", num(a.w), "height", num(h),
			"rx", strconv.Itoa(radiusBox), "fill", fill, "stroke", stroke, "stroke-width", "1")
		y += h + gap
		h = cardH
	}
}

// top lays out a whole layout in a: a leading bar pins to the top, a
// trailing tabs to the bottom, and the rest stacks between them, clipped.
func (r *renderer) top(layout []*registry.Region, a rect) {
	body := layout
	var first, last *registry.Region
	if len(body) > 0 && body[0].Kind == "bar" {
		first, body = body[0], body[1:]
	}
	if len(body) > 0 && body[len(body)-1].Kind == "tabs" {
		last, body = body[len(body)-1], body[:len(body)-1]
	}
	b := a
	if first != nil {
		h := heights["bar"]
		r.region(first, rect{a.x, a.y, a.w, h}, true)
		b.y += h + gap
		b.h -= h + gap
	}
	if last != nil {
		b.h -= heights["tabs"] + gap
	}
	b.h = math.Max(b.h, 0)

	r.b.WriteString(`<defs><clipPath id="sb-clip">`)
	r.open("rect", "x", num(b.x), "y", num(b.y), "width", num(b.w), "height", num(b.h))
	r.b.WriteString("/></clipPath></defs>\n<g clip-path=\"url(#sb-clip)\">\n")
	r.clipping, r.clip = true, b
	r.stack(body, b)
	r.clipping = false
	r.b.WriteString("</g>\n")

	if last != nil {
		h := heights["tabs"]
		r.region(last, rect{a.x, a.bottom() - h, a.w, h}, true)
	}
}

// visible reports whether a is drawn at all, and notes an overflow if any
// of it lies past the clipped body.
func (r *renderer) visible(a rect) bool {
	if !r.clipping {
		return true
	}
	if a.y >= r.clip.bottom()-eps || a.x >= r.clip.right()-eps {
		r.overflow = true
		return false
	}
	if a.bottom() > r.clip.bottom()+eps || a.right() > r.clip.right()+eps {
		r.overflow = true
	}
	return true
}

// stack lays rs out top to bottom in a: fixed kinds at their heights, and
// the fill-the-rest kinds sharing what remains equally.
func (r *renderer) stack(rs []*registry.Region, a rect) {
	fixed, flexes := 0.0, 0
	for _, rg := range rs {
		if flex[rg.Kind] {
			flexes++
		} else {
			fixed += natural(rg)
		}
	}
	share := 0.0
	if flexes > 0 {
		share = math.Max((a.h-fixed-gap*float64(len(rs)-1))/float64(flexes), minFlex)
	}
	y := a.y
	for _, rg := range rs {
		h := share
		if !flex[rg.Kind] {
			h = natural(rg)
		}
		r.region(rg, rect{a.x, y, a.w, h}, true)
		y += h + gap
	}
}

// across lays rs out left to right in a: each by its Width, pixels or a
// fraction of the space, and those without one sharing the rest equally.
// In a bar (inBar), a menu without a Width is a compact button as wide as
// its label needs (menuButtonWidth).
func (r *renderer) across(rs []*registry.Region, a rect, inBar bool) {
	avail := a.w - gap*float64(len(rs)-1)
	widths := make([]float64, len(rs))
	used, free := 0.0, 0
	for i, rg := range rs {
		switch w := rg.Width; {
		case w.Px > 0:
			widths[i] = float64(w.Px)
		case w.Den > 0:
			widths[i] = avail * float64(w.Num) / float64(w.Den)
		case inBar && rg.Kind == "menu":
			widths[i] = math.Min(menuButtonWidth(rg), avail)
		default:
			widths[i] = -1
			free++
			continue
		}
		used += widths[i]
	}
	rest := 0.0
	if free > 0 {
		rest = math.Max(avail-used, 0) / float64(free)
	}
	x := a.x
	for i, rg := range rs {
		w := widths[i]
		if w < 0 {
			w = rest
		}
		r.regionIn(rg, rect{x, a.y, w, a.h}, true, inBar)
		x += w + gap
	}
}

// A menu directly inside a bar is drawn as an app bar shows a closed menu:
// one button with its label and a disclosure mark, its items behind it. It
// is dashed when it or any item is proposed, and carries the lock and the
// capabilities its items require, so the button keeps what the items say.

// menuLabel is a compact menu's label: its label, or its name when it has
// none, and a disclosure mark.
func menuLabel(rg *registry.Region) string {
	label := rg.Label
	if label == "" {
		label = rg.Name
	}
	return label + " ▾"
}

// menuRequires is the capabilities a compact menu shows: its own, then each
// item's, each once, in order.
func menuRequires(rg *registry.Region) string {
	var caps []string
	for _, c := range append([]string{rg.Requires}, itemRequires(rg.Items)...) {
		if c != "" && !slices.Contains(caps, c) {
			caps = append(caps, c)
		}
	}
	return strings.Join(caps, ", ")
}

func itemRequires(items []registry.NavItem) []string {
	out := make([]string, len(items))
	for i, it := range items {
		out[i] = it.Requires
	}
	return out
}

// menuProposed reports whether a compact menu is drawn dashed: it, or any
// of its items, is proposed.
func menuProposed(rg *registry.Region) bool {
	return rg.Status == registry.Proposed || slices.ContainsFunc(rg.Items, func(it registry.NavItem) bool {
		return it.Status == registry.Proposed
	})
}

// menuButtonWidth is the width a compact menu needs: its label, then its
// name and capability tag as labels draws them.
func menuButtonWidth(rg *registry.Region) float64 {
	w := textWidth(menuLabel(rg), labelSize) + 16
	if rg.Name != "" {
		w += textWidth(rg.Name, nameSize) + 12
	}
	if c := menuRequires(rg); c != "" {
		w += textWidth(c, nameSize) + 18
	}
	return math.Max(w, minFlex)
}

// natural is a region's height when nothing constrains it.
func natural(rg *registry.Region) float64 {
	if h, ok := heights[rg.Kind]; ok {
		return h
	}
	switch rg.Kind {
	case "list":
		item := float64(cardH)
		if rg.Item != nil {
			item = natural(rg.Item)
		}
		return caption + 3*item + 2*gap + pad
	case "column", "section":
		if len(rg.Children) == 0 {
			return minFlex
		}
		return caption + naturalStack(rg.Children) + pad
	case "row":
		tallest := 0.0
		for _, c := range rg.Children {
			tallest = math.Max(tallest, natural(c))
		}
		return math.Max(caption+tallest+pad, minFlex)
	case "nav":
		n := float64(len(rg.Items))
		if n == 0 {
			return minFlex
		}
		return caption + n*navItemH + (n-1)*gap + pad
	case "form":
		return cardH
	}
	return minFlex
}

// naturalStack is the natural height of rs stacked with gaps.
func naturalStack(rs []*registry.Region) float64 {
	h := 0.0
	for i, rg := range rs {
		if i > 0 {
			h += gap
		}
		h += natural(rg)
	}
	return h
}

// region draws rg in a, then its children, item or items. showName is false
// for a list item's repeats, so a name appears once.
func (r *renderer) region(rg *registry.Region, a rect, showName bool) {
	r.regionIn(rg, a, showName, false)
}

// regionIn is region, for a direct child of a bar when inBar is true.
func (r *renderer) regionIn(rg *registry.Region, a rect, showName, inBar bool) {
	if !r.visible(a) {
		return
	}
	compact := inBar && rg.Kind == "menu"
	f := fill
	if rg.Kind == "primary-action" {
		f = strongFill
	}
	proposed, requires := rg.Status == registry.Proposed, rg.Requires
	if compact {
		proposed, requires = menuProposed(rg), menuRequires(rg)
	}
	r.box("region", a, f, proposed)
	if showName && r.highlight != "" && rg.Name == r.highlight && r.badgeAt == nil {
		r.badgeAt = &a
		r.el("rect", "class", "highlight", "x", num(a.x), "y", num(a.y), "width", num(a.w), "height", num(a.h),
			"rx", strconv.Itoa(radiusBox), "fill", "none", "stroke", outline, "stroke-width", "2")
	}
	if rg.Kind == "media" || rg.Kind == "map" {
		r.el("path", "class", "placeholder", "d", "M"+num(a.x)+" "+num(a.y)+" L"+num(a.right())+" "+num(a.bottom())+
			" M"+num(a.right())+" "+num(a.y)+" L"+num(a.x)+" "+num(a.bottom()), "stroke", stroke, "stroke-width", "1")
	}
	name := ""
	if showName {
		name = rg.Name
	}
	label := rg.Label
	if label == "" {
		label = rg.Name
	}
	baseline := a.y + a.h/2 + 4
	if captioned[rg.Kind] && !compact {
		baseline = a.y + 13
	}
	if compact {
		label = menuLabel(rg)
	}
	r.labels(a, label, baseline, name, requires)
	if compact {
		return // a closed menu: its items are behind the button
	}

	switch rg.Kind {
	case "column", "section":
		r.stack(rg.Children, a.inner())
	case "row", "bar":
		r.across(rg.Children, a.inner(), rg.Kind == "bar")
	case "list":
		if rg.Item != nil {
			in, h := a.inner(), natural(rg.Item)
			for i := range 3 {
				r.region(rg.Item, rect{in.x, in.y + float64(i)*(h+gap), in.w, h}, i == 0)
			}
		}
	case "tabs", "menu":
		in := a.inner()
		n := float64(len(rg.Items))
		w := (in.w - gap*(n-1)) / n
		for i, it := range rg.Items {
			r.item(it, rect{in.x + float64(i)*(w+gap), in.y, w, in.h})
		}
	case "nav":
		in := a.inner()
		for i, it := range rg.Items {
			r.item(it, rect{in.x, in.y + float64(i)*(navItemH+gap), in.w, navItemH})
		}
	}
}

// item draws one tabs, nav or menu entry.
func (r *renderer) item(it registry.NavItem, a rect) {
	if !r.visible(a) {
		return
	}
	r.box("item", a, fill, it.Status == registry.Proposed)
	r.labels(a, it.Label, a.y+a.h/2+4, "", it.Requires)
}

// box draws a grey box.
func (r *renderer) box(class string, a rect, f string, proposed bool) {
	attrs := []string{"class", class, "x", num(a.x), "y", num(a.y), "width", num(a.w), "height", num(a.h),
		"rx", strconv.Itoa(radiusBox), "fill", f, "stroke", stroke, "stroke-width", "1"}
	if proposed {
		attrs = append(attrs, "stroke-dasharray", dashPattern)
	}
	r.el("rect", attrs...)
}

// labels draws a box's label at baseline, truncated to the room the region
// name and capability leave; those sit right-aligned along its top.
func (r *renderer) labels(a rect, label string, baseline float64, name, requires string) {
	right := a.right() - 6
	capRight := right // the capability's right edge, left of the name
	if name != "" {
		capRight -= textWidth(name, nameSize) + 6
	}
	room := a.w - 14 - (right - capRight)
	if requires != "" {
		room -= textWidth(requires, nameSize) + 18
	}
	if t := truncate(label, room, labelSize); t != "" {
		r.text(t, "class", "label", "x", num(a.x+8), "y", num(baseline),
			"font-size", strconv.Itoa(labelSize), "font-family", labelFont, "fill", labelFill)
	}
	if name != "" {
		r.text(name, "class", "name", "x", num(right), "y", num(a.y+10), "text-anchor", "end",
			"font-size", strconv.Itoa(nameSize), "font-family", nameFont, "fill", nameFill)
	}
	if requires != "" {
		r.lock(capRight-textWidth(requires, nameSize)-12, a.y+1)
		r.text(requires, "class", "cap", "x", num(capRight), "y", num(a.y+10), "text-anchor", "end",
			"font-size", strconv.Itoa(nameSize), "font-family", nameFont, "fill", nameFill)
	}
}

// lock draws a 10 px padlock with its top left at x, y.
func (r *renderer) lock(x, y float64) {
	r.b.WriteString(`<g class="lock" fill="none" stroke="` + nameFill + `" stroke-width="1">`)
	r.open("path", "d", "M"+num(x+2)+" "+num(y+5)+" V"+num(y+3)+" A3 3 0 0 1 "+num(x+8)+" "+num(y+3)+" V"+num(y+5))
	r.b.WriteString("/>")
	r.open("rect", "x", num(x+1), "y", num(y+5), "width", "8", "height", "5", "rx", "1", "fill", nameFill)
	r.b.WriteString("/></g>\n")
}

// textWidth estimates s's width at font size size, with no font metrics.
func textWidth(s string, size float64) float64 {
	return float64(utf8.RuneCountInString(s)) * charWidth * size
}

// truncate shortens s with an ellipsis to fit width at font size size. It
// is empty if not even one rune and the ellipsis fit.
func truncate(s string, width, size float64) string {
	if textWidth(s, size) <= width {
		return s
	}
	n := int(math.Floor(width/(charWidth*size))) - 1
	if n < 1 {
		return ""
	}
	return string([]rune(s)[:n]) + "…"
}

// num formats v, rounded to the nearest half pixel.
func num(v float64) string {
	v = math.Round(v*2) / 2
	if v == 0 {
		v = 0 // no "-0"
	}
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// open writes a start tag's name and attributes, given as name, value
// pairs, without closing it.
func (r *renderer) open(name string, attrs ...string) {
	r.b.WriteString("<" + name)
	for i := 0; i+1 < len(attrs); i += 2 {
		r.b.WriteString(" " + attrs[i] + `="`)
		r.esc(attrs[i+1])
		r.b.WriteString(`"`)
	}
}

// el writes an empty element on its own line.
func (r *renderer) el(name string, attrs ...string) {
	r.open(name, attrs...)
	r.b.WriteString("/>\n")
}

// text writes a text element on its own line.
func (r *renderer) text(content string, attrs ...string) {
	r.open("text", attrs...)
	r.b.WriteString(">")
	r.esc(content)
	r.b.WriteString("</text>\n")
}

// esc writes s XML-escaped. Writing to a strings.Builder cannot fail.
func (r *renderer) esc(s string) {
	_ = xml.EscapeText(&r.b, []byte(s))
}
