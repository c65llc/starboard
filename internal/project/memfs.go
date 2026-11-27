// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package project

import (
	"bytes"
	"errors"
	"io"
	"io/fs"
	"path"
	"slices"
	"strings"
	"time"
)

// MemFS is an in-memory WriteFS: a map from slash path to file contents.
// Directories are implied by the paths of the files under them, so an empty
// directory cannot exist. Write through a non-nil map (a literal or make);
// the zero value is read-only. MemFS is not safe for concurrent writes.
type MemFS map[string][]byte

var (
	errIsDir    = errors.New("is a directory")
	errNotDir   = errors.New("not a directory")
	errBadSlash = errors.New(`path contains \`)
)

// check reports whether name may name a file: a valid slash path other than
// ".", without a backslash.
func check(op, name string) error {
	switch {
	case !fs.ValidPath(name) || name == ".":
		return &fs.PathError{Op: op, Path: name, Err: fs.ErrInvalid}
	case strings.Contains(name, `\`):
		return &fs.PathError{Op: op, Path: name, Err: errBadSlash}
	}
	return nil
}

// isDir reports whether some file lies under name.
func (m MemFS) isDir(name string) bool {
	if name == "." {
		return true
	}
	prefix := name + "/"
	for k := range m {
		if strings.HasPrefix(k, prefix) {
			return true
		}
	}
	return false
}

// Open opens a file or an implied directory.
func (m MemFS) Open(name string) (fs.File, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrInvalid}
	}
	if data, ok := m[name]; ok {
		return &memFile{Reader: bytes.NewReader(data), info: memInfo{path.Base(name), int64(len(data)), false}}, nil
	}
	if !m.isDir(name) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}
	return &memDir{info: memInfo{path.Base(name), 0, true}, entries: m.children(name)}, nil
}

// children lists the entries directly in the directory name, sorted.
func (m MemFS) children(name string) []fs.DirEntry {
	prefix := name + "/"
	if name == "." {
		prefix = ""
	}
	seen := map[string]memInfo{}
	for k, data := range m {
		rest, ok := strings.CutPrefix(k, prefix)
		if !ok {
			continue
		}
		if first, _, deeper := strings.Cut(rest, "/"); deeper {
			seen[first] = memInfo{first, 0, true}
		} else {
			seen[rest] = memInfo{rest, int64(len(data)), false}
		}
	}
	out := make([]fs.DirEntry, 0, len(seen))
	for _, info := range seen {
		out = append(out, info)
	}
	slices.SortFunc(out, func(a, b fs.DirEntry) int { return strings.Compare(a.Name(), b.Name()) })
	return out
}

// WriteFile stores a copy of data at name, replacing any file there. It
// refuses a name that is a directory or lies under a file.
func (m MemFS) WriteFile(name string, data []byte) error {
	if err := check("write", name); err != nil {
		return err
	}
	if m.isDir(name) {
		return &fs.PathError{Op: "write", Path: name, Err: errIsDir}
	}
	for dir := path.Dir(name); dir != "."; dir = path.Dir(dir) {
		if _, ok := m[dir]; ok {
			return &fs.PathError{Op: "write", Path: name, Err: errNotDir}
		}
	}
	m[name] = bytes.Clone(data)
	return nil
}

// Remove deletes the file at name. A missing file is not an error; a
// directory is.
func (m MemFS) Remove(name string) error {
	if err := check("remove", name); err != nil {
		return err
	}
	if m.isDir(name) {
		return &fs.PathError{Op: "remove", Path: name, Err: errIsDir}
	}
	delete(m, name)
	return nil
}

// RemoveEmptyDir removes nothing: a MemFS directory exists only while it
// holds files, so it is never empty. An invalid name is an error.
func (m MemFS) RemoveEmptyDir(name string) error {
	return check("remove", name)
}

// memInfo is both the fs.FileInfo and the fs.DirEntry of a file or directory.
type memInfo struct {
	name string
	size int64
	dir  bool
}

func (i memInfo) Name() string               { return i.name }
func (i memInfo) Size() int64                { return i.size }
func (i memInfo) ModTime() time.Time         { return time.Time{} }
func (i memInfo) IsDir() bool                { return i.dir }
func (i memInfo) Sys() any                   { return nil }
func (i memInfo) Info() (fs.FileInfo, error) { return i, nil }
func (i memInfo) Type() fs.FileMode          { return i.Mode().Type() }

func (i memInfo) Mode() fs.FileMode {
	if i.dir {
		return fs.ModeDir | 0o555
	}
	return 0o444
}

// memFile is an open file.
type memFile struct {
	*bytes.Reader
	info memInfo
}

func (f *memFile) Stat() (fs.FileInfo, error) { return f.info, nil }
func (f *memFile) Close() error               { return nil }

// memDir is an open directory.
type memDir struct {
	info    memInfo
	entries []fs.DirEntry
	off     int
}

func (d *memDir) Stat() (fs.FileInfo, error) { return d.info, nil }
func (d *memDir) Close() error               { return nil }

func (d *memDir) Read([]byte) (int, error) {
	return 0, &fs.PathError{Op: "read", Path: d.info.name, Err: errIsDir}
}

// ReadDir follows fs.ReadDirFile: n <= 0 returns every remaining entry; n > 0
// returns at most n, and io.EOF once none remain.
func (d *memDir) ReadDir(n int) ([]fs.DirEntry, error) {
	rest := d.entries[d.off:]
	if n <= 0 {
		d.off = len(d.entries)
		return slices.Clone(rest), nil
	}
	if len(rest) == 0 {
		return nil, io.EOF
	}
	n = min(n, len(rest))
	d.off += n
	return slices.Clone(rest[:n]), nil
}
