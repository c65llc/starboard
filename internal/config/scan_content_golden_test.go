// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package config

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var update = flag.Bool("update", false, "rewrite web/desktop/src-tauri/testdata/scan-content.json")

// scanCase is one starboard.yaml the desktop app's content scanner (Rust,
// web/desktop/src-tauri/src/roots.rs scan_content) is asked about. When Accept
// is true the scanner must return exactly Value; when false it must refuse.
// Rust may refuse what Parse accepts. It must never accept what Parse reads
// differently, and this test proves that half: Parse must read Value from
// every accepted file. The Rust test reads the same golden.
type scanCase struct {
	Name   string `json:"name"`
	YAML   string `json:"yaml"`
	Accept bool   `json:"accept"`
	Value  string `json:"value,omitempty"`
	// CoreRejects marks an accepted file Parse itself rejects (a null
	// content). The scanner then reads the default; Parse reports it, so
	// the two never read a different value.
	CoreRejects bool `json:"coreRejects,omitempty"`
}

const goldenPath = "../../web/desktop/src-tauri/testdata/scan-content.json"

func accepted(name, yaml, value string) scanCase {
	return scanCase{Name: name, YAML: yaml, Accept: true, Value: value}
}

func nullContent(name, yaml string) scanCase {
	c := accepted(name, yaml, DefaultContent)
	c.CoreRejects = true
	return c
}

func refused(name, yaml string) scanCase { return scanCase{Name: name, YAML: yaml} }

// travelApp is examples/travel-app's own starboard.yaml, whose quoted
// globs the desktop app must read.
func travelApp() string {
	b, err := os.ReadFile(filepath.FromSlash("../../examples/travel-app/starboard.yaml"))
	if err != nil {
		panic(err)
	}
	return string(b)
}

