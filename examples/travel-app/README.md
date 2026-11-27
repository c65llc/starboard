# travel-app — an example Starboard project

An invented trip-planning app for iOS, Android and the web: 21 screens in six
areas (`auth`, `home`, `trip`, `activity`, `sharing`, `settings`) and eight
flows. It shows:

- three platforms, each with `roots` and `screenFiles` for reverse coverage,
  and `files` pointing at the empty placeholder sources under `src/`;
- a `requires` vocabulary read from `capabilities.json`;
- a proposed screen (`trip.packing`), a proposed region that leads to it
  (`trip.checklist#packing`), and a per-platform status (`sharing.invite`
  is shipped on iOS and the web and proposed on Android);
- a screen on only some platforms, with its `platformNote`
  (`settings.account`);
- a `web-wide` override that turns `trip.timeline`'s tab bar into a `nav`
  sidebar inside a `row`, with a map beside it;
- flows with a goal, a Mermaid diagram, numbered steps whose every item
  names a screen or region, branches and platform adaptations. Among them is
  `add-activity`, a five-step flow.

The web app opens it from **Explore the example project**, bundled at build
time. It is kept clean under `starboard lint --strict`, which `make
examples-check` (part of `make ci`) checks:

```sh
go build -o bin/starboard ./cmd/starboard
bin/starboard --dir examples/travel-app lint --strict
```

After changing `screens.yaml` or a flow, run `starboard fmt` and
`starboard generate` here so the generated pages stay current.
