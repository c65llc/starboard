// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package osfs is the one package under internal/ that touches the operating
// system. Dir is a project.WriteFS over a directory, built on os.Root, so the
// operating system itself keeps every read, write and removal inside the
// directory: a symbolic link that leads outside it, or any absolute link, is
// refused, never followed. FindRoot locates a project from a working directory.
// WriteFileAt writes a file the person named on the command line, and is not
// confined to anything.
package osfs

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/project"
)

// Dir is an open directory tree. Create one with Open and Close it when done.
type Dir struct {
	root *os.Root
	fsys fs.FS
}

// Open opens the directory at root.
func Open(root string) (*Dir, error) {
	r, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	return &Dir{root: r, fsys: r.FS()}, nil
}

// Close releases the directory.
func (d *Dir) Close() error { return d.root.Close() }

// Open opens name for reading. A name that is not a valid slash path, or
// that resolves outside the directory through a symbolic link, is refused.
func (d *Dir) Open(name string) (fs.File, error) { return d.fsys.Open(name) }

// WriteFile writes data to name with mode 0644, creating parent directories.
// The write is atomic: data goes to a temporary file in the same directory,
// which is then renamed over name. A symbolic link at name is replaced, not
// followed.
func (d *Dir) WriteFile(name string, data []byte) error {
	if err := check("write", name); err != nil {
		return err
	}
	dir := path.Dir(name)
	if dir != "." {
		if err := d.root.MkdirAll(dir, 0o755); err != nil { //nolint:gosec // G301: project directories are ordinary source directories
			return err
		}
	}
	tmp := path.Join(dir, "."+path.Base(name)+".tmp-"+rand.Text())
	f, err := d.root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	_, werr := f.Write(data)
	err = errors.Join(werr, f.Close())
	if err == nil {
		err = d.root.Chmod(tmp, 0o644) //nolint:gosec // G302: project files are ordinary, world-readable source files
	}
	if err == nil {
		err = d.root.Rename(tmp, name)
	}
	if err != nil {
		_ = d.root.Remove(tmp)
	}
	return err
}

// Remove removes the file at name. A missing file is not an error, nor is
// a name under a file, on every OS; a directory is. A symbolic link is removed itself, never followed.
func (d *Dir) Remove(name string) error {
	if err := check("remove", name); err != nil {
		return err
	}
	fi, err := d.root.Lstat(name)
	// Under a file nothing can exist: Unix says ENOTDIR, Windows not-exist.
	if errors.Is(err, fs.ErrNotExist) || errors.Is(err, syscall.ENOTDIR) {
		return nil
	}
	if err != nil {
		return err
	}
	if fi.IsDir() {
		return &fs.PathError{Op: "remove", Path: name, Err: errors.New("is a directory")}
	}
	return d.root.Remove(name)
}

// check refuses a name that is not a valid slash path (absolute, or with a
// ".." segment), is ".", contains a backslash, or on Windows contains a
// colon (a drive letter or an alternate data stream).
func check(op, name string) error {
	if !fs.ValidPath(name) || name == "." || strings.Contains(name, `\`) ||
		(runtime.GOOS == "windows" && strings.Contains(name, ":")) {
		return &fs.PathError{Op: op, Path: name, Err: fs.ErrInvalid}
	}
	return nil
}

// WriteFileAt writes data to the file at path, an OS path relative to the
// working directory or absolute, with mode 0644. Unlike Dir.WriteFile it is
// NOT confined to a directory: use it only for an output path the person
// typed, such as render -o. The write is atomic: data goes to a temporary
// file in the same directory, which is then renamed over path. Parent
// directories are not created, and a directory at path is not replaced.
func WriteFileAt(path string, data []byte) error {
	if fi, err := os.Stat(path); err == nil && fi.IsDir() {
		return &fs.PathError{Op: "write", Path: path, Err: errors.New("is a directory")}
	}
	f, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	_, werr := f.Write(data)
	err = errors.Join(werr, f.Close())
	if err == nil {
		err = os.Chmod(tmp, 0o644) //nolint:gosec // G302: an output file the person asked for, world-readable like any other
	}
	if err == nil {
		err = os.Rename(tmp, path)
	}
	if err != nil {
		_ = os.Remove(tmp)
	}
	return err
}

// FindRoot walks up from start to the first directory holding a
// starboard.yaml file and returns it. It returns project.ErrNoProject when it
// reaches the file system root without finding one. A start that does not
// exist, or is not a directory, is an error on every OS.
func FindRoot(start string) (string, error) {
	fi, err := os.Stat(start)
	if err != nil {
		return "", err
	}
	if !fi.IsDir() {
		return "", fmt.Errorf("%s is not a directory", start)
	}
	dir, err := filepath.Abs(start)
	if err != nil {
		return "", err
	}
	for {
		fi, err := os.Stat(filepath.Join(dir, config.FileName))
		switch {
		case err == nil && !fi.IsDir():
			return dir, nil
		case err != nil && !errors.Is(err, fs.ErrNotExist):
			return "", fmt.Errorf("looking for %s: %w", config.FileName, err)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", project.ErrNoProject
		}
		dir = parent
	}
}

// ProjectFile finds the Starboard project holding file, a path an agent's
// hook reported: absolute, or relative to cwd. The project is the one
// holding file's directory, else the one holding cwd. It returns the
// project root and file's slash path relative to it; ok is false when
// there is no such project or file is not inside it. Symbolic links are
// resolved when the plain paths do not match.
func ProjectFile(cwd, file string) (root, rel string, ok bool) {
	file = filepath.FromSlash(file)
	if !filepath.IsAbs(file) {
		file = filepath.Join(cwd, file)
	}
	file, err := filepath.Abs(file)
	if err != nil {
		return "", "", false
	}
	if root, err = FindRoot(filepath.Dir(file)); err != nil {
		if root, err = FindRoot(cwd); err != nil {
			return "", "", false
		}
	}
	rel, ok = within(root, file)
	return root, rel, ok
}

// foldCase is whether paths that differ only in case name the same file,
// as they do by default on Windows and macOS.
var foldCase = runtime.GOOS == "windows" || runtime.GOOS == "darwin"

// within returns file's slash path relative to root, and whether it lies
// inside root. Where foldCase is set, root and file may differ in case.
// Symbolic links in either are resolved when the plain paths do not match.
func within(root, file string) (string, bool) {
	if rel, ok := inside(root, file); ok {
		return rel, true
	}
	r, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", false
	}
	f, err := filepath.EvalSymlinks(file)
	if err != nil {
		return "", false
	}
	return inside(r, f)
}

// inside is within without resolving symbolic links.
func inside(root, file string) (string, bool) {
	rel, err := filepath.Rel(root, file)
	rel = filepath.ToSlash(rel)
	if err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, "../") {
		return rel, true
	}
	if !foldCase {
		return "", false
	}
	root, file = filepath.Clean(root), filepath.Clean(file)
	if !strings.HasSuffix(root, string(filepath.Separator)) {
		root += string(filepath.Separator)
	}
	if len(file) <= len(root) || !strings.EqualFold(file[:len(root)], root) {
		return "", false
	}
	return filepath.ToSlash(file[len(root):]), true
}
