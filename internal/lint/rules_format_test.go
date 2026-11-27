// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package lint

import (
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
