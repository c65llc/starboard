// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package osfs

import (
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/c65llc/starboard/internal/project"
)

var _ project.WriteFS = (*Dir)(nil)

// sandbox returns a root directory and a sibling directory outside it.
func sandbox(t *testing.T) (root, outside string) {
	t.Helper()
	base := t.TempDir()
	root = filepath.Join(base, "root")
	outside = filepath.Join(base, "outside")
	require.NoError(t, os.Mkdir(root, 0o750))
	require.NoError(t, os.Mkdir(outside, 0o750))
	return root, outside
}

// open opens root as a Dir closed at the end of the test.
func open(t *testing.T, root string) *Dir {
	t.Helper()
	d, err := Open(root)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, d.Close()) })
	return d
}

// symlink makes newname a link to oldname, skipping the test on Windows when
// the account lacks the privilege to create links.
func symlink(t *testing.T, oldname, newname string) {
	t.Helper()
	if err := os.Symlink(oldname, newname); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("creating symlinks needs a privilege on Windows: %v", err)
		}
		t.Fatal(err)
	}
}

func entries(t *testing.T, dir string) []string {
	t.Helper()
	var out []string
	require.NoError(t, filepath.WalkDir(dir, func(p string, _ fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, p)
		out = append(out, filepath.ToSlash(rel))
		return err
	}))
	return out
}

var escapes = []string{"../x", "/abs", "a/../../x"}

func TestOpenMissingRoot(t *testing.T) {
	_, err := Open(filepath.Join(t.TempDir(), "nope"))
	require.ErrorIs(t, err, fs.ErrNotExist)
}

func TestDirReads(t *testing.T) {
	root, _ := sandbox(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "starboard.yaml"), []byte("version: 1\n"), 0o600))
	got, err := fs.ReadFile(open(t, root), "starboard.yaml")
	require.NoError(t, err)
	assert.Equal(t, "version: 1\n", string(got))
}

func TestOpenRefusesSymlinkOutside(t *testing.T) {
	root, outside := sandbox(t)
	require.NoError(t, os.WriteFile(filepath.Join(outside, "secret"), []byte("secret"), 0o600))
	symlink(t, filepath.Join(outside, "secret"), filepath.Join(root, "x.md"))
	symlink(t, outside, filepath.Join(root, "docs"))
	d := open(t, root)
	_, err := fs.ReadFile(d, "x.md")
	require.Error(t, err, "a symlinked file pointing outside the root is not read")
	_, err = fs.ReadFile(d, "docs/secret")
	require.Error(t, err, "a symlinked directory pointing outside the root is not read")
	_, err = fs.ReadDir(d, "docs")
	require.Error(t, err, "a symlinked directory pointing outside the root is not listed")
	for _, name := range escapes {
		_, err := d.Open(name)
		require.ErrorIs(t, err, fs.ErrInvalid, name)
	}
}

func TestLoadThroughDirRefusesSymlinkOutside(t *testing.T) {
	root, outside := sandbox(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "starboard.yaml"),
		[]byte("version: 1\nplatforms:\n  ios:\n    formFactors: [phone]\n"), 0o600))
	require.NoError(t, os.MkdirAll(filepath.Join(outside, "flows"), 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(outside, "screens.yaml"), []byte("screens: {}\n"), 0o600))
	require.NoError(t, os.MkdirAll(filepath.Join(root, "docs"), 0o750))
	symlink(t, outside, filepath.Join(root, "docs", "flows"))
	_, _, err := project.Load(open(t, root))
	require.Error(t, err, "Load must not read a content root that links outside the project")
}

func TestWriteFileRefusesEscape(t *testing.T) {
	root, outside := sandbox(t)
	d := open(t, root)
	for _, name := range append(escapes, ".", `a\b`, "") {
		t.Run(name, func(t *testing.T) {
			require.ErrorIs(t, d.WriteFile(name, []byte("x")), fs.ErrInvalid)
		})
	}
	assert.Equal(t, []string{"."}, entries(t, root), "nothing written inside")
	assert.Equal(t, []string{"."}, entries(t, outside), "nothing written outside")
	_, err := os.Stat(filepath.Join(filepath.Dir(root), "x"))
	require.ErrorIs(t, err, fs.ErrNotExist)
}

func TestWriteFileRefusesWindowsColon(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("a colon is an ordinary file name character outside Windows")
	}
	root, _ := sandbox(t)
	d := open(t, root)
	require.ErrorIs(t, d.WriteFile("C:x", []byte("x")), fs.ErrInvalid)
	require.ErrorIs(t, d.WriteFile("a.md:stream", []byte("x")), fs.ErrInvalid)
}

func TestWriteFileRefusesSymlinkedParent(t *testing.T) {
	root, outside := sandbox(t)
	symlink(t, outside, filepath.Join(root, "link"))
	d := open(t, root)
	for _, name := range []string{"link/x", "link/new/deeper/x"} {
		t.Run(name, func(t *testing.T) {
			require.Error(t, d.WriteFile(name, []byte("x")))
		})
	}
	assert.Equal(t, []string{"."}, entries(t, outside))
}

