---
title: duplicate-edge
description: Two links to the same screen sit under the same parent in one layout.
---

## What it catches

Within one layout tree, a second `to` naming the same screen under the same
parent:

- two regions that are children of the same container, or both at the top
  of the layout;
- two entries of one navigation region's `items`.

The finding is on the second link. Links to the same screen from different
parts of a layout, such as one in the app bar and one in a list, are not
reported.

## Why it matters

Two controls side by side that go to the same place are usually a copy that
was not updated, a link that should point elsewhere, or a control that was
replaced without removing the old one. When it is deliberate it is worth
questioning: one of them is probably redundant.

## How to fix

Point the link at the screen it should open, or remove the redundant
control.

## Example

The app bar's second action was copied from the first and still opens the
editor:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: root
    layout:
      - region: app-bar
        kind: bar
        children:
          - {region: add, kind: action, label: Add, to: activity.editor}
          - {region: share, kind: action, label: Share, to: activity.editor}
  activity.editor:
    title: Edit activity
    area: activity
    presentation: sheet
  trip.share:
    title: Share trip
    area: trip
    presentation: sheet
```

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: root
    layout:
      - region: app-bar
        kind: bar
        children:
          - {region: add, kind: action, label: Add, to: activity.editor}
          - {region: share, kind: action, label: Share, to: trip.share}
  activity.editor:
    title: Edit activity
    area: activity
    presentation: sheet
  trip.share:
    title: Share trip
    area: trip
    presentation: sheet
```

## Configuration

`duplicate-edge` is a quality rule. Its default severity is `warn`: lint reports it,
and `starboard lint` still passes unless you run it with `--strict`. Change
its severity under `lint.rules` in `starboard.yaml` to `error`, `warn` or
`off`:

```yaml
lint:
  rules:
    duplicate-edge: off
```
