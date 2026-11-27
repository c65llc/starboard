// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package schema

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.yaml.in/yaml/v3"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/flows"
)

// configurationBlocks returns the ```yaml blocks under a page's
// "## Configuration" heading, up to the next ## heading. Headings inside
// fenced blocks are not headings.
func configurationBlocks(page string) []string {
	var blocks []string
	var cur strings.Builder
	in, fence, lang := false, "", ""
	for _, l := range strings.Split(strings.ReplaceAll(page, "\r\n", "\n"), "\n") {
		if fence != "" {
			if flows.IsFenceClose(l, fence) {
				if in && lang == "yaml" {
					blocks = append(blocks, cur.String())
				}
				fence = ""
				continue
			}
			cur.WriteString(l + "\n")
			continue
		}
		if f, info, ok := flows.OpenFence(l); ok {
			fence, lang = f, ""
			if fs := strings.Fields(info); len(fs) > 0 {
				lang = fs[0]
			}
			cur.Reset()
			continue
		}
		if h, ok := strings.CutPrefix(l, "## "); ok {
			in = h == "Configuration"
		}
	}
	return blocks
}

// checkConfiguration returns what is wrong with a quality rule's
// Configuration blocks: each, under `version: 1`, must be a starboard.yaml
// that config.schema.json accepts and the parser reads without a finding;
// one must set the rule's severity under lint.rules, and, for a rule with a
// limit, one must set it under lint.limits.
func checkConfiguration(sch *jsonschema.Schema, id string, hasLimit bool, blocks []string) []string {
	var problems []string
	if len(blocks) == 0 {
		return []string{"the Configuration section has no ```yaml block"}
	}
	setsRule, setsLimit := false, false
	for i, b := range blocks {
		src := "version: 1\n" + b
		var v any
		if err := yaml.Unmarshal([]byte(src), &v); err != nil {
			problems = append(problems, fmt.Sprintf("block %d is not YAML: %v", i+1, err))
			continue
		}
		if err := sch.Validate(v); err != nil {
			problems = append(problems, fmt.Sprintf("block %d breaks config.schema.json: %v", i+1, err))
		}
		if _, ds := config.Parse([]byte(src)); len(ds) > 0 {
			problems = append(problems, fmt.Sprintf("block %d: starboard reads it with findings: %v", i+1, ds))
		}
		var doc struct {
			Lint struct {
				Rules  map[string]any `yaml:"rules"`
				Limits map[string]any `yaml:"limits"`
			} `yaml:"lint"`
		}
		_ = yaml.Unmarshal([]byte(src), &doc)
		_, r := doc.Lint.Rules[id]
		_, l := doc.Lint.Limits[id]
		setsRule, setsLimit = setsRule || r, setsLimit || l
	}
	if !setsRule {
		problems = append(problems, "no block sets lint.rules."+id)
	}
	if hasLimit && !setsLimit {
		problems = append(problems, "no block sets lint.limits."+id)
	}
	if !hasLimit && setsLimit {
		problems = append(problems, "a block sets lint.limits."+id+", which the schema has no limit for")
	}
	return problems
}

func TestCheckConfiguration(t *testing.T) {
	sch := compile(t, "config")
	for name, tc := range map[string]struct {
		page     string
		hasLimit bool
		want     []string
	}{
		"good":            {"## Configuration\n\n```yaml\nlint:\n  rules:\n    orphan-screen: off\n```\n", false, nil},
		"good with limit": {"## Configuration\n```yaml\nlint:\n  rules:\n    label-too-long: off\n```\n```yaml\nlint:\n  limits:\n    label-too-long: 60\n```\n", true, nil},
		"no block": {"## Configuration\n\nText.\n\n## Example\n```yaml\nlint: {}\n```\n", false,
			[]string{"the Configuration section has no ```yaml block"}},
		"bad severity": {"## Configuration\n```yaml\nlint:\n  rules:\n    orphan-screen: loud\n```\n", false,
			[]string{"block 1 breaks config.schema.json", "block 1: starboard reads it with findings"}},
		"other rule": {"## Configuration\n```yaml\nlint:\n  rules:\n    missing-purpose: off\n```\n", false,
			[]string{"no block sets lint.rules.orphan-screen"}},
		"missing limit": {"## Configuration\n```yaml\nlint:\n  rules:\n    label-too-long: off\n```\n", true,
			[]string{"no block sets lint.limits.label-too-long"}},
		"limit nobody has": {"## Configuration\n```yaml\nlint:\n  rules:\n    orphan-screen: off\n  limits:\n    orphan-screen: 3\n```\n", false,
			[]string{"block 1 breaks config.schema.json", "block 1: starboard reads it with findings", "a block sets lint.limits.orphan-screen"}},
		"untagged block": {"## Configuration\n```\nlint: {}\n```\n", false,
			[]string{"the Configuration section has no ```yaml block"}},
		"heading in a fence": {"## Example\n````markdown\n## Configuration\n```yaml\nlint: {}\n```\n````\n", false,
			[]string{"the Configuration section has no ```yaml block"}},
	} {
		t.Run(name, func(t *testing.T) {
			id := "orphan-screen"
			if tc.hasLimit {
				id = "label-too-long"
			}
			got := checkConfiguration(sch, id, tc.hasLimit, configurationBlocks(tc.page))
			require.Len(t, got, len(tc.want), "%q", got)
			for i, w := range tc.want {
				assert.True(t, strings.HasPrefix(got[i], w), "problem %d: %q does not start with %q", i, got[i], w)
			}
		})
	}
}

// TestRulePagesConfiguration: every quality rule's page (docs/rules/<id>.md,
// published at /rules/<id>/) shows configuration that config.schema.json
// accepts, for that rule, and its limit when the schema gives it one.
func TestRulePagesConfiguration(t *testing.T) {
	sch := compile(t, "config")
	var doc struct {
		Defs struct {
			QualityRule struct {
				Enum []string `json:"enum"`
			} `json:"qualityRule"`
			Limits struct {
				Properties map[string]any `json:"properties"`
			} `json:"limits"`
		} `json:"$defs"`
	}
	data, _ := Get("config")
	require.NoError(t, json.Unmarshal(data, &doc))
	require.NotEmpty(t, doc.Defs.QualityRule.Enum)
	for id := range doc.Defs.Limits.Properties {
		assert.True(t, slices.Contains(doc.Defs.QualityRule.Enum, id), "limit %s is not a quality rule", id)
	}
	for _, id := range doc.Defs.QualityRule.Enum {
		t.Run(id, func(t *testing.T) {
			page, err := os.ReadFile(filepath.Join("..", "..", "docs", "rules", id+".md")) //nolint:gosec // G304: a docs page named by the schema
			require.NoError(t, err)
			_, hasLimit := doc.Defs.Limits.Properties[id]
			assert.Empty(t, checkConfiguration(sch, id, hasLimit, configurationBlocks(string(page))))
		})
	}
}
