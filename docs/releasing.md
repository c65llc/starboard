# Releasing Starboard

A release is a `vX.Y.Z` tag on `main`. Pushing the tag runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which
builds, checksums and publishes everything; nobody uploads anything by hand.

## The pieces

| Piece | What it does |
|-------|--------------|
| [`release-drafter.yml`](../.github/workflows/release-drafter.yml) + [config](../.github/release-drafter.yml) | On every push to `main`, keeps one **draft** release named after the next version (`vX.Y.Z`) with notes from the merged PRs, grouped by their Conventional Commit type. On PRs it labels them from their title. |
| [`.goreleaser.yaml`](../.goreleaser.yaml) | GoReleaser v2.20.3: builds `cmd/starboard` for darwin, linux and windows on amd64 and arm64 (`CGO_ENABLED=0`, version injected into `internal/version.Version`), archives them as `starboard_<version>_<os>_<arch>.tar.gz` (`.zip` on windows) and writes `checksums.txt` (SHA-256). Its own changelog is off. |
| [`release.yml`](../.github/workflows/release.yml) | On a `vX.Y.Z` tag push. Job `verify` (read-only token, no persisted credentials) checks the tag is on `main` and runs `make ci`. Job `release` (holds `contents: write` and runs no tests) runs GoReleaser, which adopts the draft of the same name, keeps its notes, attaches the six archives and `checksums.txt`, and publishes it; then it moves the floating tags, handing the token to git only for that push. Job `site` then calls `publish.yml` with `contents: write` as its ceiling; only `publish.yml`'s `publish` job uses it, to push `live`. |
| [`action.yml`](../action.yml) | The GitHub Action. It downloads a release's archive and `checksums.txt`, verifies the SHA-256 and only then runs the binary. |
| [`publish.yml`](../.github/workflows/publish.yml) | Publishes the website, <https://starboard.c65llc.com/>, by moving the `live` branch. `release.yml` calls it after a stable release; see [Publishing the website](#publishing-the-website). |
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

