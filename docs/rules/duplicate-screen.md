---
title: duplicate-screen
description: screens.yaml defines the same screen ID twice.
---

## What it catches

A screen ID that appears twice under `screens`. The finding is on the second
one, and names the line of the first.

## Why it matters

A screen ID must name one screen, or links, flow references and generated
pages cannot say which one they mean. Starboard keeps the first definition
and ignores the second entirely, so whatever the second one says is lost.
This usually happens when a screen is copied as a starting point and its ID
is not changed. This is a correctness rule: it is always an error.

## How to fix

If the two entries are different screens, give the second its own ID. If
they are the same screen, merge them into one entry.

## Example

The checklist was copied from the timeline and kept its ID:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
  trip.timeline:
    title: Checklist
    area: trip
    presentation: tab
```

Give it its own ID:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
  trip.checklist:
    title: Checklist
    area: trip
    presentation: tab
```
