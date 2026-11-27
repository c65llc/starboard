# Releasing Starboard

A release is a `vX.Y.Z` tag on `main`. Pushing the tag runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which
builds, checksums and publishes everything; nobody uploads anything by hand.

## The pieces

| Piece | What it does |
|-------|--------------|
| [`release-drafter.yml`](../.github/workflows/release-drafter.yml) + [config](../.github/release-drafter.yml) | On every push to `main`, keeps one **draft** release named after the next version (`vX.Y.Z`) with notes from the merged PRs, grouped by their Conventional Commit type. On PRs it labels them from their title. |
| [`.goreleaser.yaml`](../.goreleaser.yaml) | GoReleaser v2.20.3: builds `cmd/starboard` for darwin, linux and windows on amd64 and arm64 (`CGO_ENABLED=0`, version injected into `internal/version.Version`), archives them as `starboard_<version>_<os>_<arch>.tar.gz` (`.zip` on windows) and writes `checksums.txt` (SHA-256). Its own changelog is off. |
| [`release.yml`](../.github/workflows/release.yml) | On a `vX.Y.Z` tag push. Job `verify` (read-only token, no persisted credentials) checks the tag is on `main` and runs `make ci`. Job `release` (holds `contents: write` and runs no tests) runs GoReleaser, which adopts the draft of the same name, keeps its notes, attaches the six archives and `checksums.txt`, and publishes it; then it moves the floating tags, handing the token to git only for that push. Job `site` then calls `publish.yml` with `contents: write` as its ceiling; only `publish.yml`'s `publish` job uses it, to push `live`. No Cloudflare secret is passed: Cloudflare deploys `live` itself. |
| [`action.yml`](../action.yml) | The GitHub Action. It downloads a release's archive and `checksums.txt`, verifies the SHA-256 and only then runs the binary. |
| [`publish.yml`](../.github/workflows/publish.yml) | Publishes the website, <https://starboard.c65llc.com/>: builds it and moves the `live` branch, which Cloudflare Workers Builds deploys to the `starboard` Worker. `release.yml` calls it after a stable release; see [Publishing the website](#publishing-the-website). |
| [`website/deploy/`](../website/deploy/) | The `starboard` Worker's deploy project, copied to the root of `live`: [`wrangler.jsonc`](../website/deploy/wrangler.jsonc) (static assets only, from `./public`, on the custom domain `starboard.c65llc.com`) and wrangler, pinned with every dependency by its `pnpm-lock.yaml` (3-day `minimumReleaseAge`, no install scripts), so nothing is resolved at deploy time. |
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
   tagged commit's site and moved `live`; Cloudflare Workers Builds then
   deploys `live` to the `starboard` Worker. **A green `Release` run does not
   mean the site deployed**: check the build in Cloudflare (Workers & Pages →
   `starboard` → Deployments, or the GitHub check run Cloudflare adds to the
   `live` commit), then run the [checklist](#after-a-release-check-the-site).

   The deploy runs **after** the release is published. If it fails, the
   release is already out and `live` has moved, but the site still shows the
   previous release. Fix the cause and retry the build in Cloudflare (see
   [Publishing by hand](#publishing-by-hand)).
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

<https://starboard.c65llc.com/> is served by a Cloudflare **Worker with
static assets** named `starboard` (not a Pages project; Cloudflare now
creates those as Workers). It has no script: it serves the built site on
the custom domain `starboard.c65llc.com`; `workers.dev` is off.

The Worker is connected to this repository with **Workers Builds**, whose
production branch is `live`. `live` holds one orphan commit whose tree is a
complete Wrangler project:

| Path in `live` | From |
|----------------|------|
| `wrangler.jsonc`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | [`website/deploy/`](../website/deploy/) at the published commit |
| `.nvmrc` | [`website/.nvmrc`](../website/.nvmrc) at the published commit (the Node version Cloudflare installs) |
| `public/` | the built site (`website/dist`) |

On every new `live` commit, Cloudflare installs the dependencies from
`pnpm-lock.yaml` (pnpm at the version `package.json`'s `packageManager`
names, through corepack). The install is **expected** to be frozen, not
guaranteed: Cloudflare does not document its pnpm install command, but it
sets `CI`, and pnpm then refuses to change the lockfile by default; the
[first-build checklist](#first-build-checklist) confirms it. It runs no
build command, and runs the deploy command `npx --no wrangler deploy`,
which uses the wrangler just installed (`--no`: never download one).
**Cloudflare never builds the site**; it cannot (the build needs the Go
binary, the PWA and Playwright's Chromium, which draws the flow diagrams).
GitHub Actions builds it and pushes it to `live`, and holds no Cloudflare
token.

**A green Publish site (or Release) run means `live` moved, not that the
site deployed.** The deploy's status and logs are in Cloudflare: Workers &
Pages → `starboard` → Deployments (View build history).

[`publish.yml`](../.github/workflows/publish.yml) has three jobs:

1. `resolve` (read-only) decides whether to publish, which commit to build
   and which version the site shows.
2. `build` is [`site.yml`](../.github/workflows/site.yml), the same build and
   checks as CI (site-check, links, the CSP tests, Playwright and axe). It
   uploads `website/dist` as an artifact only when every check passed.
3. `publish`, the only job with `contents: write`, runs no project code.
   It takes `website/deploy/` and `website/.nvmrc` from the published commit
   as data (a sparse checkout that leaves no credentials behind; nothing in
   it is executed) and puts the artifact in `public/`. It refuses a tree
   that holds any `.git*` path, in any case (so `.GIT` and `.github/` too:
   nothing the site or `website/deploy/` is made from holds such a dotfile,
   so any such path is a mistake to fix upstream); a `website/deploy/` that
   tracks anything but its allow-list (`wrangler.jsonc`, `package.json`,
   `pnpm-lock.yaml`, `pnpm-workspace.yaml`, each a regular file, not a
   symlink) or lacks one of them, or a missing `website/.nvmrc`; a
   `package.json` with a `scripts` key (Cloudflare's install would run
   lifecycle scripts); a `wrangler.jsonc` whose assets directory is not
   `./public`; or a site lacking a file it needs
   (`index.html`, `404.html`, `_headers` with its CSP placeholders filled,
   `app/index.html`, `app/core/starboard.wasm`, `schema/v1/*.json`). It
   then replaces `live` with **one orphan commit** holding exactly that
   tree, so `live` always holds a single commit and the repository does not
   gain a full site's worth of history per publish. Its git directory sits
   outside the tree. It pushes with the built-in `GITHUB_TOKEN` and
   `--force-with-lease` against the `live` head it read (for the first
   publish, that `live` does not exist): if `live` moved meanwhile, the push
   is rejected and the run fails. If the tree is identical to what `live`
   already holds, it pushes nothing, so Cloudflare deploys nothing.

   Each commit records its version in a `Starboard-Version:` trailer.
   Because builds can finish out of order, the job refuses to publish a
   version that is no longer the newest stable tag, or to replace a `live`
   that records a newer version. A `publish-live` concurrency group runs one
   publish at a time. Git cannot make the tag check and the push atomic (no
   lease can say "no newer tag exists"), so after pushing it lists the tags
   again and, if a newer stable tag appeared in between, warns and stays
   green: that tag's own release run publishes it next, queued behind this
   one in `publish-live`.

The deploy files come from the commit being published, so a release
deploys with its own tag's `website/deploy/`. A tag cut before
`website/deploy/wrangler.jsonc` existed cannot be published by this
workflow (`publish` refuses it for the missing file).

**Two quick publishes can deploy out of order.** `publish-live` orders the
pushes to `live`, but Cloudflare builds each `live` commit on its own, and
nothing makes an older build finish first. After back-to-back publishes,
check that the latest deployment in Cloudflare (Deployments) was built from
`live`'s head (`git ls-remote origin refs/heads/live`); if not, retry the
build of `live`'s head there.

### Who can deploy

`live` is now a **deploy trigger**. Cloudflare checks out every new `live`
commit and runs whatever its root holds with the Workers Builds API token:
`pnpm install` per its `package.json` and `pnpm-workspace.yaml`
(lifecycle scripts included, if a `package.json` declared any), then the
deploy command with its `wrangler.jsonc`. So **write access to `live` is
deploy access to starboard.c65llc.com**, and to whatever else that token
can reach.

`publish`'s guards (the allow-list, no `scripts`, `./public`, no `.git*`)
cover only the path through this workflow. Anyone who can push to `live`
another way (a maintainer with push access, or another workflow holding
`contents: write`) bypasses them.

- **Ruleset (optional, not set up).** We have not put a ruleset on `live`.
  If you want one, add a branch ruleset targeting `live` with **Restrict
  updates**, and add GitHub Actions (`github-actions[bot]`) as its only
  bypass actor, so only workflow pushes can move it (check the bot can be
  chosen as a bypass actor on this plan before relying on it). It must
  still allow the bot's forced push: no ruleset may block force pushes
  for the bot, and the `main` ruleset must stay off `live` (see
  "`live` must accept the bot's force-push" under
  [the release order](#the-first-publish-release-order)).
- **Narrow the token.** Workers Builds creates an API token for the build
  by default. In **Settings → Builds → API token** you can instead select a
  user token you created with only what a deploy needs: Account → Workers
  Scripts → Edit on this account, and Zone → Workers Routes → Edit and
  Zone → Read on `c65llc.com`.

### What moves `live`

Only these move `live` (and so deploy it), and nothing else:

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

A tag cut before Workers Builds took over the deploy (before
`website/deploy/wrangler.jsonc` existed) **cannot be republished by
dispatch**: `publish` refuses it for the missing deploy files. Publish a
newer release instead.

**A failed deploy** (the `Publish site` run is green, but the Cloudflare
build failed): read its log in Cloudflare (Workers & Pages → `starboard` →
Deployments → View build history), fix the cause, and **retry that build**
there (from the build's menu), which deploys `live`'s current head again, or
deploy by hand (below). Running **Publish site**
again does not help: the tree is unchanged, so it pushes nothing and
Cloudflare has nothing new to build.

**By hand, from a maintainer's machine** (when Workers Builds is
unavailable), deploy exactly what `live` holds; its tree is a complete
Wrangler project (Node 24, pnpm through corepack):

```bash
git fetch origin live
d=$(mktemp -d)
git archive origin/live | tar -x -C "$d"
cd "$d"
test -f public/index.html && test -f public/404.html && test -f public/_headers
pnpm install --frozen-lockfile
pnpm exec wrangler login    # or export CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
pnpm exec wrangler deploy
cd - && rm -rf "$d"
```

To take the site back to an earlier build, use the Worker's
**Deployments** tab in Cloudflare (Workers & Pages → `starboard` →
Deployments) to roll back to an earlier version, then fix forward with a
fixed release. Dispatching an older tag is refused by design (the tag must be
the newest stable release), and `live` keeps no history to revert to. Nobody
pushes to `live` by hand. Note that the next deploy replaces a rollback.

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
5. Set up Cloudflare (below). Connect the custom domain only after
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

### Cloudflare setup (once, by a human)

The `starboard` Worker already exists and serves the custom domain
`starboard.c65llc.com` (`workers.dev` off). Connect it to `live`:

1. In the Cloudflare dashboard, open **Workers & Pages → `starboard` →
   Settings → Builds**, and **Connect** a Git repository.
2. Choose GitHub and the repository **`c65llc/starboard`** (install or
   authorise the Cloudflare GitHub app for it if asked; it needs this
   repository only). Set the **production branch** to **`live`**.
3. **Build command:** leave it **empty**. Cloudflare builds nothing.
4. **Deploy command:** `npx --no wrangler deploy`. Plain `npx wrangler
   deploy` (the default) also uses the wrangler the lockfile installed, but
   if that install were ever skipped it would silently download the newest
   wrangler instead; `--no` makes it fail.
5. **Root directory:** leave it as **`/`** (the root of `live`, where
   `wrangler.jsonc` is).
6. **Non-production branch builds:** turn them **off**. Only `live` is ever
   deployed; `main` and PR branches have no `wrangler.jsonc` at their root.
7. **API token:** the default Cloudflare creates for the build works; a
   narrower one is better (see [Who can deploy](#who-can-deploy)).
8. **Build variables:** at most one, `WRANGLER_SEND_METRICS` = `false`
   (stops wrangler sending usage metrics, as the old GitHub deploy did).
   Set nothing else: the Node version comes from `.nvmrc` and the pnpm
   version from `package.json`'s `packageManager` in `live`. In particular
   do not set `SKIP_DEPENDENCY_INSTALL`, `NODE_VERSION` or `PNPM_VERSION`.

The Worker's name in the dashboard must equal `name` in
[`website/deploy/wrangler.jsonc`](../website/deploy/wrangler.jsonc)
(`starboard`), or every build fails.

The next new `live` commit is the first one Workers Builds deploys. The
first `live` with the new layout (`wrangler.jsonc` at its root, the site in
`public/`) comes from the first **Publish site** run after this change
merges, so connect the Worker before that run (or retry its build
afterwards). A `live` from before the change (the site at its root, no
`wrangler.jsonc`) cannot be deployed by Workers Builds; until the first new
publish, the site keeps serving its current deployment. Connecting may
start a build of that old-layout `live` straight away: it fails (no
`wrangler.jsonc`, no `package.json`) without deploying anything, which is
harmless; ignore it.

#### First-build checklist

Read the log of the first Workers Build of a new-layout `live` (Deployments
→ View build history → the build) and check:

- [ ] Node is the version in `website/.nvmrc` (24.22.3 today), not the
      image default;
- [ ] pnpm is **12.23.0** (from `packageManager`), not the image's 9.10.0;
- [ ] the install did not resolve anything: it reports `Lockfile is up to
      date, resolution step is skipped` (or ran with `--frozen-lockfile`),
      and does not rewrite `pnpm-lock.yaml`;
- [ ] the deploy ran **wrangler 4.167.0** (the version the lockfile pins);
- [ ] the deploy succeeded, and the site passes
      [the checks below](#after-a-release-check-the-site).

There is no GitHub side to set up. The `cloudflare-prod` environment,
its `CLOUDFLARE_API_TOKEN` secret and `CLOUDFLARE_ACCOUNT_ID` variable, and
the Cloudflare API token they held are no longer used. **Only after the
checklist above passes**, delete the environment (**Settings →
Environments**) and roll or delete the token in Cloudflare (**My Profile →
API Tokens**); until then, keep them in case you must go back to the
GitHub-side deploy.

Every later publish replaces `live`'s single commit (a forced update), and
Cloudflare deploys it. GitHub holds no Cloudflare credential; Cloudflare
reads `live` through its GitHub app.

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
