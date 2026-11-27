# desktop-notes — an example Starboard project

An invented note-taking app for macOS, Windows and the web: seven screens
and four flows. It shows:

- the `desktop` form factor on two desktop platforms and `web-wide` on the
  web;
- `window` presentations: the main window, a note opened in a window of its
  own, and a preferences window on the desktop platforms only;
- a three-pane `row` layout in `library.main`: a `nav` of notebooks, the list
  of notes, and the editor;
- a `dialog` (`notes.delete`, `notebooks.new`) and a `sheet`
  (`sharing.share`, `notes.export`);
- reverse coverage with `roots` and `screenFiles`, and an `unmapped` screen
  file with its reason;
- a per-platform status (`notes.export` is proposed on the web) and a flow
  limited to some platforms with `platforms` in its front matter.

It is kept clean under `starboard lint --strict`, which `make
examples-check` (part of `make ci`) checks:

```sh
go build -o bin/starboard ./cmd/starboard
bin/starboard --dir examples/desktop-notes lint --strict
```

After changing `screens.yaml` or a flow, run `starboard fmt` and
`starboard generate` here so the generated pages stay current.
