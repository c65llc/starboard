---
title: screenshot-missing
description: A screenshot named in screens.yaml does not exist.
---

## What it catches

A path in a screen's `screenshots` that does not exist or is a directory.
Unlike [file-missing](../file-missing/), this is checked whatever the
screen's status.

## Why it matters

The screen catalog shows each screen's screenshots next to its wireframe, so
readers can compare the plan with what shipped. A missing screenshot is a
broken image there, usually because a golden image was renamed or moved by a
test suite. This is a correctness rule: it is always an error.

## How to fix

Update the path to where the screenshot is now, or remove the entry.

## Example

The golden images moved into a `light/` directory:

<!-- exists: ios/goldens/light/timeline.png -->
<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    screenshots:
      ios: ios/goldens/timeline.png
```

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    screenshots:
      ios: ios/goldens/light/timeline.png
```
