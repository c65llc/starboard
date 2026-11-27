// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package registry

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func timeline(t *testing.T) *Screen {
	t.Helper()
	reg, ds := Parse(fixture(t, "timeline.yaml"))
	require.Empty(t, ds)
	return reg.Screens["trip.timeline"]
}

func TestLayoutForOverride(t *testing.T) {
	s := timeline(t)
	assert.Same(t, s.Layouts["web-wide"][0], s.LayoutFor("web-wide")[0])
	assert.Same(t, s.Layout[0], s.LayoutFor("phone")[0])
	assert.Same(t, s.Layout[0], s.LayoutFor("")[0])
}

func TestWalkOrder(t *testing.T) {
	s := timeline(t)
	var got []string
	assert.Equal(t, "layouts.web-wide", s.LayoutPath("web-wide"))
	WalkFrom(s.LayoutFor("web-wide"), s.LayoutPath("web-wide"), func(r *Region, path string) {
		got = append(got, path+"="+r.Name)
	})
	assert.Equal(t, []string{
		"layouts.web-wide[0]=shell",
		"layouts.web-wide[0].children[0]=tabs",
		"layouts.web-wide[0].children[1]=main",
		"layouts.web-wide[0].children[1].children[0]=day-heading",
		"layouts.web-wide[0].children[1].children[1]=activities",
		"layouts.web-wide[0].children[1].children[1].item=",
	}, got)

	assert.Equal(t, "layout", s.LayoutPath("phone"))

	got = nil
	Walk(s.Layout, func(_ *Region, path string) { got = append(got, path) })
	assert.Equal(t, []string{
		"layout[0]", "layout[0].children[0]", "layout[0].children[1]",
		"layout[1]", "layout[2]", "layout[2].item", "layout[3]", "layout[4]",
	}, got)

	Walk(nil, func(*Region, string) { t.Fatal("no regions, no calls") })
}

func TestEdges(t *testing.T) {
	s := timeline(t)
	assert.Equal(t, []Edge{
		{From: "trip.timeline", To: "activity.detail", Region: "activities", Path: "layout[2].item", Line: 24},
		{From: "trip.timeline", To: "activity.editor", Region: "add-activity", Path: "layout[3]", Line: 26},
		{From: "trip.timeline", To: "trip.checklist", Region: "tabs", Path: "layout[4].items[1]", Line: 31},
		{From: "trip.timeline", To: "trip.info", Region: "info", Path: "layout[0].children[1]", Line: 20},
		{From: "trip.timeline", To: "trip.timeline", Region: "tabs", Path: "layout[4].items[0]", Line: 30},
	}, Edges(s, "phone"))

	assert.Equal(t, []Edge{
		{From: "trip.timeline", To: "activity.detail", Region: "activities", Path: "layouts.web-wide[0].children[1].children[1].item", Line: 49},
		{From: "trip.timeline", To: "trip.checklist", Region: "tabs", Path: "layouts.web-wide[0].children[0].items[1]", Line: 42},
		{From: "trip.timeline", To: "trip.timeline", Region: "tabs", Path: "layouts.web-wide[0].children[0].items[0]", Line: 41},
	}, Edges(s, "web-wide"))
}

func TestEdgesSortByPathWithinTarget(t *testing.T) {
	src := `screens:
  a.b:
    layout:
      - { region: z, kind: action, to: c.d }
      - { region: y, kind: action, to: c.d }
      - region: l
        kind: list
        item:
          kind: list
          item: { kind: card, to: c.d }
    title: T
    area: a
    presentation: push
`
	es := Edges(parseOK(t, src).Screens["a.b"], "phone")
	require.Len(t, es, 3)
	assert.Equal(t, []string{"layout[0]", "layout[1]", "layout[2].item.item"},
		[]string{es[0].Path, es[1].Path, es[2].Path})
	// A nameless item inherits the nearest named ancestor's name.
	assert.Equal(t, "l", es[2].Region)
}
