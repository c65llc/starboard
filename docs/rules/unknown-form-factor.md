---
title: unknown-form-factor
description: A platform or a layout override names a form factor that is not defined.
---

## What it catches

A form factor name that is neither built in nor defined under `formFactors`
in `starboard.yaml`. The built-in form factors are `phone`, `tablet`,
`desktop`, `web-narrow` and `web-wide`. It is checked in two places:

- a platform's `formFactors` list in `starboard.yaml`;
- the keys of a screen's `layouts` overrides in `screens.yaml`.

## Why it matters

A form factor is a viewport size: the wireframes are drawn at it. A platform
that names an unknown one has nothing to draw, and a layout override keyed by
an unknown one is never drawn or checked, so the override is dead text.
This is a correctness rule: it is always an error.

## How to fix

Correct the name to a defined form factor, or define it in `starboard.yaml`
with its size in points:

```yaml
formFactors:
  watch: {width: 198, height: 242}
```

## Example

The override is keyed by a form factor nobody defined:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: title, kind: header, label: Trip name}
    layouts:
      wide:
        - {region: title, kind: header, label: Trip name · dates}
```

Key it by the form factor the web platform uses:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: title, kind: header, label: Trip name}
    layouts:
      web-wide:
        - {region: title, kind: header, label: Trip name · dates}
```
