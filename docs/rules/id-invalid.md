---
title: id-invalid
description: A screen ID or a region name does not have the required form.
---

## What it catches

- A screen ID that is not two or more dot-separated segments, each made of
  lowercase letters, digits and hyphens and starting with a letter, such as
  `trip.timeline` or `activity.edit-notes`.
- A region name that is not one such segment: lowercase letters, digits and
  hyphens, starting with a letter, such as `add-activity`.

## Why it matters

Flows refer to screens and regions as `@screen.id` and `@screen.id#region`,
and those references are found by exactly this pattern. A screen or region
named any other way can never be referenced. IDs also name the generated
wireframe files and the app map's nodes, so they must be safe in a file name
and in Mermaid. This is a correctness rule: it is always an error.

## How to fix

Rename the screen or region to the required form, and update every `to`,
flow reference and flow `entry` that uses the old name. The first segment of
a screen ID is usually its area.

## Example

The screen ID has one segment and the region name is in camel case:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: addActivity, kind: primary-action, label: Add activity}
```

Use a dotted, lowercase ID and a hyphenated name:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: add-activity, kind: primary-action, label: Add activity}
```
