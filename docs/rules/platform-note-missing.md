---
title: platform-note-missing
description: A screen on only some of the configured platforms has no platformNote saying why.
---

## What it catches

A screen whose `platforms` list leaves out at least one platform configured in
`starboard.yaml`, and which has no `platformNote`. A screen with no
`platforms` list is on every platform and is never reported.

## Why it matters

A screen missing from a platform is either deliberate (the feature is iOS only
for now, the web does it inline) or a gap nobody noticed. The note tells a
reader which, and keeps the decision next to the screen, where the next person
to touch it will see it. This is a correctness rule: it is always an error.

## How to fix

Add a `platformNote` saying why the screen is not on the other platforms. If
it should be on every platform, remove `platforms` instead.

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
areas: [activity]
```

The editor is on iOS only, and nothing says why:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  activity.editor:
    title: Edit activity
    area: activity
    presentation: sheet
    platforms: [ios]
```

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  activity.editor:
    title: Edit activity
    area: activity
    presentation: sheet
    platforms: [ios]
    platformNote: The web edits activities inline on the timeline.
```
