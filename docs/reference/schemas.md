---
title: JSON Schemas
description: The JSON Schemas for starboard.yaml and screens.yaml, where to get them, and how to use them in an editor.
---

Starboard publishes a JSON Schema (draft 2020-12) for each of its two YAML
files. An editor with a YAML language server uses them for completion,
hover text and errors as you type.

| File | Schema |
| --- | --- |
| `starboard.yaml` | `https://starboard.c65llc.com/schema/v1/config.json` |
| `screens.yaml` | `https://starboard.c65llc.com/schema/v1/screens.json` |

Each URL is also the schema's `$id`. The binary carries the same files, so
`starboard schema` prints the schema of the release you run, with no
network:

<!-- verified: empty -->
```bash
starboard schema config
starboard schema screens
```

To download them, open the URLs above:
[config.json](https://starboard.c65llc.com/schema/v1/config.json) and
[screens.json](https://starboard.c65llc.com/schema/v1/screens.json).

## In an editor

With the YAML language server (used by the YAML extension for VS Code, and
by many other editors), a comment on the first line of the file picks the
schema:

```yaml
# yaml-language-server: $schema=https://starboard.c65llc.com/schema/v1/screens.json
screens:
  trip.timeline:
    title: Timeline
```

`starboard fmt` keeps comments, so the line stays.

## What the schemas check

The schemas accept what Starboard accepts wherever JSON Schema can say so:
keys, types, required fields, the region kinds and presentations, and
which fields go with which kinds. Rules that need the whole project, such
as unique region names, links to registered screens or a `width` fraction
no greater than one, are left to `starboard lint`, so a file that passes
its schema can still have lint errors.

The `v1` in the URLs is the format version, the `version: 1` at the top of
`starboard.yaml`. A format change that breaks existing files would get new
URLs.
