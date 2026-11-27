// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package wasmbridge is the JSON boundary between core and JavaScript.
// cmd/starboard-wasm exposes each of Names as globalThis.__starboard[name],
// a function from one JSON string to one JSON string, and calls Call; all
// the decoding, dispatch and error handling lives here, where the normal
// test run measures it.
//
// The argument is a JSON object holding the named arguments, such as
// {"files":{…},"strict":true}; unknown fields are refused, so a misspelt
// argument fails loudly instead of being ignored. The result is
// {"ok":true,"value":…} or {"ok":false,"error":"…"}. Call never panics.
package wasmbridge

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/c65llc/starboard/core"
)

// Names are the functions the bridge exposes, in the order of core's API.
var Names = []string{"lint", "format", "generate", "fix", "render", "model", "walkthrough", "edit", "scope"}

// funcs maps each of Names to its decoder and core call.
var funcs = map[string]func(arg []byte) (any, error){
	"lint": func(arg []byte) (any, error) {
		var a struct {
			Files  core.Files `json:"files"`
			Strict bool       `json:"strict"`
		}
		if err := decode(arg, &a); err != nil {
			return nil, err
		}
		return core.Lint(a.Files, a.Strict)
	},
	"format":   filesOnly(func(f core.Files) (any, error) { return core.Format(f) }),
	"generate": filesOnly(func(f core.Files) (any, error) { return core.Generate(f) }),
	"fix":      filesOnly(func(f core.Files) (any, error) { return core.Fix(f) }),
	"model":    filesOnly(func(f core.Files) (any, error) { return core.Model(f) }),
	"scope":    filesOnly(func(f core.Files) (any, error) { return core.Scope(f) }),
	"render": func(arg []byte) (any, error) {
		var a struct {
			Files      core.Files `json:"files"`
			Screen     string     `json:"screen"`
			FormFactor string     `json:"formFactor"`
			Region     string     `json:"region"` // optional: the region to outline
		}
		if err := decode(arg, &a); err != nil {
			return nil, err
		}
		return core.RenderHighlighted(a.Files, a.Screen, a.FormFactor, a.Region)
	},
	"walkthrough": func(arg []byte) (any, error) {
		var a struct {
			Files      core.Files `json:"files"`
			Flow       string     `json:"flow"`
			FormFactor string     `json:"formFactor"`
		}
		if err := decode(arg, &a); err != nil {
			return nil, err
		}
		return core.Walkthrough(a.Files, a.Flow, a.FormFactor)
	},
	"edit": func(arg []byte) (any, error) {
		var a struct {
			Files core.Files    `json:"files"`
			Ops   []core.EditOp `json:"ops"`
		}
		if err := decode(arg, &a); err != nil {
			return nil, err
		}
		return core.Edit(a.Files, a.Ops)
	},
}

// filesOnly adapts a core function whose only argument is the project.
func filesOnly(fn func(core.Files) (any, error)) func([]byte) (any, error) {
	return func(arg []byte) (any, error) {
		var a struct {
			Files core.Files `json:"files"`
		}
		if err := decode(arg, &a); err != nil {
			return nil, err
		}
		return fn(a.Files)
	}
}

// errArgs marks an argument that is not the JSON object a function takes.
var errArgs = errors.New("invalid arguments")

// decode reads arg, one JSON object, into v, refusing unknown fields and
// trailing data.
func decode(arg []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(arg))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("%w: %w", errArgs, err)
	}
	// More reports false before a '}' or ']', so ask for the next token:
	// only the end of the input is no trailing data.
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return fmt.Errorf("%w: trailing data after the object", errArgs)
	}
	return nil
}

type success struct {
	OK    bool `json:"ok"`
	Value any  `json:"value"`
}

type failure struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

// Call runs the bridge function fn on the JSON argument arg and returns
// the JSON envelope. A panic in core comes back as an internal error.
func Call(fn, arg string) (out string) {
	defer func() {
		if r := recover(); r != nil {
			out = fail(fmt.Errorf("%s: internal error: %v", fn, r))
		}
	}()
	f, ok := funcs[fn]
	if !ok {
		return fail(fmt.Errorf("unknown function %q", fn))
	}
	v, err := f([]byte(arg))
	if err != nil {
		return fail(fmt.Errorf("%s: %w", fn, err))
	}
	b, err := json.Marshal(success{OK: true, Value: v})
	if err != nil {
		return fail(fmt.Errorf("%s: encoding the result: %w", fn, err))
	}
	return string(b)
}

// fail is the error envelope for err. Marshalling a string cannot fail.
func fail(err error) string {
	b, _ := json.Marshal(failure{Error: err.Error()})
	return string(b)
}
