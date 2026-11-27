// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/render"
)

func TestWalkthroughSteps(t *testing.T) {
	f := trip(t)
	w, err := Walkthrough(f, "add-activity", "phone")
	require.NoError(t, err)
	require.Len(t, w.Steps, 3)

	first := w.Steps[0]
	assert.Equal(t, 1, first.Number)
	assert.Equal(t, "Tap @trip.timeline#add-activity.", first.Text)
	assert.Equal(t, "trip.timeline", first.Screen)
	assert.Equal(t, "add-activity", first.Region)
	assert.Equal(t, "root", first.Presentation)
	assert.Equal(t, "activity.editor", first.Next)
	assert.Equal(t, []string{"If the trip is read-only, the button is hidden."}, first.Branches)
	assert.Contains(t, first.SVG, `stroke="#0B6B4E"`)
	assert.Equal(t, string(render.WireframeHighlighted(screen(t, f, "trip.timeline"), "phone",
		config.DefaultFormFactors["phone"], "add-activity", 1)), first.SVG)

	second := w.Steps[1]
	assert.Equal(t, "activity.editor", second.Screen)
	assert.Equal(t, "title", second.Region)
	assert.Equal(t, "sheet", second.Presentation)
	assert.Equal(t, "activity.editor", second.Next, "the next step is on the same screen")
	assert.Equal(t, []string{}, second.Branches)
	assert.Contains(t, second.SVG, ">2</text>")

	last := w.Steps[2]
	assert.Equal(t, 3, last.Number)
	assert.Equal(t, "save", last.Region)
	assert.Empty(t, last.Next)
	assert.Contains(t, last.SVG, `stroke="#0B6B4E"`)
}

func TestWalkthroughUsesFormFactorLayout(t *testing.T) {
	// The web-wide override has its own add-activity region.
	w, err := Walkthrough(trip(t), "add-activity", "web-wide")
	require.NoError(t, err)
	assert.Contains(t, w.Steps[0].SVG, "Timeline — web-wide")
	assert.Contains(t, w.Steps[0].SVG, `stroke="#0B6B4E"`)
}

func TestWalkthroughStepWithoutRef(t *testing.T) {
	w, err := Walkthrough(trip(t), "browse", "phone")
	require.NoError(t, err)
	require.Len(t, w.Steps, 2)
	assert.Equal(t, "trip.timeline", w.Steps[0].Screen)
	assert.Empty(t, w.Steps[0].Region)
	assert.Empty(t, w.Steps[0].Next, "the next step has no screen")
	assert.NotContains(t, w.Steps[0].SVG, `stroke="#0B6B4E"`, "a reference with no region highlights nothing")
	assert.Contains(t, w.Steps[0].SVG, "<svg")

	bare := w.Steps[1]
	assert.Equal(t, WalkStep{Number: 2, Text: "Scroll through the days.", Branches: []string{}}, bare)
}

func TestWalkthroughUnknownScreen(t *testing.T) {
	f := trip(t)
	f["docs/flows/flows/browse.md"] += "3. Open @trip.nowhere#x.\n"
	w, err := Walkthrough(f, "browse", "phone")
	require.NoError(t, err)
	require.Len(t, w.Steps, 3)
	assert.Equal(t, "trip.nowhere", w.Steps[2].Screen)
	assert.Equal(t, "x", w.Steps[2].Region)
	assert.Empty(t, w.Steps[2].Presentation)
	assert.Empty(t, w.Steps[2].SVG, "an unregistered screen has no wireframe")
}

func TestWalkthroughJSON(t *testing.T) {
	w, err := Walkthrough(trip(t), "browse", "phone")
	require.NoError(t, err)
	w.Steps[0].SVG = "<svg/>"
	assert.JSONEq(t, `{"steps":[
		{"number":1,"text":"Open @trip.timeline.","screen":"trip.timeline","region":"","presentation":"root","next":"","branches":[],"svg":"<svg/>"},
		{"number":2,"text":"Scroll through the days.","screen":"","region":"","presentation":"","next":"","branches":[],"svg":""}
	]}`, marshal(t, w))

	empty, err := Walkthrough(Files{
		config.FileName:               "version: 1\n",
		"docs/flows/flows/nothing.md": "---\nid: nothing\ntitle: Nothing\nstatus: shipped\nentry: a.b\n---\n",
	}, "nothing", "phone")
	require.NoError(t, err)
	assert.JSONEq(t, `{"steps":[]}`, marshal(t, empty))
}

func TestWalkthroughErrors(t *testing.T) {
	f := trip(t)
	_, err := Walkthrough(f, "nope", "phone")
	require.ErrorIs(t, err, ErrUnknownFlow)
	assert.EqualError(t, err, "unknown flow: nope; use one of add-activity, browse")

	for _, ff := range []string{"watch", ""} {
		_, err = Walkthrough(f, "add-activity", ff)
		require.ErrorIs(t, err, ErrUnknownFormFactor, "%q", ff)
	}
}
