// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package version reports the build's version string.
package version

// Version is the release version. It is "dev" for local builds; the release
// build sets it with -ldflags "-X github.com/c65llc/starboard/internal/version.Version=<tag>".
var Version = "dev"
