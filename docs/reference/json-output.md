---
title: JSON output and rules
description: The versioned JSON reports of starboard lint --json and starboard rules --json, and the list of every rule ID.
---

`starboard lint --json` and `starboard rules --json` print one JSON document
each, for CI annotations, editors and coding agents. Both carry
`"version": 1`; a change that breaks a reader will bump it. Rule IDs are
stable strings, so act on the `rule`, not on the wording of the `message`.

## `lint --json`

A project with a problem in each of three rules, and its generated pages
up to date:

<!-- verified-file: empty starboard.yaml -->
```yaml
version: 1
platforms:
  ios:
    formFactors: [phone]
areas: [trip]
```

<!-- verified-file: empty docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: root
    layout:
      - { region: add, kind: primary-action, label: Add activity, to: activity.add }
```

<!-- verified: empty -->
```bash
starboard generate
```

The text report, one finding per line and then the count:

<!-- verified: empty exit 1 -->
```bash
starboard lint
```

<!-- output -->
```text
docs/flows/screens.yaml: error not-formatted: docs/flows/screens.yaml is not in canonical form
docs/flows/screens.yaml:2: warn missing-purpose: trip.timeline has no purpose; say in a sentence what the screen is for (screens.trip.timeline.purpose)
docs/flows/screens.yaml:2: warn orphan-screen: no flow references trip.timeline (screens.trip.timeline)
docs/flows/screens.yaml:7: error edge-unresolved: to activity.add is not a registered screen (screens.trip.timeline.layout[0])
2 errors, 2 warnings
```

The same findings as JSON:

<!-- verified: empty exit 1 -->
```bash
starboard lint --json
```

<!-- output -->
```json
{
  "version": 1,
  "errors": [
    {
      "rule": "not-formatted",
      "severity": "error",
      "file": "docs/flows/screens.yaml",
      "path": "",
      "message": "docs/flows/screens.yaml is not in canonical form",
      "fix": {
        "description": "run starboard fmt"
      },
      "docs": "https://starboard.c65llc.com/rules/not-formatted/"
    },
    {
      "rule": "edge-unresolved",
      "severity": "error",
      "file": "docs/flows/screens.yaml",
      "path": "screens.trip.timeline.layout[0]",
      "line": 7,
      "message": "to activity.add is not a registered screen",
      "docs": "https://starboard.c65llc.com/rules/edge-unresolved/"
    }
  ],
  "warnings": [
    {
      "rule": "missing-purpose",
      "severity": "warn",
      "file": "docs/flows/screens.yaml",
      "path": "screens.trip.timeline.purpose",
      "line": 2,
      "message": "trip.timeline has no purpose; say in a sentence what the screen is for",
      "docs": "https://starboard.c65llc.com/rules/missing-purpose/"
    },
    {
      "rule": "orphan-screen",
      "severity": "warn",
      "file": "docs/flows/screens.yaml",
      "path": "screens.trip.timeline",
      "line": 2,
      "message": "no flow references trip.timeline",
      "docs": "https://starboard.c65llc.com/rules/orphan-screen/"
    }
  ]
}
```

`errors` and `warnings` are always arrays, empty when there is nothing to
report, and sorted by file, then line. Each finding has:

| Field | Value |
| --- | --- |
| `rule` | The rule's ID. |
| `severity` | `error` or `warn`. |
| `file` | The file, relative to the project root, with `/`. |
| `path` | Where in the file: a dotted path into the YAML, such as `screens.trip.timeline.layout[0]`, or `""` for the whole file. |
| `line` | The 1-based line, when there is one; left out otherwise. |
| `message` | What is wrong, in a sentence. |
| `fix` | When Starboard can fix it: `{"description": …}`, saying how. `starboard lint --fix` applies the fixes for formatting and generated pages. |
| `docs` | The rule's page: `https://starboard.c65llc.com/rules/<rule>/`. |

The exit status is the same as without `--json`: 1 when there is an error,
or a warning under `--strict`. With `--fix`, the list of files it wrote
goes to stderr, so stdout stays one JSON document.

## `rules --json`

```json
{
  "version": 1,
  "rules": [
    {
      "id": "config-invalid",
      "kind": "correctness",
      "default": "error",
      "summary": "starboard.yaml breaks the config schema, such as a missing version, an unknown key or a value of the wrong type.",
      "docs": "https://starboard.c65llc.com/rules/config-invalid/"
    }
  ]
}
```

Each rule has its `id`; its `kind`, `correctness` or `quality`; its
`default` severity; a one-sentence `summary`; and its `docs` page. Rules
are sorted by ID.

## Rules

Correctness rules are always errors. Quality rules default to `warn` (and
pass `lint` unless you use `--strict`); `lint.rules` in `starboard.yaml`
can make one an `error` or turn it `off`. Each rule's page says what it
catches, why it matters and how to fix it.

<!-- verified: empty -->
```bash
starboard rules
```