5. **Check the website.** `release.yml`'s `site` job (publish.yml) built the
   tagged commit's site and moved `live`; Cloudflare Pages serves it a
   minute or two later. Run the [checklist](#after-a-release-check-the-site).
6. **Run `Action test`** (Actions → Action test → Run workflow, version
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

## Publishing the website

<https://starboard.c65llc.com/> is a Cloudflare Pages project that serves
the `live` branch as it is: `live` holds the **built** site, not source.
Cloudflare does no building, because the build needs the Go binary, the PWA
and Playwright's Chromium (the flow diagrams are drawn at build time), which
its build image does not have. GitHub Actions builds it instead.

[`publish.yml`](../.github/workflows/publish.yml) has three jobs:

1. `resolve` (read-only) decides whether to publish, which commit to build
   and which version the site shows.
2. `build` is [`site.yml`](../.github/workflows/site.yml), the same build and
   checks as CI (site-check, links, the CSP tests, Playwright and axe). It
   uploads `website/dist` as an artifact only when every check passed.
3. `publish`, the only job with `contents: write`, runs no project code.
   It refuses an artifact that holds any `.git*` path or lacks a file the
   site needs (`index.html`, `_headers` with its CSP placeholders filled,
   `app/index.html`, `app/core/starboard.wasm`, `schema/v1/*.json`). It
   then replaces `live` with **one orphan commit** whose tree is exactly the
   built site, so `live` always holds a single commit and the repository
   does not gain a full site's worth of history per publish. Its git
   directory sits outside the artifact. It pushes with the built-in
   `GITHUB_TOKEN` and `--force-with-lease` against the `live` head it read
   (for the first publish, that `live` does not exist): if `live` moved
   meanwhile, the push is rejected and the run fails. If the build is
   identical to what `live` already holds, it pushes nothing.

   Each commit records its version in a `Starboard-Version:` trailer.
   Because builds can finish out of order, the job refuses to publish a
   version that is no longer the newest stable tag, or to replace a `live`
   that records a newer version. A `publish-live` concurrency group runs one
   publish at a time.

### What moves `live`

Only these, and nothing else:

| Event | Builds | Version the site shows |
|-------|--------|------------------------|
| A stable release (`release.yml`'s `site` job calls `publish.yml`; `release: published` covers a release published any other way) | the tagged commit | the release tag |
| A push to `main` touching `website/src/content/docs/blog/**` (a new or edited post) | `main` | the newest stable release tag |
| `workflow_dispatch` from `main`, `tag` empty | `main` | the newest stable release tag |
| `workflow_dispatch` from `main`, `tag` set | that release's commit | that tag |

`resolve` skips, with a notice, a pre-release (`v0.2.0-rc.1`), a release that
is not the newest stable one (a `v0.1.5` patch after `v0.2.0` does not take
the site back to 0.1), a dispatch from a branch other than `main`, and
anything before the first stable release.

`release.yml` calls `publish.yml` directly because GoReleaser publishes the
release with the `GITHUB_TOKEN`, and an event the `GITHUB_TOKEN` raises
starts no workflow, so `release: published` alone would never fire for a
normal release.

A blog-post publish builds `main`, not the release, so it also carries
whatever else `main` has gained since the last release, docs included, under
the last release's version number. That is deliberate (a blog post often
announces what just merged) and keeps the rule simple; if `main` holds docs
for something unreleased, hold the post or publish it with the release.

### Publishing by hand

(After the first publish; see [the release order](#the-first-publish-release-order).)
Actions → **Publish site** → **Run workflow**, on `main`. Leave `tag` empty to
publish `main`, or give a stable tag (`v0.1.0`) to republish that release's
site, for example after a failed run. The tag must be the newest stable
release.

To take the site back to an earlier build, use Cloudflare Pages'
**Deployments → Rollback to this deployment** on an earlier deployment, then
fix forward with a fixed release. Dispatching an older tag is refused by
design (the tag must be the newest stable release), and `live` keeps no
history to revert to. Nobody pushes to `live` by hand.

### The first publish: release order

The site goes live together with v0.2.0, and the order matters. Plan 4's
first PR puts `https://starboard.c65llc.com/rules/<id>/` links into every
finding, and its second PR adds the launch blog post, whose merge fires the
blog trigger and publishes `main` under the newest stable tag (v0.1.0), while
the docs it publishes describe v0.2.0 features (`skills`, `rules`, the docs
links). So:

1. Merge #8, #10 and #13.
2. Merge Plan 4's first PR (examples and docs). **Do not cut a release
   between this PR and the next one:** it would ship rule links into a site
   that does not exist yet.
3. Merge Plan 4's second PR (the site and `publish.yml`). The blog post
   triggers **Publish site**, which creates `live`, showing v0.1.0. Nothing
   points a domain at it yet. Watch this first run (see below).
4. Cut **v0.2.0** promptly ([Cutting a release](#cutting-a-release)).
   `release.yml`'s `site` job republishes `live` as v0.2.0.
5. Set up Cloudflare Pages (below). Connect the custom domain only after
   v0.2.0's publish has replaced `live`.

Do not run **Publish site** by hand before v0.2.0. It would publish v0.1.0's
version label over v0.2.0's docs.

**Watch the first Publish site run.** It is the first run of three things
that local tests cannot cover:

- the nested `workflow_call` (`release.yml` → `publish.yml` → `site.yml`);
- the `contents: write` ceiling the caller passes down;
- the depth-1 fetch of `live` by SHA, followed by the forced push.

If it fails, fix it on `main` and run it by hand.

**`live` must accept the bot's force-push.** No repository ruleset or branch
protection may cover `live`. In particular, the `main` ruleset must target
`main` only, not `~ALL` or a pattern that matches `live`, or
`github-actions[bot]`'s `--force-with-lease` push is refused. Check
**Settings → Rules → Rulesets** before step 3.

### Cloudflare Pages setup (once, by a human, at step 5)

1. In Cloudflare, **Workers & Pages → Create → Pages → Connect to Git**, and
   pick `c65llc/starboard`. The production-branch picker lists only branches
   that exist, so `live` must already have been created (step 3 above).
2. **Production branch:** `live`. **Framework preset:** None. **Build
   command:** empty. **Build output directory:** `/`. No environment
   variables. Under the project's settings, set preview deployments to
   **None** (no other branch holds a built site).
3. Check `<project>.pages.dev` shows v0.2.0. Then **Custom domains → Set up
   a custom domain:** `starboard.c65llc.com`. Cloudflare creates the CNAME
   automatically only if `c65llc.com` is a Cloudflare zone on the same
   account. Otherwise, add a `CNAME starboard → <project>.pages.dev` at the
   zone's DNS host yourself, and wait for Pages to show the domain as active.

Every later publish replaces `live`'s single commit (a forced update);
Cloudflare deploys whatever `live` points at.

No Cloudflare token or other secret is stored in GitHub: Cloudflare reads the
repository through its GitHub app, and the workflow pushes with the built-in
`GITHUB_TOKEN`.

### After a release: check the site

```bash
site=https://starboard.c65llc.com
for p in / /app/ /schema/v1/config.json /schema/v1/screens.json /rules/file-missing/ /blog/; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$site$p")" "$p"
done
curl -sI "$site/" | grep -i '^content-security-policy'
curl -sI "$site/app/" | grep -i '^content-security-policy'
curl -sI "$site/app/core/starboard.wasm" | grep -i '^content-type'
```

- Every page answers `200`, and the landing page shows the new version.
- `/` has one `Content-Security-Policy` with hashes in `script-src` and no
  `'unsafe-inline'` there.
- `/app/` has the site's policy **and** the `/app/*` policy (Cloudflare joins
  them into one header, comma-separated, or sends two); the `/app/*` one
  includes `worker-src 'self'`. The app loads and its core starts (no CSP
  error in the browser console).
- `/app/core/starboard.wasm` is served as `Content-Type: application/wasm`
  (the `/*.wasm` rule), or the browser refuses to stream-compile it.
- `/schema/v1/*.json` are byte-for-byte the schemas the release's binary
  embeds (`starboard schema config` and `starboard schema screens` print
  them).

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
