// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package project loads a Starboard project — starboard.yaml, the screen
// registry and the flow documents — from any fs.FS, and defines WriteFS, the
// small interface every command that changes files writes through.
package project

import (
	"errors"
	"fmt"
	"io/fs"
	"path"
	"slices"
	"strings"

	"github.com/c65llc/starboard/internal/config"
	"github.com/c65llc/starboard/internal/diag"
	"github.com/c65llc/starboard/internal/flows"
	"github.com/c65llc/starboard/internal/registry"
)

// ErrNoProject is returned when there is no starboard.yaml to load.
var ErrNoProject = errors.New("no starboard.yaml found; run `starboard init`")

// WriteFS is a file system that can also write and remove files. Names are
// slash paths valid under fs.ValidPath. Remove of a missing file is not an
// error, and Remove never removes a directory. RemoveEmptyDir removes the
// directory at name only when it is empty; a missing name, a directory
// with entries, or anything that is not a directory (a symbolic link
// included) is left, and is not an error.
type WriteFS interface {
	fs.FS
	WriteFile(name string, data []byte) error
	Remove(name string) error
	RemoveEmptyDir(name string) error
}

// Project is a loaded project. Registry and Flows are never nil: a missing or
// unreadable screens.yaml gives an empty registry (with the diagnostics), and
// a missing flows/ an empty map. Flows is keyed by each flow file's stem (flows/add-activity.md is
// "add-activity"), never by its front matter id. FlowFiles is the sorted
// project-relative paths of the flow files. Sources holds the raw bytes of
// starboard.yaml, screens.yaml and every flow file, keyed by slash path.
type Project struct {
	FS        fs.FS
	Config    *config.Config
	Registry  *registry.Registry
	Flows     map[string]*flows.Flow
	FlowFiles []string
	Sources   map[string][]byte
}

// Load reads the project at the root of fsys. A missing starboard.yaml
// returns ErrNoProject. A starboard.yaml that cannot be parsed is a finding,
// not an error: Load returns its diagnostics and a nil Project. A missing
// <content>/screens.yaml or <content>/flows/ gives an empty registry or flow
// set. Only *.md files directly in <content>/flows/ are flows. Every
// diagnostic's File is project-relative, and the diagnostics are sorted. Any
// read failure other than a missing file is returned as the error.
func Load(fsys fs.FS) (*Project, []diag.Diagnostic, error) {
	data, err := fs.ReadFile(fsys, config.FileName)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil, ErrNoProject
	}
	if err != nil {
		return nil, nil, err
	}
	cfg, ds := config.Parse(data)
	if cfg == nil {
		return nil, ds, nil
	}
	p := &Project{
		FS:       fsys,
		Config:   cfg,
		Registry: &registry.Registry{Screens: map[string]*registry.Screen{}},
		Flows:    map[string]*flows.Flow{},
		Sources:  map[string][]byte{config.FileName: data},
	}

	content := path.Clean(cfg.Content)
	if strings.Contains(content, `\`) || !fs.ValidPath(content) {
		ds = append(ds, diag.Diagnostic{
			Rule: "path-invalid", Severity: diag.Error, File: config.FileName, Path: "content",
			Message: fmt.Sprintf("content %s must be a relative path inside the project, written with /", cfg.Content),
		})
		diag.Sort(ds)
		return p, ds, nil
	}

	more, err := p.loadRegistry(path.Join(content, registry.FileName))
	if err != nil {
		return nil, nil, err
	}
	ds = append(ds, more...)

	more, err = p.loadFlows(path.Join(content, "flows"))
	if err != nil {
		return nil, nil, err
	}
	ds = append(ds, more...)

	diag.Sort(ds)
	return p, ds, nil
}

// loadRegistry parses the registry at name, if there is one.
func (p *Project) loadRegistry(name string) ([]diag.Diagnostic, error) {
	data, err := fs.ReadFile(p.FS, name)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.Sources[name] = data
	reg, ds := registry.Parse(data)
	if reg != nil { // nil only when the YAML is unreadable; keep the empty registry
		p.Registry = reg
	}
	return relocate(ds, name), nil
}

// loadFlows parses every *.md file directly in dir, if dir exists.
func (p *Project) loadFlows(dir string) ([]diag.Diagnostic, error) {
	entries, err := fs.ReadDir(p.FS, dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var ds []diag.Diagnostic
	for _, e := range entries {
		stem, ok := strings.CutSuffix(e.Name(), ".md")
		if e.IsDir() || !ok || stem == "" {
			continue
		}
		name := path.Join(dir, e.Name())
		data, err := fs.ReadFile(p.FS, name)
		if err != nil {
			return nil, err
		}
		p.Sources[name] = data
		f, fds := flows.Parse(data)
		p.Flows[stem] = f
		p.FlowFiles = append(p.FlowFiles, name)
		ds = append(ds, relocate(fds, name)...)
	}
	slices.Sort(p.FlowFiles)
	return ds, nil
}

// relocate sets every diagnostic's File to the project-relative name.
func relocate(ds []diag.Diagnostic, name string) []diag.Diagnostic {
	for i := range ds {
		ds[i].File = name
	}
	return ds
}
