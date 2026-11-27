// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package core

import (
	"maps"
	"slices"

	"github.com/c65llc/starboard/internal/render"
)

// Walk is a flow as a storyboard: one WalkStep per numbered step.
type Walk struct {
	Steps []WalkStep `json:"steps"`
}

// WalkStep is one step of a walkthrough. Screen and Region are the step's
// first reference's, or "" when it has none; Presentation is that screen's.
// Next is the next step's screen, or "" for the last step or a next step
// with no reference. Branches are the step's sub-bullets. SVG is the
// screen's wireframe with Region outlined and badged with Number; it is ""
// when the step has no reference or the screen is not registered.
type WalkStep struct {
	Number       int      `json:"number"`
	Text         string   `json:"text"`
	Screen       string   `json:"screen"`
	Region       string   `json:"region"`
	Presentation string   `json:"presentation"`
	Next         string   `json:"next"`
	Branches     []string `json:"branches"`
	SVG          string   `json:"svg"`
}

// Walkthrough returns the flow flowID (its file's stem) as a storyboard
// drawn on formFactor, which must be a configured form factor. It returns
// ErrUnknownFlow or ErrUnknownFormFactor for a name that is neither, and
// ErrNotLoaded when starboard.yaml does not parse.
func Walkthrough(f Files, flowID, formFactor string) (Walk, error) {
	p, err := loadAny(f)
	if err != nil {
		return Walk{}, err
	}
	_, ok := p.Flows[flowID]
	if !ok {
		return Walk{}, unknown(ErrUnknownFlow, flowID, slices.Sorted(maps.Keys(p.Flows)))
	}
	size, err := formFactorSize(p, formFactor)
	if err != nil {
		return Walk{}, err
	}
	steps := flowOf(flowID, "", p).Steps
	w := Walk{Steps: make([]WalkStep, 0, len(steps))}
	for i, st := range steps {
		ws := WalkStep{Number: st.Number, Text: st.Text, Screen: st.Screen, Region: st.Region, Branches: st.Branches}
		if i+1 < len(steps) {
			ws.Next = steps[i+1].Screen
		}
		if s, ok := p.Registry.Screens[st.Screen]; ok {
			ws.Presentation = s.Presentation
			ws.SVG = string(render.WireframeHighlighted(s, formFactor, size, st.Region, st.Number))
		}
		w.Steps = append(w.Steps, ws)
	}
	return w, nil
}
