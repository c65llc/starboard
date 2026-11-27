// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package version

import (
	"runtime/debug"
	"testing"
)

// TestDefaultVersion pins the value an unreleased build reports; release
// builds overwrite it with -ldflags "-X .../internal/version.Version=...".
func TestDefaultVersion(t *testing.T) {
	if Version != "dev" {
		t.Fatalf("Version = %q, want %q", Version, "dev")
	}
}

func TestResolve(t *testing.T) {
	info := func(v string, ok bool, settings ...debug.BuildSetting) func() (*debug.BuildInfo, bool) {
		return func() (*debug.BuildInfo, bool) {
			if !ok {
				return nil, false
			}
			return &debug.BuildInfo{Main: debug.Module{Path: "github.com/c65llc/starboard", Version: v}, Settings: settings}, true
		}
	}
	vcs := []debug.BuildSetting{{Key: "-trimpath", Value: "true"}, {Key: "vcs", Value: "git"}}
	for _, tc := range []struct {
		name, set string
		read      func() (*debug.BuildInfo, bool)
		want      string
	}{
		{"release build keeps its ldflags version", "v0.1.0", info("v0.0.9", true), "v0.1.0"},
		{"go install @v0.1.0", "dev", info("v0.1.0", true), "v0.1.0"},
		{"go install @v0.1.0 with other settings", "dev", info("v0.1.0", true, vcs[0]), "v0.1.0"},
		{"local build in a module", "dev", info("(devel)", true), "dev"},
		{"local build in a checkout", "dev", info("v0.0.0-20261126200458-065f6ab79514+dirty", true, vcs...), "dev"},
		{"no module version", "dev", info("", true), "dev"},
		{"no build info", "dev", info("", false), "dev"},
	} {
		if got := resolve(tc.set, tc.read); got != tc.want {
			t.Errorf("%s: resolve = %q, want %q", tc.name, got, tc.want)
		}
	}
	if got := String(); got != resolve(Version, debug.ReadBuildInfo) {
		t.Errorf("String() = %q", got)
	}
}
