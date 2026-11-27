# Releasing Starboard

A release is a `vX.Y.Z` tag on `main`. Pushing the tag runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which
builds, checksums and publishes everything; nobody uploads anything by hand.

## The pieces

| Piece | What it does |
|-------|--------------|
| [`release-drafter.yml`](../.github/workflows/release-drafter.yml) + [config](../.github/release-drafter.yml) | On every push to `main`, keeps one **draft** release named after the next version (`vX.Y.Z`) with notes from the merged PRs, grouped by their Conventional Commit type. On PRs it labels them from their title. |
| [`.goreleaser.yaml`](../.goreleaser.yaml) | GoReleaser v2.20.3: builds `cmd/starboard` for darwin, linux and windows on amd64 and arm64 (`CGO_ENABLED=0`, version injected into `internal/version.Version`), archives them as `starboard_<version>_<os>_<arch>.tar.gz` (`.zip` on windows) and writes `checksums.txt` (SHA-256). Its own changelog is off. |
| [`release.yml`](../.github/workflows/release.yml) | On a `vX.Y.Z` tag push. Job `verify` (read-only token, no persisted credentials) checks the tag is on `main` and runs `make ci`. Job `release` (the only holder of `contents: write`, and it runs no tests) runs GoReleaser, which adopts the draft of the same name, keeps its notes, attaches the six archives and `checksums.txt`, and publishes it; then it moves the floating tags, handing the token to git only for that push. |
| [`action.yml`](../action.yml) | The GitHub Action. It downloads a release's archive and `checksums.txt`, verifies the SHA-256 and only then runs the binary. |
| [`action-test.yml`](../.github/workflows/action-test.yml) | Runs the action against a release on Linux, macOS and Windows. Skips with a notice when the release does not exist yet. |

## Floating tags

`v<major>` and `v<major>.<minor>` follow the latest stable release: `v0` and
`v0.1` point at `v0.1.0` until `v0.1.1` moves both. Floating tags never move
backward: `v<major>` moves only when the new tag is the highest stable
`v<major>.*.*`, and `v<major>.<minor>` only when it is the highest stable
`v<major>.<minor>.*` — so a `v0.1.5` patch released after `v0.2.0` moves
`v0.1` but leaves `v0` on `v0.2.0`. Throughout 0.x the major
tag is `v0`; at 1.0.0 it becomes `v1`. Users write `uses: c65llc/starboard@v0`
with `version: v0.1.0`. A pre-release tag (`v0.2.0-rc.1`, anything with a
`-`) is published as a GitHub pre-release and moves no floating tag.

## Cutting a release

A maintainer with push access to `c65llc/starboard` does this; agents never
push tags or publish releases.

1. **Check the draft.** Open the repository's Releases page. The draft at the
   top is named after the version release-drafter resolved from the PR labels
   (`feature` bumps the minor, `breaking`/`major` the major, anything else the
   patch). If you want a different version, edit the draft's **name** (the
   tag field is irrelevant; GoReleaser matches the draft by name) to the
   exact `vX.Y.Z` you will tag. Edit the notes if needed. **Do not publish
   the draft** — publishing it in the UI would create the tag without the
   `main` check and before the assets exist.
2. **Check `main` is green.** CI (and its `CI Gate` check) passed on the commit
   you are releasing.
3. **Tag and push** from an up-to-date `main`:

   ```bash
   git switch main && git pull --ff-only
   git tag -a v0.1.0 -m "v0.1.0"
   git push origin v0.1.0
   ```

4. **Watch `Release`.** When it finishes, the release `v0.1.0` is published
   with the draft's notes, six archives and `checksums.txt`, and `v0` and
   `v0.1` point at the tagged commit:

   ```bash
   gh release view v0.1.0 --json assets --jq '.assets[].name'
   git fetch --tags --force && git rev-parse v0.1.0^{commit} v0^{commit} v0.1^{commit}
   ```

5. **Run `Action test`** (Actions → Action test → Run workflow, version
   `v0.1.0`): it must pass on all three operating systems.

If the draft's name did not match the tag, GoReleaser creates a new release
with an empty body and the draft is left behind: paste the draft's notes
into the published release and delete the draft.

## A failed release

- **`make ci` or GoReleaser failed before publishing:** fix on `main`, delete
  the tag (`git push --delete origin v0.1.0 && git tag -d v0.1.0`), and tag
  the fixed commit. Nothing was published.
- **Published, but broken:** never move or reuse a published version tag —
  the action's users pin exact versions and their checksums. Release the fix
  as the next patch version.

## Local dry run

```bash
goreleaser check
goreleaser release --snapshot --clean   # writes dist/ (gitignored); publishes nothing
dist/starboard_$(go env GOOS)_$(go env GOARCH)*/starboard version
```

## Future

- **Signing and provenance.** Releases are verified by SHA-256 only. Signing
  `checksums.txt` (cosign keyless) and publishing GitHub artifact
  attestations / SLSA provenance, with the action verifying them, is a
  follow-up.
