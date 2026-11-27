---
title: schema-invalid
description: screens.yaml breaks the registry schema, such as a missing required field, an unknown key or a value of the wrong type.
---

## What it catches

`screens.yaml` is valid YAML, but something in it is not what the registry
schema allows. Among them:

- A screen without `title`, `area` or `presentation`, or with a key a screen
  does not have.
- A `status` that is not `shipped` or `proposed`, or a mapping of platform to
  one of those.
- A region without `kind`, or without `region` (a list's `item`, its `empty`
  and a navigation region's `items` entries need no name).
- `children` on anything but `column`, `row`, `section` or `bar`; `item` or
  `empty` on anything but `list`; `items` on anything but `tabs`, `nav` or
  `menu`.
- A `width` that is not a positive integer or a fraction no greater than 1,
  such as `"1/3"`.
- An `unmapped` entry without both `path` and `reason`.
- A key Starboard does not know, the same key written twice, or a value of
  the wrong type.

Each problem is reported at its line, and the rest of the file is still read.
Some schema problems have rules of their own: [id-invalid](../id-invalid/),
[duplicate-screen](../duplicate-screen/),
[duplicate-region](../duplicate-region/), [unknown-kind](../unknown-kind/)
and [unknown-presentation](../unknown-presentation/).

## Why it matters

The registry is what the generated pages, the wireframes and every other check
are built from. A field Starboard cannot read is a field missing from all of
them. This is a correctness rule: it is always an error.

## How to fix

Correct the key or value the message names. `starboard schema screens` prints
the JSON Schema for `screens.yaml`; point your editor's YAML support at it to
catch these as you type.

## Example

The screen has no `presentation`:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    layout:
      - {region: title, kind: text, label: Trip name}
```

Say how the screen is presented:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: title, kind: text, label: Trip name}
```
