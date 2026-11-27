---
title: duplicate-region
description: A region name is used twice in one layout tree.
---

## What it catches

Two regions with the same `region` name in one layout tree: a screen's
`layout`, or one of its `layouts` overrides. A list's `item` subtree is part
of the tree. The same name in the default layout and an override is not a
duplicate: it is how you say they are the same region.

## Why it matters

A flow points at a region as `@screen.id#region`. If two regions in a layout
share the name, the reference cannot say which one it means, and neither can
a reader. This is a correctness rule: it is always an error.

## How to fix

Rename one of the regions, and update any flow reference to it.

## Example

Two actions are both named `add`:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: add, kind: action, label: Add a note}
      - {region: add, kind: primary-action, label: Add activity}
```

Name each for what it adds:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: add-note, kind: action, label: Add a note}
      - {region: add-activity, kind: primary-action, label: Add activity}
```
