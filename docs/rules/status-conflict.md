---
title: status-conflict
description: A region or nav item says shipped under a screen that is proposed.
---

## What it catches

A region, or an entry in a navigation region's `items`, with
`status: shipped`, on a screen that is `proposed` on any of its platforms.
The screen's status is its `status` value, or, for a mapping of platform to
status, the entry for each of its platforms.

## Why it matters

A region's status can only narrow its screen's: a `proposed` region on a
`shipped` screen is the usual way to propose a change, but nothing on a
screen that has not shipped can have shipped. The conflict usually means the
screen's status was not updated when it shipped, or a region was copied from
a shipped screen. This is a correctness rule: it is always an error.

## How to fix

If the screen has shipped, mark it `shipped` (on that platform). Otherwise
remove the region's `status`: a region with none takes its screen's.

## Example

The project builds for iOS and the web, and the editor is proposed on the
web:

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

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  activity.editor:
    title: Edit activity
    area: activity
    presentation: sheet
    status:
      ios: shipped
      web: proposed
    layout:
      - {region: form, kind: form, status: shipped}
```

The form takes the screen's status on each platform:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  activity.editor:
    title: Edit activity
    area: activity
    presentation: sheet
    status:
      ios: shipped
      web: proposed
    layout:
      - {region: form, kind: form}
```