<!-- output -->
```text
RULE                       KIND         DEFAULT  SUMMARY
config-invalid             correctness  error    starboard.yaml breaks the config schema, such as a missing version, an unknown key or a value of the wrong type.
deep-nesting               quality      warn     A layout nests regions deeper than the limit, 5 levels by default.
duplicate-edge             quality      warn     Two links to the same screen sit under the same parent in one layout.
duplicate-region           correctness  error    A region name is used twice in one layout tree.
duplicate-screen           correctness  error    screens.yaml defines the same screen ID twice.
edge-parity                quality      warn     A form factor's layout override drops a link that the default layout has.
edge-platform-mismatch     correctness  error    A to link joins two screens that share no platform, and the linking node has no platformNote.
edge-unresolved            correctness  error    A to link names a screen that is not registered.
file-missing               correctness  error    A platform root, or a file a screen claims on a platform where it is not proposed, does not exist.
flow-frontmatter-invalid   correctness  error    A flow's front matter is missing, never closed, or breaks the flow schema.
flow-id-mismatch           correctness  error    A flow's id does not match its file name.
flow-ref-not-in-diagram    quality      warn     A flow refers to a screen that its Mermaid diagram does not show.
generated-stale            correctness  error    A file starboard generate owns is out of date, missing, or no longer generated.
id-invalid                 correctness  error    A screen ID or a region name does not have the required form.
label-too-long             quality      warn     A region or nav item label is longer than the limit, 40 characters by default.
missing-purpose            quality      warn     A screen has no purpose.
not-formatted              correctness  error    A source file is not in the canonical form starboard fmt writes.
orphan-screen              quality      warn     No flow references a screen.
path-invalid               correctness  error    A path or pattern in starboard.yaml or screens.yaml is not a relative path inside the project.
platform-note-missing      correctness  error    A screen on only some of the configured platforms has no platformNote saying why.
ref-unresolved             correctness  error    A flow's entry or @ reference names a screen or region that does not exist.
schema-invalid             correctness  error    screens.yaml breaks the registry schema, such as a missing required field, an unknown key or a value of the wrong type.
screenshot-missing         correctness  error    A screenshot named in screens.yaml does not exist.
shipped-flow-proposed-ref  correctness  error    A shipped flow refers to a screen or region that is proposed on one of the flow's platforms.
status-conflict            correctness  error    A region or nav item says shipped under a screen that is proposed.
step-without-ref           quality      warn     A flow step has no @screen reference saying where it happens.
unknown-area               correctness  error    A screen's area is not listed under areas in starboard.yaml.
unknown-form-factor        correctness  error    A platform or a layout override names a form factor that is not defined.
unknown-kind               correctness  error    A region's kind is not one of the kinds the renderer knows.
unknown-platform           correctness  error    A screen names a platform that starboard.yaml does not configure.
unknown-presentation       correctness  error    A screen's presentation is not root, push, tab, sheet, dialog, window or route.
unmapped-and-claimed       correctness  error    A file is listed under unmapped and also claimed by a screen.
unreachable-screen         quality      warn     No other screen links to a screen, it is not presentation root, and no flow starts there.
unregistered-screen-file   correctness  error    A file matching a platform's screenFiles is claimed by no screen and not listed under unmapped.
vocabulary-source-invalid  correctness  error    A vocabulary in starboard.yaml cannot be used, because its field is unsupported, its file cannot be read or its selector does not apply.
vocabulary-unknown         correctness  error    A requires value is not in the project's requires vocabulary.
yaml-alias-not-allowed     correctness  error    A YAML file or a flow's front matter uses an anchor, an alias or a merge key.
yaml-syntax                correctness  error    starboard.yaml or screens.yaml cannot be read as one YAML document.
```

The pages, by rule:
[config-invalid](../../rules/config-invalid/),
[deep-nesting](../../rules/deep-nesting/),
[duplicate-edge](../../rules/duplicate-edge/),
[duplicate-region](../../rules/duplicate-region/),
[duplicate-screen](../../rules/duplicate-screen/),
[edge-parity](../../rules/edge-parity/),
[edge-platform-mismatch](../../rules/edge-platform-mismatch/),
[edge-unresolved](../../rules/edge-unresolved/),
[file-missing](../../rules/file-missing/),
[flow-frontmatter-invalid](../../rules/flow-frontmatter-invalid/),
[flow-id-mismatch](../../rules/flow-id-mismatch/),
[flow-ref-not-in-diagram](../../rules/flow-ref-not-in-diagram/),
[generated-stale](../../rules/generated-stale/),
[id-invalid](../../rules/id-invalid/),
[label-too-long](../../rules/label-too-long/),
[missing-purpose](../../rules/missing-purpose/),
[not-formatted](../../rules/not-formatted/),
[orphan-screen](../../rules/orphan-screen/),
[path-invalid](../../rules/path-invalid/),
[platform-note-missing](../../rules/platform-note-missing/),
[ref-unresolved](../../rules/ref-unresolved/),
[schema-invalid](../../rules/schema-invalid/),
[screenshot-missing](../../rules/screenshot-missing/),
[shipped-flow-proposed-ref](../../rules/shipped-flow-proposed-ref/),
[status-conflict](../../rules/status-conflict/),
[step-without-ref](../../rules/step-without-ref/),
[unknown-area](../../rules/unknown-area/),
[unknown-form-factor](../../rules/unknown-form-factor/),
[unknown-kind](../../rules/unknown-kind/),
[unknown-platform](../../rules/unknown-platform/),
[unknown-presentation](../../rules/unknown-presentation/),
[unmapped-and-claimed](../../rules/unmapped-and-claimed/),
[unreachable-screen](../../rules/unreachable-screen/),
[unregistered-screen-file](../../rules/unregistered-screen-file/),
[vocabulary-source-invalid](../../rules/vocabulary-source-invalid/),
[vocabulary-unknown](../../rules/vocabulary-unknown/),
[yaml-alias-not-allowed](../../rules/yaml-alias-not-allowed/),
[yaml-syntax](../../rules/yaml-syntax/).
