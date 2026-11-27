# Marketing website design

Status: proposed, not implemented. Target: https://starboard.c65llc.com.

## Positioning

**One reference. Every platform.**

Keep canonical screen layouts and user flows as plain text in your repository. Starboard gives each platform a shared reference and helps CI detect when implementation and specification disagree.

Audience: cross-platform product teams, maintainers and developers working with coding agents. Starboard is a CLI and local-first PWA editor, not a runtime UI framework or code generator.

## Page structure

1. **Navigation:** dark navy bar; logo left, Features, Workflow, Platforms, Docs, GitHub and mint Get Started action right. Mobile uses a compact accessible menu.
2. **Hero:** midnight background, oversized white headline, two-line supporting copy above, mint Get Started and outlined View on GitHub buttons. On the right, overlapping desktop, tablet and phone frames depict the same screen adapted to each platform. A subtle layered teal coastline anchors the bottom. Label artwork illustrative, not product screenshots.
3. **Features:** three columns on sea mist, with teal line icons: stacked layers, navigation star, lightning/check. Headings: “A shared reference”, “Consistent across platforms”, “Catch drift in CI”. Explain screen registry and stable IDs, flow documents and generated grey-box wireframes, formatter/linter with stable rule IDs and JSON output.
4. **Workflow:** pale mint rounded panel with numbered steps: **Define** — record screens, regions and flows as text; **Adapt** — implement the reference on each platform and link source files; **Verify** — lint in CI and review generated catalogs and app maps. Arrows between steps on desktop; vertical stack on mobile.
5. **Platforms:** headline “One product. Multiple platforms.” Four soft-tinted tiles: iOS, Android, Web, Desktop. Explain these are product target platforms, distinct from CLI hosts (macOS, Linux, Windows; amd64 and arm64).
6. **Developer experience:** dark terminal panel alongside heading “Built for your repository.” Show the lint command below, describe agent skills, and link to the docs. Avoid invented Swift APIs or unsupported runtime claims.
7. **Final CTA:** dark coastal illustration with lighthouse and a restrained beam; headline “Give every platform a shared reference.” Supporting copy: “Open source. Plain text. Built for your repository.” Repeat install and GitHub actions.
8. **Footer:** brand, documentation, repository, releases, license (AGPL-3.0-only), C65 LLC.

## Example terminal panel

```sh
starboard version
starboard lint
```

Use verified CLI commands only. During pre-release, link Get Started to repository installation instructions and clearly label release status; switch to published installation docs once available. GitHub: https://github.com/c65llc/starboard. Releases: https://github.com/c65llc/starboard/releases.

## Layout and visual system

- Desktop max content width 1200px; horizontal gutters 32px desktop, 20px mobile. Use a 12-column grid with 24px gaps.
- Hero two columns, roughly 45/55; headline 56–64px desktop and 36–42px mobile, body 18–20px. Section headings 32–40px; body 16–18px.
- Spacing scale 4/8/12/16/24/32/48/64/96px. Section padding 64–96px desktop, 40–56px mobile. Cards 16–20px radius; buttons 10px radius.
- Use the brand palette, generous whitespace, simple line icons, restrained flat coastal shapes. Keep the lighthouse confined to the closing CTA. Terminal is dark with readable monospace text.
- At widths below 768px, stack hero content above artwork, features and workflow vertically, platform tiles two per row, terminal and copy vertically. Avoid horizontal scrolling at 320px.
- Navigation anchors: #features, #workflow, #platforms. Docs and install links must resolve before launch.
- Use semantic landmarks, one H1, logical heading order, keyboard-operable menu, visible focus, accessible button labels, reduced-motion support, and WCAG AA contrast. Decorative scenery is hidden from assistive technology; meaningful diagrams have text alternatives.

## Launch checklist

- [ ] Validate product copy against README and current release.
- [ ] Confirm docs/install URLs and release status.
- [ ] Implement responsive layout and test 320, 768, 1024 and 1440px widths.
- [ ] Verify keyboard navigation, contrast and reduced motion.
- [ ] Optimize artwork; add favicon and social preview.
- [ ] Verify metadata, page title, canonical URL and links.

The initial visual concept used an Apple-centric platform row and a fictional Swift layout API. Those are intentionally replaced here to match the actual product. The visual composition and nautical identity are retained. This is a design specification rather than a deployed website.
