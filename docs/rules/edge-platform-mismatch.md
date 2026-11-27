---
title: edge-platform-mismatch
description: A to link joins two screens that share no platform, and the linking node has no platformNote.
---

## What it catches

A `to` from one screen to another where the two screens have no platform in
common, and the node holding the `to` has no `platformNote`. A screen's
platforms are its `platforms` list, or every configured platform when it has
none. For an entry in a navigation region's `items`, the note goes on the
navigation region.

## Why it matters

A link that starts on a web-only screen and ends on an iOS-only screen cannot
be followed on any device. Either the link is wrong, a screen is missing from
a platform, or there is a reason (a handoff, a deep link that opens the app)
that a reader needs to be told. This is a correctness rule: it is always an
error.

## How to fix

Correct the link or the screens' `platforms`. If the link is right as it is,
add a `platformNote` to the node saying how it works.

## Example

The project builds for iOS and the web:

<!-- given: starboard.yaml -->
```yaml
version: 1
platforms:
  ios:
    formFactors: [phone]
  web:
    formFactors: [web-wide]
areas: [trip, activity]
```

A web-only page links to an iOS-only editor:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.overview:
    title: Overview
    area: trip
    presentation: route
    platforms: [web]
    platformNote: The apps open on the timeline instead.
    layout:
      - {region: add, kind: action, label: Add in the app, to: activity.editor}
  activity.editor:
    title: Edit activity
    area: activity
    presentation: sheet
    platforms: [ios]
    platformNote: The web edits activities inline.
```

The link is a handoff to the app, so say so on the node:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.overview:
    title: Overview
    area: trip
    presentation: route
    platforms: [web]
    platformNote: The apps open on the timeline instead.
    layout:
      - region: add
        kind: action
        label: Add in the app
        to: activity.editor
        platformNote: Opens the iOS app with a universal link.
  activity.editor:
    title: Edit activity
    area: activity
    presentation: sheet
    platforms: [ios]
    platformNote: The web edits activities inline.
```
