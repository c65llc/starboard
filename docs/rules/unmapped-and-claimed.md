---
title: unmapped-and-claimed
description: A file is listed under unmapped and also claimed by a screen.
---

## What it catches

A path under `unmapped` in `screens.yaml` that a screen also lists in its
`files`, on any platform. The finding names the first screen, in file order,
that claims it.

## Why it matters

`unmapped` says a file is deliberately not a screen; `files` says it is one.
Both cannot be true, and the reason given under `unmapped` no longer
describes the file. It usually happens when a file that was a control grows
into a screen and the `unmapped` entry is left behind. A file claimed by two
screens, on the other hand, is fine: shared editors are common. This is a
correctness rule: it is always an error.

## How to fix

Remove the file from one of the two places: from `unmapped` if it is now a
screen, or from the screen's `files` if it is not.

## Example

The trip info screen claims a file that is still listed as a control:

<!-- exists: ios/Screens/Trip/TripInfoView.swift -->
<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.info:
    title: Trip info
    area: trip
    presentation: sheet
    files:
      ios: [ios/Screens/Trip/TripInfoView.swift]
unmapped:
  - {path: ios/Screens/Trip/TripInfoView.swift, reason: popover inside trip.timeline}
```

It is a screen now, so remove the `unmapped` entry:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.info:
    title: Trip info
    area: trip
    presentation: sheet
    files:
      ios: [ios/Screens/Trip/TripInfoView.swift]
```
