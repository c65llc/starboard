---
title: unknown-platform
description: A screen names a platform that starboard.yaml does not configure.
---

## What it catches

A platform name in a screen that is not a key under `platforms` in
`starboard.yaml`. It is checked in the screen's `platforms` list, and in the
platform keys of its `status`, `files` and `screenshots` mappings.

## Why it matters

A platform Starboard does not know has no form factors to draw and no source
roots to check, so whatever the screen says about it is never checked. It is
usually a typo (`IOS`, `andriod`) or a platform that was renamed or removed in
`starboard.yaml`. This is a correctness rule: it is always an error.

## How to fix

Correct the name to one of the configured platforms, or add the platform
under `platforms` in `starboard.yaml`.

## Example

The project configures `ios` and `web`:

<!-- given: starboard.yaml -->
```yaml
version: 1
platforms:
  ios:
    formFactors: [phone]
  web:
    formFactors: [web-wide]
areas: [trip]
```

The screen's status names `android`, which is not configured:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    status:
      ios: shipped
      android: proposed
```

Name only configured platforms, or configure `android` too:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    status:
      ios: shipped
      web: proposed
```