func TestWriteFileRefusesDanglingSymlinkedParent(t *testing.T) {
	root, outside := sandbox(t)
	missing := filepath.Join(outside, "missing")
	symlink(t, missing, filepath.Join(root, "link"))
	d := open(t, root)
	require.Error(t, d.WriteFile("link/x", []byte("x")))
	require.Error(t, d.WriteFile("link/new/x", []byte("x")))
	assert.Equal(t, []string{"."}, entries(t, outside), "nothing created outside")
	_, err := os.Lstat(missing)
	require.ErrorIs(t, err, fs.ErrNotExist)
}

func TestWriteFileReplacesSymlinkToOutside(t *testing.T) {
	root, outside := sandbox(t)
	secret := filepath.Join(outside, "secret")
	require.NoError(t, os.WriteFile(secret, []byte("keep"), 0o600))
	symlink(t, secret, filepath.Join(root, "x.md"))
	d := open(t, root)
	require.NoError(t, d.WriteFile("x.md", []byte("new")))

	fi, err := os.Lstat(filepath.Join(root, "x.md"))
	require.NoError(t, err)
	assert.True(t, fi.Mode().IsRegular(), "the link is replaced by a regular file")
	got, err := fs.ReadFile(d, "x.md")
	require.NoError(t, err)
	assert.Equal(t, "new", string(got))
	got, err = os.ReadFile(secret) //nolint:gosec // G304: a path the test built
	require.NoError(t, err)
	assert.Equal(t, "keep", string(got), "the outside file is untouched")
}

func TestWriteFileThroughInnerSymlink(t *testing.T) {
	root, _ := sandbox(t)
	require.NoError(t, os.Mkdir(filepath.Join(root, "real"), 0o750))
	symlink(t, "real", filepath.Join(root, "alias"))
	symlink(t, filepath.Join(root, "real"), filepath.Join(root, "absolute"))
	d := open(t, root)
	require.NoError(t, d.WriteFile("alias/x.md", []byte("ok")), "a relative link inside the root is followed")
	got, err := fs.ReadFile(d, "real/x.md")
	require.NoError(t, err)
	assert.Equal(t, "ok", string(got))
	require.Error(t, d.WriteFile("absolute/y.md", []byte("x")), "os.Root refuses absolute links, even to inside")
}

func TestWriteFileAtomic(t *testing.T) {
	root, _ := sandbox(t)
	d := open(t, root)
	require.NoError(t, d.WriteFile("docs/flows/screens.yaml", []byte("one\n")))
	require.NoError(t, d.WriteFile("docs/flows/screens.yaml", []byte("two\n")))
	require.NoError(t, d.WriteFile("top.md", []byte("top\n")))

	got, err := fs.ReadFile(d, "docs/flows/screens.yaml")
	require.NoError(t, err)
	assert.Equal(t, "two\n", string(got))
	// The temp file was renamed into place: no strays are left beside it.
	assert.Equal(t, []string{".", "docs", "docs/flows", "docs/flows/screens.yaml", "top.md"}, entries(t, root))
	if runtime.GOOS != "windows" {
		fi, err := os.Stat(filepath.Join(root, "docs", "flows", "screens.yaml"))
		require.NoError(t, err)
		assert.Equal(t, fs.FileMode(0o644), fi.Mode().Perm())
	}
}

func TestWriteFileOntoDirectoryFails(t *testing.T) {
	root, _ := sandbox(t)
	require.NoError(t, os.MkdirAll(filepath.Join(root, "docs", "flows"), 0o750))
	d := open(t, root)
	require.Error(t, d.WriteFile("docs/flows", []byte("x")))
	require.NoError(t, d.WriteFile("docs/flows/x/y", nil))
	require.NoError(t, os.WriteFile(filepath.Join(root, "file"), nil, 0o600))
	require.Error(t, d.WriteFile("file/x", []byte("x")), "a parent that is a file")
	require.Error(t, d.WriteFile("file/x/y", []byte("x")), "an ancestor that is a file")
	require.NoError(t, d.Remove("file/x"), "under a file nothing exists to remove, on every OS")
	require.NoError(t, d.Remove("file/x/y"), "under a file nothing exists to remove, on every OS")
	assert.Equal(t, []string{".", "docs", "docs/flows", "docs/flows/x", "docs/flows/x/y", "file"}, entries(t, root))
}

func TestWriteFileReadOnlyDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows ignores POSIX directory permission bits")
	}
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	root, _ := sandbox(t)
	ro := filepath.Join(root, "ro")
	require.NoError(t, os.Mkdir(ro, 0o500))
	d := open(t, root)
	require.ErrorIs(t, d.WriteFile("ro/x", []byte("x")), fs.ErrPermission, "the temp file cannot be created")
	require.ErrorIs(t, d.WriteFile("ro/new/x", []byte("x")), fs.ErrPermission, "the parent cannot be created")
	assert.Equal(t, []string{".", "ro"}, entries(t, root))
}

