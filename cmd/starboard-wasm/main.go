// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

//go:build js && wasm

// Command starboard-wasm is core compiled to WebAssembly. It sets
// globalThis.__starboard to an object holding one function per bridge
// name, each taking one JSON string and returning one JSON string, and
// then blocks so the functions stay callable. Everything but the js glue
// is internal/wasmbridge, which the normal test run covers.
package main

import (
	"syscall/js"

	"github.com/c65llc/starboard/internal/wasmbridge"
)

func main() {
	api := js.Global().Get("Object").New()
	for _, name := range wasmbridge.Names {
		api.Set(name, js.FuncOf(func(_ js.Value, args []js.Value) any {
			arg := ""
			if len(args) > 0 && args[0].Type() == js.TypeString {
				arg = args[0].String()
			}
			return wasmbridge.Call(name, arg)
		}))
	}
	js.Global().Set("__starboard", api)
	select {}
}
