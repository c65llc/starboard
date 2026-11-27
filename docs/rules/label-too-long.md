---
title: label-too-long
description: A region or nav item label is longer than the limit, 40 characters by default.
---

## What it catches

A `label` on a region, or on an entry in a navigation region's `items`,
longer than the limit: 40 characters by default. Characters are counted as
Unicode code points, so `·` and `é` count as one each.

## Why it matters

A label says what the content is, not its final copy: "Time · activity ·
attendance", not the sentence the app will show. Long labels are usually
real copy pasted in, which goes stale as the app's wording changes, and they
do not fit in a wireframe's region, so the drawing truncates them.

## How to fix

Shorten the label to the few words that say what goes there. Put the
reasoning in the screen's `purpose`, or in a flow.

## Example

The empty-state label is the app's whole sentence:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: root
    layout:
      - region: hint
        kind: banner
        label: You have no activities yet. Tap Add to plan your first day.
```

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: root
    layout:
      - {region: hint, kind: banner, label: No activities yet}
```

## Configuration

`label-too-long` is a quality rule. Its default severity is `warn`: lint reports it,
and `starboard lint` still passes unless you run it with `--strict`. Change
its severity under `lint.rules` in `starboard.yaml` to `error`, `warn` or
`off`:

```yaml
lint:
  rules:
    label-too-long: off
```

The limit is set under `lint.limits`, as a positive number of characters:

```yaml
lint:
  limits:
    label-too-long: 60
```
