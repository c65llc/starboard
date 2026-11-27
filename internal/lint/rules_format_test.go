// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package lint

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/diag"
)

func TestRule_not_formatted(t *testing.T) {
	r := rule(t, "not-formatted")
	assert.Equal(t, diag.Error, r.Default)

	assert.Empty(t, r.Run(mkProject(t, base()), nil), "the base project is canonical")

	p := mkProject(t, with(map[string]string{
		cfgFile:  baseConfig[len("version: 1\n"):] + "version: 1\n",
		flowFile: baseFlow + "\n\n\ntrailing   \n",
	}))
	ds := r.Run(p, nil)
	require.Len(t, ds, 2)
	for i, file := range []string{flowFile, cfgFile} {
		assert.Equal(t, "not-formatted", ds[i].Rule)
		assert.Equal(t, file, ds[i].File)
		assert.Equal(t, file+" is not in canonical form", ds[i].Message)
		assert.Equal(t, &diag.Fix{Description: "run starboard fmt"}, ds[i].Fix)
	}
}

func TestRule_not_formatted_skipsUnparseable(t *testing.T) {
	p := mkProject(t, base())
	p.Sources[screensYML] = []byte("screens: [\n")
	assert.Empty(t, rule(t, "not-formatted").Run(p, nil))
}

func TestRule_not_formatted_cannotFormat(t *testing.T) {
	p := mkProject(t, base())
	p.Sources[screensYML] = []byte("[[[]#\n]#\n]\n") // parses, but formatting would drop a comment
	ds := rule(t, "not-formatted").Run(p, nil)
	require.Len(t, ds, 1)
	assert.Equal(t, screensYML, ds[0].File)
	assert.Equal(t, "cannot be formatted: formatting would drop a comment: #", ds[0].Message)
	assert.Nil(t, ds[0].Fix, "fmt cannot fix it")
}

func TestRule_not_formatted_crlf(t *testing.T) {
	p := mkProject(t, base())
	for name, src := range p.Sources {
		p.Sources[name] = []byte(strings.ReplaceAll(string(src), "\n", "\r\n"))
	}
	assert.Empty(t, rule(t, "not-formatted").Run(p, nil), "CRLF line endings alone are canonical")
}
