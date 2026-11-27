// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package lint

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/format"
	"github.com/c65llc/starboard/internal/generate"
	"github.com/c65llc/starboard/internal/project"
)

const obsolete = "docs/flows/generated/wireframes/old.screen.phone.svg"

// apply writes and removes ch in m.
func apply(m project.MemFS, ch Changes) {
	for name, data := range ch.Write {
		m[name] = data
	}
	for _, name := range ch.Remove {
		delete(m, name)
	}
}

func reload(t *testing.T, m project.MemFS) *project.Project {
	t.Helper()
	p, ds, err := project.Load(m)
	require.NoError(t, err)
	require.Empty(t, ds)
	return p
}

func TestFixRemovesObsoleteWireframe(t *testing.T) {
	m, _ := fresh(t)
	m[obsolete] = []byte("<svg/>")
	p := reload(t, m)

	ch := Fix(p)
	assert.Empty(t, ch.Write)
	assert.Equal(t, []string{obsolete}, ch.Remove)

	apply(m, ch)
	p = reload(t, m)
	assert.Empty(t, rule(t, "generated-stale").Run(p, &Context{Generated: generate.All(p)}))
	assert.Equal(t, Changes{Write: map[string][]byte{}}, Fix(p), "a fixed project needs nothing")
}

func TestFixNeverRemovesOutsideGenerated(t *testing.T) {
	m, _ := fresh(t)
	m["docs/flows/stray.svg"] = []byte("<svg/>")
	m["docs/flows/generatedx/old.svg"] = []byte("<svg/>")
	ch := Fix(reload(t, m))
	assert.Empty(t, ch.Remove)
	assert.Empty(t, ch.Write)
}

func TestFixWritesFormatAndGenerated(t *testing.T) {
	m, gen := fresh(t)
	m[appMap] = []byte("stale\n")
	delete(m, screensMD)
	m[cfgFile] = []byte(baseConfig[len("version: 1\n"):] + "version: 1\n")
	p := reload(t, m)
	want := format.Project(p)
	require.Contains(t, want, cfgFile, "the fixture must be unformatted")

	ch := Fix(p)
	assert.Empty(t, ch.Remove)
	assert.Equal(t, want[cfgFile], ch.Write[cfgFile])
	assert.Equal(t, gen[appMap], ch.Write[appMap])
	assert.Equal(t, gen[screensMD], ch.Write[screensMD])
	assert.Len(t, ch.Write, 3)
}

func TestFixReadError(t *testing.T) {
	m, _ := fresh(t)
	p := reload(t, m)
	p.FS = failOpen{MemFS: m, fail: "docs/flows/generated"}
	ch := Fix(p)
	assert.Empty(t, ch.Write, "generation is skipped when the generated files cannot be read")
	assert.Empty(t, ch.Remove)
}
