# Starboard's documentation

The pages under `getting-started/`, `concepts/`, `reference/`, `guides/` and
`rules/` are the source of the docs at <https://starboard.c65llc.com/>, which
`website/scripts/sync-content.sh` copies in at build time. Read them there.

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

The other directories here (`brand/`, `plans/`, `specs/` and `releasing.md`)
are for the people who build Starboard, are not published, and link with
ordinary repository paths.
