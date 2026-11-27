---
title: Install
description: Install the starboard command from a release archive or with go install, and check that it runs.
---

Starboard is one command, `starboard`, a single binary with no runtime
dependencies. Install it on your machine to write and check the reference
locally; in CI, the [GitHub Action](../ci/) downloads it for you.

## From a release

Each release on the
[releases page](https://github.com/c65llc/starboard/releases) has an archive
for macOS (`darwin`), Linux and Windows, on `amd64` and `arm64`:

- `starboard_<version>_<os>_<arch>.tar.gz` (`.zip` on Windows), holding the
  `starboard` binary, `LICENSE` and `README.md`;
- `checksums.txt`, the SHA-256 of every archive.

To install one:

1. Download the archive for your system and `checksums.txt`.
2. Check the archive's SHA-256 against its line in `checksums.txt`
   (`sha256sum` on Linux, `shasum -a 256` on macOS, `Get-FileHash` in
   PowerShell).
3. Extract `starboard` (`starboard.exe` on Windows) into a directory on your
   `PATH`.

## With Go

With Go 1.27 or later:

```text
go install github.com/c65llc/starboard/cmd/starboard@latest
```

`go install` puts the binary in `$(go env GOPATH)/bin`; make sure that
directory is on your `PATH`.

## Check it runs

<!-- verified: empty -->
```bash
starboard version
starboard --help
```

`starboard version` prints the release you installed (a build from a source
checkout prints `starboard dev`). `starboard --help` lists every command;
the [CLI reference](../../reference/cli/) describes each one.

## Next

[Start a project](../first-project/) in a repository, or add Starboard to an
app you already have with the [adoption guide](../../guides/adopting/).
