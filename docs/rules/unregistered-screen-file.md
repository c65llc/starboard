---
title: unregistered-screen-file
description: A file matching a platform's screenFiles is claimed by no screen and not listed under unmapped.
---

## What it catches

A file that one of a platform's `screenFiles` patterns matches, under one of
its `roots`, that no screen lists in its `files` (on any platform) and that
`unmapped` does not list. Patterns are matched inside each root: `**` spans
directories and `*` does not, so `*Screen.kt` matches only the root's own
directory. A platform with no `screenFiles` is not checked.

The finding is reported on the file itself, once, however many patterns
match it.

## Why it matters

This is reverse coverage: the check that the registry has not fallen behind
the code. A new screen file that no screen claims is a screen the reference
does not know about, so the app map, the catalog and every flow are missing
it. This is a correctness rule: it is always an error.

## How to fix

Add the file to the `files` of the screen it builds, registering the screen
if it is new. If the file matches the pattern but is not a screen (a control,
a preview, a shared component), list it under `unmapped` in `screens.yaml`
with the reason. If the pattern catches too much, narrow `screenFiles`.

## Example

iOS screens are the `*View.swift` files under `ios/Screens`:

<!-- given: starboard.yaml -->
```yaml
version: 1
platforms:
  ios:
    formFactors: [phone]
    roots: [ios/Screens]
    screenFiles: ['**/*View.swift']
areas: [trip]
```

<!-- exists: ios/Screens/Timeline/TimelineView.swift -->
<!-- exists: ios/Screens/Timeline/LensPickerView.swift -->

The timeline's directory also holds `LensPickerView.swift`, a control inside
the timeline's app bar, which no screen claims:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    files:
      ios: [ios/Screens/Timeline/TimelineView.swift]
```

It is not a screen, so list it under `unmapped` with the reason:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    files:
      ios: [ios/Screens/Timeline/TimelineView.swift]
unmapped:
  - {path: ios/Screens/Timeline/LensPickerView.swift, reason: control inside trip.timeline's app bar}
```
