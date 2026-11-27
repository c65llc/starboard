// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package archtest holds architecture tests: rules about how the module's
// packages may depend on each other, checked by parsing the source.
package archtest

import (
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// forbiddenImports may appear only in internal/osfs, the one package that
// touches the operating system.
var forbiddenImports = map[string]bool{
	"os":      true,
	"os/exec": true,
}

// TestNoOSImports fails if any non-test Go file under internal/, other than
// internal/osfs, imports os or os/exec.
func TestNoOSImports(t *testing.T) {
	internalDir := ".."
	osfsDir := filepath.Join(internalDir, "osfs")

	err := filepath.WalkDir(internalDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if filepath.Clean(path) == filepath.Clean(osfsDir) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		for _, imp := range file.Imports {
			p, err := strconv.Unquote(imp.Path.Value)
			if err != nil {
				return err
			}
			if forbiddenImports[p] {
				t.Errorf("%s imports %q; only internal/osfs may touch the OS", filepath.ToSlash(path), p)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walking %s: %v", internalDir, err)
	}
}

// TestInternalDirExists guards the walk above against passing vacuously if
// the test is ever moved and ".." no longer names internal/.
func TestInternalDirExists(t *testing.T) {
	abs, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(abs) != "internal" {
		t.Fatalf("archtest must live directly under internal/, found parent %s", abs)
	}
	if _, err := os.Stat(abs); err != nil {
		t.Fatal(err)
	}
}