func scanCases() []scanCase {
	const v = "version: 1\nplatforms:\n  web: { formFactors: [web-wide] }\n"
	return []scanCase{
		accepted("absent", v, DefaultContent),
		accepted("plain", v+"content: docs\n", "docs"),
		accepted("bom", "\ufeff"+v+"content: my docs # x\n", "my docs"),
		accepted("dot", v+"content: .\n", "."),
		accepted("punctuation", v+"content: a/b-c_d.e\n", "a/b-c_d.e"),
		accepted("trailing comment", v+"content: records # where they live\n", "records"),
		nullContent("empty", v+"content:\n"),
		nullContent("empty with comment", v+"content: # none\n"),
		nullContent("empty then comment line", v+"content:\n# a comment\n"),
		nullContent("tilde", v+"content: ~\n"),
		nullContent("null", v+"content: null\n"),
		accepted("document start", "---\n"+v+"content: docs\n", "docs"),
		accepted("document start with comment", "--- # top\n"+v+"content: docs\n", "docs"),
		accepted("directive", "%YAML 1.1\n---\n"+v+"content: docs\n", "docs"),
		accepted("nested content is not top level", "version: 1\nplatforms:\n  content:\n    formFactors: [phone]\n", DefaultContent),
		accepted("commented content", v+"# content: commented\ncontent: real\n", "real"),
		accepted("key that starts alike", "version: 1\nplatforms:\n  contents: { formFactors: [phone] }\ncontent: z\n", "z"),
		accepted("crlf", strings.ReplaceAll(v+"content: docs\n", "\n", "\r\n"), "docs"),
		accepted("space in value", v+"content: my docs\n", "my docs"),
		accepted("flow value closed on its line", v+"areas: [trips, settings]\ncontent: docs\n", "docs"),
		accepted("anchor, alias, tag and block marks in a comment", "version: 1 # &a *b !c |\ncontent: docs\n", "docs"),
		accepted("quoted globs", "version: 1\nplatforms:\n  web:\n    screenFiles: [\"**/*View.swift\", 'a|b']\ncontent: docs\n", "docs"),
		accepted("ampersand and bang inside words", "version: 1\nareas: [a&b, c!]\ncontent: docs\n", "docs"),
		accepted("examples/travel-app", travelApp(), DefaultContent),
		accepted("brackets in a comment", v+"areas: [a] # see {x}\ncontent: docs\n", "docs"),
		accepted("quotes in an indented flow value", "version: 1\nplatforms:\n  web:\n    roots: [\"app\", 'it''s']\ncontent: docs\n", "docs"),

		refused("double quoted", v+"content: \"my docs\"\n"),
		refused("single quoted", v+"content: 'a/b'\n"),
		refused("backslash", v+"content: docs\\design\n"),
		refused("twice", v+"content: docs\ncontent: other\n"),
		refused("second document", "content: docs\n---\ncontent: other\n"),
		refused("document end", v+"content: docs\n...\n"),
		refused("anchor", v+"content: &c docs\n"),
		refused("alias", v+"base: &c docs\ncontent: *c\n"),
		refused("merge key", "<<: *defaults\n"+v),
		refused("flow document", "{content: docs}\n"),
		refused("flow mapping value", v+"content: {dir: docs}\n"),
		refused("flow sequence value", v+"content: [docs]\n"),
		refused("literal block", v+"content: |\n  docs\n"),
		refused("folded block", v+"content: >-\n  docs\n"),
		refused("value on next line", v+"content:\n  docs\n"),
		refused("quoted key", v+"\"content\": docs\n"),
		refused("single quoted key", v+"'content': docs\n"),
		refused("space before colon", v+"content : docs\n"),
		refused("complex key", v+"? content\n: docs\n"),
		refused("tag", v+"content: !!str docs\n"),
		refused("list marker", v+"content: - docs\n"),
		refused("colon space", v+"content: a: b\n"),

		// The forms that made the scanner and Parse disagree.
		refused("plain scalar continues onto an indented line", v+"content: .\n  x\n"),
		refused("plain scalar continues past a comment", v+"content: docs\n# c\n  more\n"),
		refused("plain scalar continues past a blank line", v+"content: docs\n\n  more\n"),
		refused("null continues onto an indented line", v+"content: null\n  x\n"),
		refused("tab-indented continuation", v+"content: docs\n\tmore\n"),
		refused("lone CR", v+"content: docs\rmore\n"),
		refused("lone CR between keys", "version: 1\rcontent: docs\n"+v[len("version: 1\n"):]),
		refused("NEL", v+"content: docs\u0085more\n"),
		refused("line separator", v+"content: docs\u2028more\n"),
		refused("paragraph separator", v+"content: docs\u2029more\n"),
		refused("whole document indented", "  version: 1\n  content: docs\n  platforms:\n    web: { formFactors: [web-wide] }\n"),
		refused("whole document indented after start", "---\n  version: 1\n  content: docs\n"),
		refused("whole document indented after comment", "# c\n\n  version: 1\n  content: docs\n"),
		refused("content after document start", "--- !!map\n"+v+"content: docs\n"),
		refused("flow after document start", "--- {content: docs}\n"),
		refused("block scalar after document start", "--- |\n  content: docs\n"),
		refused("content after document end", v+"content: docs\n... x\n"),

		// Ruling D4: a top-level line the scanner cannot classify as a
		// plain key is refused, whatever core makes of it: a quoted or
		// escaped key, an anchor, alias or tag on a key, a flow or complex
		// key, a sequence, and a flow collection that spans lines.
		refused("double-quoted other key", v+"\"areas\": [a]\ncontent: docs\n"),
		refused("escaped key", v+"\"con\\x74ent\": src\n"),
		refused("unicode-escaped key", v+"\"\\u0063ontent\": src\n"),
		refused("anchored key", v+"&a content: src\n"),
		refused("aliased key", "base: &k content\n"+v+"*k : src\n"),
		refused("tagged key", v+"!!str content: src\n"),
		refused("flow sequence key", v+"[content]: src\n"),
		refused("sequence at the top", "- content: src\n"),
		refused("empty key", v+": src\n"),
		refused("flow mapping spans lines", "version: 1\nplatforms: {web: {formFactors: [phone]},\ncontent: src}\n"),
		refused("flow sequence spans lines", "version: 1\nareas: [a,\ncontent: src]\n"),

		// Ruling D6: a quote on a top-level value, or a quote or flow
		// collection still open when an unindented line starts, is refused;
		// brackets in a comment are not counted.
		refused("quoted scalar runs onto top-level lines", "version: 1\nareas: \"x\ncontent: src\nlint: y\"\n"),
		refused("quote inside a flow sequence runs on", "version: 1\nareas: [\"]x\ncontent: src\nlint: y\"] #[\n"),
		refused("quoted top-level value", "version: 1\nareas: 'x'\ncontent: docs\n"),
		refused("indented quote runs onto a top-level line", "version: 1\nplatforms:\n  web:\n    roots: [\"a\ncontent: src\n  b\"]\n"),
		refused("top-level flow runs onto an indented line, counted per line", "version: 1\nareas: [a,\n  b]\ncontent: docs\n"),
		// Ruling D9: an anchor, alias or tag outside a comment, and a block
		// scalar, anywhere; and a quote only where a scalar starts.
		refused("tag before an indented quote", "version: 1\nplatforms:\n  web:\n    roots:\n      - !!str \"x\ncontent: src\n# y\"\n"),
		refused("anchor before an indented quote", "version: 1\nplatforms:\n  web:\n    roots:\n      - &a \"x\ncontent: src\n# y\"\n"),
		refused("tag before a quote in a flow", "version: 1\nplatforms:\n  web:\n    roots: [app, !!str \"]x\ncontent: src\n# y\"]\n"),
		refused("block scalar hides a quote", "version: 1\nplatforms:\n  web:\n    screenFiles: [a]\n    roots:\n      - |\n        \"\n      - [c, \"d\ncontent: src\n# e\"]\n"),
		refused("false quote in a plain scalar", "version: 1\nplatforms:\n  web:\n    roots:\n      - a - \"b\n      - \"d\ncontent: src\n# e\"\n"),
		refused("false quote then a flow quote", "version: 1\nplatforms:\n  web:\n    roots:\n      - a - \"b\n      - [c, \"d\ncontent: src\n# e\"]\n"),
		refused("alias in a flow", v+"areas: [*a]\n"),
		refused("anchor in a flow", v+"areas: [&a x]\n"),
		refused("folded block scalar", v+"areas:\n  - >-\n    text\n"),
		refused("literal block scalar with indicators", v+"areas:\n  - |2 # kept\n    text\n"),
		refused("indented flow runs onto a top-level line", "version: 1\nplatforms:\n  web:\n    roots: [a,\ncontent: src]\n"),
	}
}

