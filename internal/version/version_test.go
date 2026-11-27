// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package version

import "testing"

// TestDefaultVersion pins the value an unreleased build reports; release
// builds overwrite it with -ldflags "-X .../internal/version.Version=...".
func TestDefaultVersion(t *testing.T) {
	if Version != "dev" {
		t.Fatalf("Version = %q, want %q", Version, "dev")
	}
}
