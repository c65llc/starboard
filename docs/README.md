# Starboard's documentation

The pages under `getting-started/`, `concepts/`, `reference/`, `guides/` and
`rules/` are the source of the docs at <https://starboard.c65llc.com/>, which
`website/scripts/sync-content.sh` copies into Sagegrouse's `<slug>/index.md`
layout at build time. Read them there.

## Website content

Edit the homepage metadata and intro in
[`website/content/site/landing/index.md`](../website/content/site/landing/index.md).
Blog posts use `website/src/content/docs/blog/<slug>/index.md`. The guides,
rules and reference pages are edited here in `docs/`. Sagegrouse validates
the published front matter before Astro builds or starts the dev server.
Run `pnpm exec sagegrouse check` from `website/` to recheck synced content.

## Starboard's own design reference

Run `make design-check` to check the website and web app's design data.
[Airframe's source tokens](../design-system/) generate the landing page's
button dimensions. [Gantry's ledger](design/generated/ledger.md) tracks
the navigation ruling and its test evidence. [Starboard's screen
catalog](flows/generated/screens.md) shows the website and web app
screens, and [the flows](flows/flows/) record their navigation.

## Links between pages are site links

A link from one page to another is written as the site's URL for it,
relative to the page's own URL: `install.md` is served at
`/getting-started/install/`, so it links to the first-project page as
`../first-project/` and to the CLI reference as `../../reference/cli/`.

Those links resolve on the site, and the site build checks every one of them
(`website/scripts/check-links.mjs`). They do not resolve when you read the
Markdown on GitHub, where `../first-project/` names a directory that does not
exist. That is deliberate: one form of link, checked in one place, rather
than `.md` paths the site would have to rewrite. On GitHub, open the page of
the same name in the same section, or use the site.

The project materials in `brand/`, `design/`, `flows/`, `plans/`,
`specs/` and `releasing.md` use ordinary repository paths.
