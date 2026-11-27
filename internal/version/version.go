// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package version reports the build's version string.
package version

import "runtime/debug"

// Version is the release version. It is "dev" for local builds; the release
// build sets it with -ldflags "-X github.com/c65llc/starboard/internal/version.Version=<tag>".
var Version = "dev"

// String is the version to report: Version, unless that is "dev" and the
// binary records the version of a module it was built from, as `go install
// github.com/c65llc/starboard/cmd/starboard@v0.1.0` does, in which case that.
// A build from a checkout stays "dev": Go stamps it with a pseudo-version,
// but also with the checkout's VCS settings, which a module build lacks.
func String() string { return resolve(Version, debug.ReadBuildInfo) }

// resolve is String with its inputs given.
func resolve(v string, read func() (*debug.BuildInfo, bool)) string {
	if v != "dev" {
		return v
	}
	bi, ok := read()
	if !ok || bi.Main.Version == "" || bi.Main.Version == "(devel)" {
		return v
	}
	for _, s := range bi.Settings {
		if s.Key == "vcs" {
			return v
		}
	}
	return bi.Main.Version
}
