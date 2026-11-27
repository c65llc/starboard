---
title: starboard.yaml
description: Every setting in a project's starboard.yaml - platforms, form factors, vocabularies, areas and lint severities.
---

`starboard.yaml` sits at the project root and configures the project. Its
JSON Schema is `https://starboard.c65llc.com/schema/v1/config.json` (see
[JSON Schemas](../schemas/)), and a problem with it is reported as
[config-invalid](../../rules/config-invalid/).

A complete example, from `examples/travel-app`:

```yaml
version: 1
platforms:
  ios:
    formFactors: [phone]
    roots: [src/ios/Screens]
    screenFiles: ["**/*View.swift"]
  android:
    formFactors: [phone]
    roots: [src/android]
    screenFiles: ["*Screen.kt"]
  web:
    formFactors: [web-narrow, web-wide]
    roots: [src/web/routes]
    screenFiles: ["**/+page.svelte"]
vocabularies:
  requires:
    file: capabilities.json
    select: .capabilities[].name
areas: [auth, home, trip, activity, sharing, settings]
```

## Top-level keys

| Key | Required | Value |
| --- | --- | --- |
| `version` | yes | `1`, the format version this Starboard reads. |
| `content` | no | The content root, relative to the project root. Default `docs/flows`. |
| `platforms` | no | The platforms, keyed by name. See [platforms](#platforms). |
| `formFactors` | no | Changes to the built-in form factors, and new ones. See [formFactors](#formfactors). |
| `vocabularies` | no | Lists, kept elsewhere in the project, that a registry field's values must come from. See [vocabularies](#vocabularies). |
| `areas` | no | The product areas, in the order generated pages list them. Each screen's `area` must be one ([unknown-area](../../rules/unknown-area/)). |
| `lint` | no | Quality rule severities and limits. See [lint](#lint). |

Keys are written in this order; `starboard fmt` puts them back in it.

## platforms

Each key is a platform name: lowercase letters, digits and hyphens,
starting with a letter. Each value may be empty (`cli: {}`) or set:

| Key | Value |
| --- | --- |
| `formFactors` | The form factors this platform's screens are drawn at. Each must be built in or defined under `formFactors` ([unknown-form-factor](../../rules/unknown-form-factor/)). |
| `roots` | Directories, relative to the project root, that hold this platform's screen code. Each must exist ([file-missing](../../rules/file-missing/)). |
| `screenFiles` | Patterns, matched relative to each root, for the files that are screens. |

`screenFiles` patterns use doublestar syntax: `**` matches any number of
directories, `*` matches within one name, and `{a,b}` matches either.
`**/*View.swift` matches every `View.swift` file under the root;
`*Screen.kt` only those directly in it. With `roots` and `screenFiles`,
every matching file must be claimed by a screen or listed under `unmapped`
([unregistered-screen-file](../../rules/unregistered-screen-file/)).

The order of the platforms is the order Starboard lists them in, and a
screen's first platform's first form factor is the one `starboard render`
draws by default.

## formFactors

Each key is a form factor name, and its value sets both `width` and
`height`, positive integers in points:

```yaml
formFactors:
  phone:
    width: 393
    height: 852
```

The built-in form factors are `phone` (390 × 844), `tablet` (820 × 1180),
`desktop` (1280 × 800), `web-narrow` (390 × 844) and `web-wide`
(1440 × 900). A key that names one of them changes its size; any other key
adds a form factor.

## vocabularies

A vocabulary checks a registry field's values against a list the project
already keeps, such as a generated list of permissions. Today the only
field it can check is `requires`
([vocabulary-unknown](../../rules/vocabulary-unknown/)).

| Key | Value |
| --- | --- |
| `file` | A `.json`, `.yaml` or `.yml` file, relative to the project root. |
| `select` | Which values in the file are allowed. |

`select` is a chain of `.key` field accesses and `[]` array iterations,
and nothing else. With the travel app's `capabilities.json`:

```json
{
  "capabilities": [
    { "name": "viewTrip", "about": "See the trip's days, places and people." },
    { "name": "editLogistics", "about": "Add, change and remove activities and tasks." }
  ]
}
```

`.capabilities[].name` selects `viewTrip` and `editLogistics`. Every value
the selector reaches must be a string. A vocabulary that cannot be used is
reported as [vocabulary-source-invalid](../../rules/vocabulary-source-invalid/).

## lint

```yaml
lint:
  rules:
    orphan-screen: off
    missing-purpose: error
  limits:
    label-too-long: 32
```

`rules` sets the severity of a quality rule to `error`, `warn` or `off`.
The quality rules are `deep-nesting`, `duplicate-edge`, `edge-parity`,
`flow-ref-not-in-diagram`, `label-too-long`, `missing-purpose`,
`orphan-screen`, `step-without-ref` and `unreachable-screen`; each one's
page gives its default. Correctness rules are always errors, and naming one
here is a `config-invalid` error.

`limits` sets the two rules' thresholds, as positive integers:

| Limit | Default | Meaning |
| --- | --- | --- |
| `label-too-long` | 40 | The longest a region or navigation item `label` may be, in characters. |
| `deep-nesting` | 5 | The deepest a layout may nest regions. |

## areas

```yaml
areas: [auth, home, trip, activity, sharing, settings]
```

Each area is one line of text, listed once. The generated catalog and app
map group screens by area in this order.
