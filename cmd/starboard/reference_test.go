// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.yaml.in/yaml/v3"

	"github.com/c65llc/starboard/internal/cli"
	"github.com/c65llc/starboard/internal/flows"
	"github.com/c65llc/starboard/internal/lint"
	"github.com/c65llc/starboard/internal/registry"
	"github.com/c65llc/starboard/internal/schema"
)

// The reference pages are checked against the binary's own tables, so a
// command, flag, field, kind or Action input cannot be added or removed
// without the page that documents it.

var (
	docsDir      = filepath.Join("..", "..", "docs")
	referenceDir = filepath.Join(docsDir, "reference")
	kindsDir     = filepath.Join(referenceDir, "kinds")
)

func readDoc(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path) //nolint:gosec // G304: a documentation page in this repository
	require.NoError(t, err)
	return strings.ReplaceAll(string(data), "\r\n", "\n")
}

// sections splits a page at its "## " headings, keyed by heading text.
func sections(page string) map[string]string {
	out := map[string]string{}
	cur := ""
	for l := range strings.Lines(page) {
		if h, ok := strings.CutPrefix(l, "## "); ok {
			cur = strings.TrimSpace(h)
			out[cur] = ""
			continue
		}
		out[cur] += l
	}
	return out
}

// spelling is a flag as the usage writes it: "--dir D", "-o FILE", "--check".
func spelling(f cli.Flag) string {
	s := "--" + f.Name
	if len(f.Name) == 1 {
		s = "-" + f.Name
	}
	if f.Arg != "" {
		s += " " + f.Arg
	}
	return s
}

// flagRows are a section's table rows that document a flag.
func flagRows(section string) []string {
	var rows []string
	for l := range strings.Lines(section) {
		if strings.HasPrefix(l, "| `-") {
			rows = append(rows, strings.TrimSpace(l))
		}
	}
	return rows
}

// documented is one command as cli.md documents it.
type documented struct {
	name, synopsis string
	flags          []cli.Flag
}

// TestCLIReferenceComplete checks that docs/reference/cli.md has a section
// for every command in cli.Commands, with its usage line and a row for each
// flag, and none for a command or flag that no longer exists. Hidden
// commands are named in the page's internal note instead.
func TestCLIReferenceComplete(t *testing.T) {
	page := readDoc(t, filepath.Join(referenceDir, "cli.md"))
	secs := sections(page)

	var want []documented
	for _, c := range cli.Commands {
		switch {
		case c.Hidden:
			for _, s := range c.Subcommands {
				assert.Contains(t, secs["Internal commands"], "`starboard "+c.Name+" "+s.Name+"`",
					"the hidden command is named in the internal note")
			}
		case len(c.Subcommands) > 0:
			for _, s := range c.Subcommands {
				want = append(want, documented{c.Name + " " + s.Name, c.Name + " " + s.Synopsis(), s.Flags})
			}
		default:
			want = append(want, documented{c.Name, c.Synopsis(), c.Flags})
		}
	}

	headings := map[string]bool{}
	for h := range secs {
		if name, ok := strings.CutPrefix(h, "`starboard "); ok {
			headings[strings.TrimSuffix(name, "`")] = true
		}
	}
	for _, d := range want {
		t.Run(d.name, func(t *testing.T) {
			sec, ok := secs["`starboard "+d.name+"`"]
			require.True(t, ok, "cli.md has no section ## `starboard %s`", d.name)
			assert.Contains(t, sec, "starboard [--dir D] "+d.synopsis+"\n", "the usage line")
			var rows []string
			for _, f := range d.flags {
				row := "| `" + spelling(f) + "` |"
				assert.True(t, slices.ContainsFunc(flagRows(sec), func(r string) bool { return strings.HasPrefix(r, row) }),
					"no flag row starting %q", row)
				rows = append(rows, row)
			}
			assert.Len(t, flagRows(sec), len(rows), "flag rows for flags the command does not have: %q", flagRows(sec))
		})
		delete(headings, d.name)
	}
	assert.Empty(t, headings, "cli.md documents commands starboard does not have")

	global := secs["Global flags"]
	for _, f := range cli.GlobalFlags {
		assert.Contains(t, global, "| `"+spelling(f)+"` |")
	}
	assert.Len(t, flagRows(global), len(cli.GlobalFlags))
	for _, status := range []string{"| `0` |", "| `1` |", "| `2` |"} {
		assert.Contains(t, secs["Exit status"], status)
	}
}

