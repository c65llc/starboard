---
title: vocabulary-source-invalid
description: A vocabulary in starboard.yaml cannot be used, because its field is unsupported, its file cannot be read or its selector does not apply.
---

## What it catches

A vocabulary under `vocabularies` in `starboard.yaml` that Starboard cannot
turn into a list of allowed values:

- It is keyed by a field other than `requires`, the only registry field a
  vocabulary can validate today.
- Its `file` does not exist, cannot be read, is not a `.json`, `.yaml` or
  `.yml` file, or is not valid JSON or YAML.
- Its `select` is empty or uses syntax beyond `.field` and `[]`, chained.
- The selector does not fit the file: it names a field the file does not
  have, iterates something that is not an array, or selects a value that is
  not a string.

A `file` that is not a valid project path is reported as
[path-invalid](../path-invalid/) instead.

## Why it matters

A vocabulary keeps `requires` values in step with a list the project already
maintains, such as a generated list of capabilities. When the list cannot be
read, no `requires` value is checked at all, so typos slip through. This is
a correctness rule: it is always an error.

## How to fix

Point `file` at the list, relative to the project root, and write a selector
that reaches its strings: `.capabilities[].name` takes the `name` of each
entry of the top-level `capabilities` array. The selector is not jq; only
field access and array iteration are supported.

## Example

The project's capabilities are listed in `caps.json`:

<!-- given: caps.json -->
```json
{"capabilities": [{"name": "viewTrip"}, {"name": "editLogistics"}]}
```

The selector asks for a field the entries do not have:

<!-- example: starboard.yaml -->
```yaml
version: 1
platforms:
  ios:
    formFactors: [phone]
vocabularies:
  requires:
    file: caps.json
    select: .capabilities[].id
areas: [trip]
```

<!-- fixed: starboard.yaml -->
```yaml
version: 1
platforms:
  ios:
    formFactors: [phone]
vocabularies:
  requires:
    file: caps.json
    select: .capabilities[].name
areas: [trip]
```
