---
title: yaml-alias-not-allowed
description: A YAML file or a flow's front matter uses an anchor, an alias or a merge key.
---

## What it catches

An anchor (`&name`), an alias (`*name`) or a merge key (`<<`) in
`starboard.yaml`, `screens.yaml` or a flow's front matter. Each one is
reported at its line.

## Why it matters

Starboard never expands anchors and aliases, so an alias bomb costs nothing
and what you read in a file is exactly what Starboard reads. A
`starboard.yaml` or `screens.yaml` that uses them is not read at all, and
neither is the front matter of a flow that does. Aliases also hide repetition that a reader,
an agent or a diff should see: a change to a shared anchor silently changes
every screen that uses it. This is a correctness rule: it is always an
error.

## How to fix

Write the repeated content out in full at each place it is used. If two
screens really share a layout, consider whether they are one screen with
different states, or whether the shared part is navigation that belongs in
each layout anyway.

## Example

Two tabs share a layout through an anchor:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout: &tabs
      - region: tabs
        kind: tabs
        items:
          - {label: Timeline, to: trip.timeline}
          - {label: Checklist, to: trip.checklist}
  trip.checklist:
    title: Checklist
    area: trip
    presentation: tab
    layout: *tabs
```

Write the layout out under each screen:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.checklist:
    title: Checklist
    area: trip
    presentation: tab
    layout:
      - region: tabs
        kind: tabs
        items:
          - {label: Timeline, to: trip.timeline}
          - {label: Checklist, to: trip.checklist}
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - region: tabs
        kind: tabs
        items:
          - {label: Timeline, to: trip.timeline}
          - {label: Checklist, to: trip.checklist}
```