// TestGitHubActionReference checks that docs/reference/github-action.md's
// Inputs table is action.yml's inputs, with their required flag and default.
func TestGitHubActionReference(t *testing.T) {
	var action struct {
		Inputs map[string]struct {
			Required bool    `yaml:"required"`
			Default  *string `yaml:"default"`
		} `yaml:"inputs"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(readDoc(t, filepath.Join("..", "..", "action.yml"))), &action))
	require.NotEmpty(t, action.Inputs)

	inputs := sections(readDoc(t, filepath.Join(referenceDir, "github-action.md")))["Inputs"]
	rows := map[string][]string{}
	for l := range strings.Lines(inputs) {
		if !strings.HasPrefix(l, "| `") {
			continue
		}
		cells := strings.Split(strings.Trim(strings.TrimSpace(l), "|"), "|")
		for i := range cells {
			cells[i] = strings.TrimSpace(cells[i])
		}
		rows[strings.Trim(cells[0], "`")] = cells
	}
	for name, in := range action.Inputs {
		cells, ok := rows[name]
		if !assert.True(t, ok, "no Inputs row for %s", name) {
			continue
		}
		require.GreaterOrEqual(t, len(cells), 4, "| `name` | required | default | description |")
		assert.Equal(t, map[bool]string{true: "yes", false: "no"}[in.Required], cells[1], "%s required", name)
		wantDefault := "none"
		if in.Default != nil {
			wantDefault = "`" + *in.Default + "`"
		}
		assert.Equal(t, wantDefault, cells[2], "%s default", name)
		delete(rows, name)
	}
	assert.Empty(t, rows, "rows for inputs action.yml does not have")
}

// TestSchemaReference checks that docs/reference/schemas.md gives each
// embedded schema's $id, the URL the site serves it at, and that both
// reference pages mention every field the schemas define.
func TestSchemaReference(t *testing.T) {
	page := readDoc(t, filepath.Join(referenceDir, "schemas.md"))
	fieldPages := map[string]string{"config": "starboard-yaml.md", "screens": "screens-yaml.md"}
	for _, name := range schema.Names {
		data, ok := schema.Get(name)
		require.True(t, ok)
		var s map[string]any
		require.NoError(t, json.Unmarshal(data, &s))
		id, _ := s["$id"].(string)
		assert.Equal(t, "https://starboard.c65llc.com/schema/v1/"+name+".json", id)
		assert.Contains(t, page, id)
		assert.Contains(t, page, "starboard schema "+name)

		fields := readDoc(t, filepath.Join(referenceDir, fieldPages[name]))
		for _, key := range propertyNames(s) {
			assert.Contains(t, fields, "`"+key+"`", "%s does not document the field %s", fieldPages[name], key)
		}
	}
}

// propertyNames is every key of every "properties" object in a schema.
func propertyNames(v any) []string {
	var out []string
	switch v := v.(type) {
	case map[string]any:
		if props, ok := v["properties"].(map[string]any); ok {
			for k := range props {
				out = append(out, k)
			}
		}
		for _, child := range v {
			out = append(out, propertyNames(child)...)
		}
	case []any:
		for _, child := range v {
			out = append(out, propertyNames(child)...)
		}
	}
	slices.Sort(out)
	return slices.Compact(out)
}

// TestFlowReference checks that docs/reference/flow-files.md documents every
// front matter key.
func TestFlowReference(t *testing.T) {
	page := readDoc(t, filepath.Join(referenceDir, "flow-files.md"))
	for _, k := range flows.Keys {
		assert.Contains(t, page, "| `"+k+"` |")
	}
}

// TestKindReference checks that there is one fixture and one rendered
// wireframe per region kind in docs/reference/kinds, and that
// docs/reference/screens-yaml.md shows each kind under its own heading
// with the fixture's YAML, verbatim, and its wireframe. make docs-kinds
// renders the wireframes; make docs-kinds-check keeps them current.
func TestKindReference(t *testing.T) {
	page := readDoc(t, filepath.Join(referenceDir, "screens-yaml.md"))
	fixtures, err := filepath.Glob(filepath.Join(kindsDir, "*.yaml"))
	require.NoError(t, err)
	var got []string
	for _, f := range fixtures {
		got = append(got, strings.TrimSuffix(filepath.Base(f), ".yaml"))
	}
	var kinds []string
	for k := range registry.Kinds {
		kinds = append(kinds, k)
	}
	slices.Sort(kinds)
	assert.Equal(t, kinds, got, "one fixture per region kind")

	for _, kind := range kinds {
		t.Run(kind, func(t *testing.T) {
			fixture := readDoc(t, filepath.Join(kindsDir, kind+".yaml"))
			_, err := os.Stat(filepath.Join(kindsDir, kind+".svg"))
			require.NoError(t, err, "run make docs-kinds")
			heading := regexp.MustCompile("(?m)^### `" + regexp.QuoteMeta(kind) + "`$")
			loc := heading.FindStringIndex(page)
			require.NotNil(t, loc, "no ### `%s` heading", kind)
			sec := page[loc[1]:]
			if next := strings.Index(sec, "\n#"); next >= 0 {
				sec = sec[:next]
			}
			assert.Contains(t, sec, "```yaml\n"+fixture+"```\n", "the fixture, verbatim")
			assert.Contains(t, sec, fmt.Sprintf("](./kinds/%s.svg)", kind), "the rendered wireframe")
		})
	}
}

// TestRulesListed checks that docs/reference/json-output.md links every
// rule's page.
func TestRulesListed(t *testing.T) {
	page := readDoc(t, filepath.Join(referenceDir, "json-output.md"))
	for _, r := range lint.Rules() {
		assert.Contains(t, page, "["+r.ID+"](../../rules/"+r.ID+"/)")
	}
}
