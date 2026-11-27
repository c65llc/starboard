// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Command starboard keeps an app's screen and flow reference: it formats,
// lints and scaffolds the files, generates the app map, screen catalog and
// wireframes from them, and prints their JSON Schemas.
package main

import (
	"os"

	"github.com/c65llc/starboard/internal/cli"
)

func main() {
	os.Exit(cli.Run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}