func TestRemoveRefusesEscape(t *testing.T) {
	root, outside := sandbox(t)
	sentinel := filepath.Join(outside, "x")
	require.NoError(t, os.WriteFile(sentinel, []byte("keep"), 0o600))
	symlink(t, outside, filepath.Join(root, "link"))
	d := open(t, root)
	for _, name := range append(escapes, "../outside/x", ".", `a\b`) {
		t.Run(name, func(t *testing.T) {
			require.ErrorIs(t, d.Remove(name), fs.ErrInvalid)
		})
	}
	require.Error(t, d.Remove("link/x"))
	_, err := os.Stat(sentinel)
	require.NoError(t, err, "the sentinel outside the root still exists")
}

func TestRemove(t *testing.T) {
	root, _ := sandbox(t)
	d := open(t, root)
	require.NoError(t, d.WriteFile("docs/a.md", []byte("x")))
	require.NoError(t, d.Remove("docs/a.md"))
	require.NoError(t, d.Remove("docs/a.md"), "a missing file is not an error")
	require.NoError(t, d.Remove("missing/dir/a.md"), "a missing parent is not an error")
	require.Error(t, d.Remove("docs"), "never a directory")
	assert.Equal(t, []string{".", "docs"}, entries(t, root))

	// A symlink is removed as itself, not followed.
	symlink(t, "docs", filepath.Join(root, "ln"))
	require.NoError(t, d.Remove("ln"))
	assert.Equal(t, []string{".", "docs"}, entries(t, root))
}

func TestFindRoot(t *testing.T) {
	base := t.TempDir()
	proj := filepath.Join(base, "proj")
	deep := filepath.Join(proj, "a", "b")
	require.NoError(t, os.MkdirAll(deep, 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(proj, "starboard.yaml"), []byte("version: 1\n"), 0o600))
	// A directory named starboard.yaml does not count.
	require.NoError(t, os.Mkdir(filepath.Join(proj, "a", "starboard.yaml"), 0o750))

	got, err := FindRoot(deep)
	require.NoError(t, err)
	assert.Equal(t, proj, got)

	got, err = FindRoot(proj)
	require.NoError(t, err)
	assert.Equal(t, proj, got)

	require.NoError(t, os.Mkdir(filepath.Join(base, "elsewhere"), 0o750))
	_, err = FindRoot(filepath.Join(base, "elsewhere"))
	require.ErrorIs(t, err, project.ErrNoProject)

	t.Chdir(deep)
	got, err = FindRoot(".")
	require.NoError(t, err)
	gotReal, err := filepath.EvalSymlinks(got)
	require.NoError(t, err)
	projReal, err := filepath.EvalSymlinks(proj)
	require.NoError(t, err)
	assert.Equal(t, projReal, gotReal)
}

func TestFindRootStatError(t *testing.T) {
	base := t.TempDir()
	file := filepath.Join(base, "file")
	require.NoError(t, os.WriteFile(file, nil, 0o600))
	_, err := FindRoot(file)
	require.EqualError(t, err, file+" is not a directory")
	require.NotErrorIs(t, err, project.ErrNoProject)

	_, err = FindRoot(filepath.Join(base, "missing"))
	require.ErrorIs(t, err, fs.ErrNotExist, "a missing start is an error, not ErrNoProject")
	require.NotErrorIs(t, err, project.ErrNoProject)
}

// TestWriteFileAt: the path is the caller's own, relative or absolute, and
// the write is atomic: a temp file beside it, renamed into place.
func TestWriteFileAt(t *testing.T) {
	root, outside := sandbox(t)
	abs := filepath.Join(outside, "a.svg")
	require.NoError(t, WriteFileAt(abs, []byte("one\n")))
	require.NoError(t, WriteFileAt(abs, []byte("two\n")))
	got, err := os.ReadFile(abs) //nolint:gosec // G304: a test file
	require.NoError(t, err)
	assert.Equal(t, "two\n", string(got))
	assert.Equal(t, []string{".", "a.svg"}, entries(t, outside), "no temp file is left")
	if runtime.GOOS != "windows" {
		fi, err := os.Stat(abs)
		require.NoError(t, err)
		assert.Equal(t, fs.FileMode(0o644), fi.Mode().Perm())
	}

	t.Chdir(root)
	require.NoError(t, WriteFileAt("b.svg", []byte("b\n")), "relative to the working directory")
	assert.FileExists(t, filepath.Join(root, "b.svg"))

	require.Error(t, WriteFileAt(filepath.Join(root, "missing", "c.svg"), nil), "parents are not created")
	require.NoError(t, os.Mkdir(filepath.Join(root, "dir"), 0o750))
	require.Error(t, WriteFileAt(filepath.Join(root, "dir"), nil), "a directory is not replaced")
	assert.Equal(t, []string{".", "b.svg", "dir"}, entries(t, root), "a failed write leaves no temp file")
}

func TestWriteFileAtReadOnlyDirectory(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("directory permissions are not enforced here")
	}
	root, _ := sandbox(t)
	ro := filepath.Join(root, "ro")
	require.NoError(t, os.Mkdir(ro, 0o500)) //nolint:gosec // G301: a read-only directory
	require.ErrorIs(t, WriteFileAt(filepath.Join(ro, "x.svg"), []byte("x")), fs.ErrPermission)
}
