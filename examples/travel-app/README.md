# travel-app — an example Starboard project

A small trip-planning app: ten screens on iOS, Android and the web, a
`requires` vocabulary (`permissions.yaml`) and four flows, among them
`add-activity`, a five-step flow whose every step names a screen region.

The web app opens it from **Explore the example project**, bundled at build
time. It is kept clean under `starboard lint --strict`, which `make
example-lint` (part of `make ci`) checks:

```sh
go build -o bin/starboard ./cmd/starboard
bin/starboard --dir examples/travel-app lint --strict
```

After changing `screens.yaml` or a flow, run `starboard fmt` and
`starboard generate` here so the generated pages stay current.
