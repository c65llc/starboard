---
title: unknown-area
description: A screen's area is not listed under areas in starboard.yaml.
---

## What it catches

A screen whose `area` is not one of the names listed under `areas` in
`starboard.yaml`.

## Why it matters

Areas group the screens: the screen catalog and the app map are organised by
them, in the order `areas` lists them, and the formatter sorts `screens.yaml`
by that order. A screen in an unlisted area falls outside that order. It is
usually a typo or a plural (`trips` for `trip`). This is a correctness rule:
it is always an error.

## How to fix

Correct the area to one that is listed, or add the new area to `areas` in
`starboard.yaml`, in the place it belongs in the app.

## Example

The project's areas are `trip` and `activity`:

<!-- given: starboard.yaml -->
```yaml
version: 1
platforms:
  ios:
    formFactors: [phone]
areas: [trip, activity]
```

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trips
    presentation: tab
```

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
```
