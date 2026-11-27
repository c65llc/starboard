// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package project

import (
	"io"
	"io/fs"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var _ WriteFS = MemFS{}

func sample() MemFS {
	return MemFS{
		"starboard.yaml":           []byte(minimalConfig),
		"docs/flows/screens.yaml":  []byte("screens: {}\n"),
		"docs/flows/flows/a.md":    []byte("---\nid: a\n---\n"),
		"docs/flows/flows/b.md":    []byte("---\nid: b\n---\n"),
		"docs/flows/zz/deep/x.txt": []byte("x"),
	}
}

func TestMemFSConformsToFS(t *testing.T) {
	require.NoError(t, fstest.TestFS(sample(),
		"starboard.yaml", "docs/flows/screens.yaml", "docs/flows/flows/a.md",
		"docs/flows/flows/b.md", "docs/flows/zz/deep/x.txt"))
	require.NoError(t, fstest.TestFS(MemFS{}))
}

func TestMemFSReadDirAndStat(t *testing.T) {
	m := sample()
	es, err := fs.ReadDir(m, "docs/flows")
	require.NoError(t, err)
	var names []string
	for _, e := range es {
		names = append(names, e.Name())
	}
	assert.Equal(t, []string{"flows", "screens.yaml", "zz"}, names)
	assert.True(t, es[0].IsDir())
	assert.Equal(t, fs.ModeDir, es[0].Type())

	fi, err := fs.Stat(m, "docs/flows/screens.yaml")
	require.NoError(t, err)
	assert.Equal(t, "screens.yaml", fi.Name())
	assert.Equal(t, int64(12), fi.Size())
	assert.False(t, fi.IsDir())
	assert.True(t, fi.ModTime().IsZero())
	assert.Nil(t, fi.Sys())

	_, err = fs.Stat(m, "docs/missing")
	require.ErrorIs(t, err, fs.ErrNotExist)
	_, err = m.Open("../x")
	require.ErrorIs(t, err, fs.ErrInvalid)
}

func TestMemFSDirReadAndPaging(t *testing.T) {
	f, err := sample().Open("docs/flows/flows")
	require.NoError(t, err)
	defer func() { require.NoError(t, f.Close()) }()
	_, err = f.Read(make([]byte, 1))
	require.Error(t, err)
	d := f.(fs.ReadDirFile)
	es, err := d.ReadDir(1)
	require.NoError(t, err)
	require.Len(t, es, 1)
	assert.Equal(t, "a.md", es[0].Name())
	es, err = d.ReadDir(5)
	require.NoError(t, err)
	require.Len(t, es, 1)
	_, err = d.ReadDir(1)
	require.ErrorIs(t, err, io.EOF)
	es, err = d.ReadDir(-1)
	require.NoError(t, err)
	assert.Empty(t, es)
}

func TestMemFSWriteFile(t *testing.T) {
	m := MemFS{}
	data := []byte("hello")
	require.NoError(t, m.WriteFile("a/b/c.txt", data))
	data[0] = 'j' // WriteFile keeps its own copy
	got, err := fs.ReadFile(m, "a/b/c.txt")
	require.NoError(t, err)
	assert.Equal(t, "hello", string(got))

	require.NoError(t, m.WriteFile("a/b/c.txt", []byte("again")))
	assert.Equal(t, "again", string(m["a/b/c.txt"]))
}

func TestMemFSWriteFileRefuses(t *testing.T) {
	m := sample()
	for _, name := range []string{"../x", "/abs", "a/../../x", ".", `a\b`, "docs/flows", "starboard.yaml/x"} {
		t.Run(name, func(t *testing.T) {
			require.Error(t, m.WriteFile(name, []byte("x")))
		})
	}
	assert.Equal(t, sample(), m)
}

func TestMemFSRemove(t *testing.T) {
	m := sample()
	require.NoError(t, m.Remove("docs/flows/flows/a.md"))
	assert.NotContains(t, m, "docs/flows/flows/a.md")
	require.NoError(t, m.Remove("docs/flows/flows/a.md"), "a missing file is not an error")
	for _, name := range []string{"../x", "/abs", "a/../../x", `a\b`, "docs/flows", "."} {
		t.Run(name, func(t *testing.T) {
			require.Error(t, m.Remove(name))
		})
	}
	assert.Contains(t, m, "docs/flows/screens.yaml")
}

// TestMemFSRemoveEmptyDir: an empty directory cannot exist in a MemFS, so
// there is never one to remove; a directory with files and a file are left.
func TestMemFSRemoveEmptyDir(t *testing.T) {
	m := sample()
	for _, name := range []string{"docs/flows", "docs/flows/screens.yaml", "missing"} {
		require.NoError(t, m.RemoveEmptyDir(name), name)
	}
	assert.Equal(t, sample(), m)
	for _, name := range []string{"../x", "/abs", `a\b`, "."} {
		require.Error(t, m.RemoveEmptyDir(name), name)
	}
}

func TestLoadFromMemFS(t *testing.T) {
	p, ds, err := Load(sample())
	require.NoError(t, err)
	assert.Equal(t, []string{"docs/flows/flows/a.md", "docs/flows/flows/b.md"}, p.FlowFiles)
	for _, d := range ds {
		assert.Contains(t, d.File, "docs/flows/flows/")
	}
}
