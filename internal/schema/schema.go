// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package schema holds the JSON Schemas (draft 2020-12) for starboard.yaml
// and screens.yaml, for editors and agents. They accept what config.Parse
// and registry.Parse accept wherever JSON Schema can say so; rules it cannot
// express, such as unique region names or a width fraction no greater than
// one, are left to the parsers and lint.
package schema

import (
	"bytes"
	_ "embed"
)

// Names are the schemas Get knows, sorted.
var Names = []string{"config", "screens"}

var (
	//go:embed config.schema.json
	configSchema []byte
	//go:embed screens.schema.json
	screensSchema []byte
)

// Get returns a copy of the named schema: "config" for starboard.yaml or
// "screens" for screens.yaml. Its $id is
// https://starboard.c65llc.com/schema/v1/<name>.json.
func Get(name string) ([]byte, bool) {
	switch name {
	case "config":
		return bytes.Clone(configSchema), true
	case "screens":
		return bytes.Clone(screensSchema), true
	}
	return nil, false
}
