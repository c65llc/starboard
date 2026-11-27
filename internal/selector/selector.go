// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package selector is the small path language a vocabulary uses to pick a
// list of strings out of a JSON or YAML document. Its grammar is
// ('.' ident ('[]')?)+: field access, optionally followed by iteration over
// an array, chained. ".capabilities[].name" is the canonical example.
package selector

import (
	"fmt"
	"regexp"
)

// step is one '.' ident ('[]')? segment.
type step struct {
	field string
	iter  bool
}

// Selector is a compiled selector expression.
type Selector struct {
	expr  string
	steps []step
}

var stepRE = regexp.MustCompile(`^\.([A-Za-z_][A-Za-z0-9_-]*)(\[\])?`)

// Compile parses expr. Anything outside the grammar is an error.
func Compile(expr string) (Selector, error) {
	s := Selector{expr: expr}
	rest := expr
	for rest != "" {
		m := stepRE.FindStringSubmatch(rest)
		if m == nil {
			return Selector{}, fmt.Errorf("selector %q: unexpected %q; only .field and [] chained are supported", expr, rest)
		}
		s.steps = append(s.steps, step{field: m[1], iter: m[2] != ""})
		rest = rest[len(m[0]):]
	}
	if len(s.steps) == 0 {
		return Selector{}, fmt.Errorf("selector is empty; write one such as .capabilities[].name")
	}
	return s, nil
}

// String returns the source expression.
func (s Selector) String() string { return s.expr }

// Strings applies s to v, a decoded JSON or YAML value, and returns the
// strings it selects in document order. It is an error for a step to meet a
// value of the wrong shape, a missing field, or a final value that is not a
// string.
func (s Selector) Strings(v any) ([]string, error) {
	cur := []any{v}
	for _, st := range s.steps {
		var next []any
		for _, c := range cur {
			obj, ok := c.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("selector %s: .%s applied to a value that is not an object", s.expr, st.field)
			}
			fv, ok := obj[st.field]
			if !ok {
				return nil, fmt.Errorf("selector %s: no field %s", s.expr, st.field)
			}
			if !st.iter {
				next = append(next, fv)
				continue
			}
			arr, ok := fv.([]any)
			if !ok {
				return nil, fmt.Errorf("selector %s: .%s[] applied to a value that is not an array", s.expr, st.field)
			}
			next = append(next, arr...)
		}
		cur = next
	}
	out := make([]string, 0, len(cur))
	for _, c := range cur {
		str, ok := c.(string)
		if !ok {
			return nil, fmt.Errorf("selector %s: selected %v, which is not a string", s.expr, c)
		}
		out = append(out, str)
	}
	return out, nil
}
