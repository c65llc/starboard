// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package mcp

import (
	"errors"
	"io/fs"
	"path"
	"slices"
	"strings"

	"github.com/c65llc/starboard/internal/project"
)

// overlay is the project as a write would leave it: base with files
// replaced or added, and nothing written. A preview lints it, so the
// findings it reports are exactly those the write would.
type overlay struct {
	base  fs.FS
	files project.MemFS
}

func (o overlay) Open(name string) (fs.File, error) {
	if _, ok := o.files[name]; ok {
		return o.files.Open(name)
	}
	return o.base.Open(name)
}

// ReadDir lists base's entries for name with the overlay's files in it
// added, so a new flow file is found where the loader looks.
func (o overlay) ReadDir(name string) ([]fs.DirEntry, error) {
	entries, err := fs.ReadDir(o.base, name)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	found := err == nil
	for file := range o.files {
		if path.Dir(file) != name {
			continue
		}
		found = true
		base := path.Base(file)
		if slices.ContainsFunc(entries, func(e fs.DirEntry) bool { return e.Name() == base }) {
			continue
		}
		info, _ := fs.Stat(o.files, file) // the file is in o.files, so Stat cannot fail
		entries = append(entries, fs.FileInfoToDirEntry(info))
	}
	if !found {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrNotExist}
	}
	slices.SortFunc(entries, func(a, b fs.DirEntry) int { return strings.Compare(a.Name(), b.Name()) })
	return entries, nil
}
