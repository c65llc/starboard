---
title: GitHub Action
description: The inputs of the c65llc/starboard GitHub Action, how it installs a verified release, and examples.
---

The Action runs one released `starboard` binary in a GitHub Actions job:

```yaml
- uses: actions/checkout@v7
- uses: c65llc/starboard@v0
  with:
    version: v0.1.0
    args: lint --strict
```

It works on Linux, macOS and Windows runners, on x64 and arm64.

## Inputs

| Input | Required | Default | Value |
| --- | --- | --- | --- |
| `version` | yes | none | The exact Starboard release to run, as `vX.Y.Z`, such as `v0.1.0`. |
| `args` | no | `lint` | The arguments for `starboard`, on one line. |
| `working-directory` | no | `.` | The directory to run `starboard` in. |

`args` is split on whitespace and nothing else: there is no shell, so no
quoting, globbing or variable expansion, and no argument can contain a
space. A value with more than one line is an error.

## What it does

1. Checks that `version` is an exact release, `vX.Y.Z`, before it downloads
   anything.
2. Downloads that release's archive for the runner's operating system and
   architecture, and its `checksums.txt`, from the repository's releases.
3. Checks the archive's SHA-256 against `checksums.txt`, and stops if it
   does not match.
4. Extracts the binary and runs it as `starboard <args>` in
   `working-directory`. The job fails if `starboard` exits with a status
   other than 0.

The Action's own tag, `@v0`, moves to each new 0.x release, and `@v1` will
do the same from 1.0. The binary it runs changes only when you change
`version`, so a new Starboard release never changes your CI's result until
you choose it.

## Examples

Check the reference on every pull request, warnings included:

```yaml
- uses: c65llc/starboard@v0
  with:
    version: v0.1.0
    args: lint --strict
```

A project in a subdirectory of the repository, `app/`:

```yaml
- uses: c65llc/starboard@v0
  with:
    version: v0.1.0
    args: --dir app lint
```

`working-directory: app` with `args: lint` does the same.

Only check that the generated pages are current:

```yaml
- uses: c65llc/starboard@v0
  with:
    version: v0.1.0
    args: generate --check
```

A full workflow is in [Check it in CI](../../getting-started/ci/).
