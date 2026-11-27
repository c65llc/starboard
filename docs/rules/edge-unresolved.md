---
title: edge-unresolved
description: A to link names a screen that is not registered.
---

## What it catches

A `to` on a region or on a navigation item that names a screen ID not
registered in `screens.yaml`. Every layout tree is checked: the default
`layout`, each override under `layouts`, list `item`s and `items` entries.

## Why it matters

Every `to` is an edge of the app map: it says this control takes you to that
screen. An edge to a screen that does not exist is a broken link in the map,
the screen catalog and the wireframes. It usually means a typo, a renamed
screen, or a screen that was planned but never registered. This is a
correctness rule: it is always an error.

## How to fix

Correct the ID, or register the screen. A screen that is planned but not
built can be registered with `status: proposed`.

## Example

The timeline links to an editor that is not registered:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: add, kind: primary-action, label: Add activity, to: activity.editor}
```

Register the editor, proposed until it is built:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: add, kind: primary-action, label: Add activity, to: activity.editor}
  activity.editor:
    title: Edit activity
    area: activity
    presentation: sheet
    status: proposed
```
