---
title: Check it in CI
description: Fail a pull request whose screen and flow reference is invalid, unformatted or out of date, with the GitHub Action or the binary.
---

`starboard lint` is the whole check. Besides the errors in the reference
itself, it fails when a file is not in canonical form
([not-formatted](../../rules/not-formatted/)) and when `generated/` no
longer matches the sources ([generated-stale](../../rules/generated-stale/)).
Run it on every pull request and the reference cannot drift from what was
committed.

It exits 1 on errors. Warnings are reported but pass, unless you add
`--strict`. `starboard rules` lists every rule with its default severity,
and each rule has a page; see the
[list of rules](../../reference/json-output/#rules).

## With the GitHub Action

Add a workflow, for example `.github/workflows/starboard.yml`:

```yaml
name: Starboard

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  starboard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: c65llc/starboard@v0
        with:
          version: v0.1.0
          args: lint --strict
```

The Action downloads the release you name in `version`, checks its SHA-256
against the release's `checksums.txt`, and runs it with `args`. `@v0` always
points at the newest 0.x release of the Action; `version` pins the binary,
so the result changes only when you change it. The
[Action reference](../../reference/github-action/) lists every input.

This is the command it runs, which you can run first on your machine:

<!-- verified: examples/travel-app -->
```bash
starboard lint --strict
```

<!-- output -->
```text
0 errors, 0 warnings
```

## In other CI systems

Install the binary as in [Install](../install/), then run `starboard lint`
(or `starboard lint --strict`) from the repository root. Any exit status
other than 0 should fail the job: 1 means findings, 2 means Starboard could
not run, for example because there is no `starboard.yaml`.

For a machine-readable report, which a CI annotation step or a coding agent
can read, use `--json`:

<!-- verified: examples/travel-app -->
```bash
starboard lint --json
```

<!-- output -->
```json
{
  "version": 1,
  "errors": [],
  "warnings": []
}
```

The [JSON output reference](../../reference/json-output/) describes each
finding's fields.

## Before you push

The same check runs well as a git pre-commit hook, so a commit never carries
an unformatted or stale reference:

<!-- verified: examples/travel-app -->
```bash
starboard fmt --check && starboard lint
```

`starboard skills hooks pre-commit` prints a ready-made hook script; see
[Working with coding agents](../../guides/agents/#git-pre-commit).

When `lint` reports [not-formatted](../../rules/not-formatted/) or
[generated-stale](../../rules/generated-stale/), `starboard lint --fix`
formats the sources and regenerates `generated/`, then checks again. Commit
what it changes.