func TestScanContentGolden(t *testing.T) {
	cases := scanCases()
	if *update {
		var buf bytes.Buffer
		enc := json.NewEncoder(&buf)
		enc.SetEscapeHTML(false)
		enc.SetIndent("", "  ")
		require.NoError(t, enc.Encode(cases))
		require.NoError(t, os.MkdirAll(filepath.Dir(filepath.FromSlash(goldenPath)), 0o750))
		require.NoError(t, os.WriteFile(filepath.FromSlash(goldenPath), buf.Bytes(), 0o600))
	}
	raw, err := os.ReadFile(filepath.FromSlash(goldenPath))
	require.NoError(t, err)
	var golden []scanCase
	require.NoError(t, json.Unmarshal(raw, &golden))
	require.Equal(t, cases, golden, "the golden is stale: go test ./internal/config -run ScanContent -update")
}

// TestScanContentAgreesWithParse: every file the desktop scanner accepts,
// Parse reads as exactly the value the scanner reads.
func TestScanContentAgreesWithParse(t *testing.T) {
	for _, c := range scanCases() {
		if !c.Accept {
			continue
		}
		t.Run(c.Name, func(t *testing.T) {
			cfg, ds := Parse([]byte(c.YAML))
			if c.CoreRejects {
				assert.NotEmpty(t, ds)
				return
			}
			require.Empty(t, ds)
			require.NotNil(t, cfg)
			assert.Equal(t, c.Value, cfg.Content)
		})
	}
}
