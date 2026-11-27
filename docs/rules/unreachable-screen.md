---
title: unreachable-screen
description: No other screen links to a screen, it is not presentation root, and no flow starts there.
---

## What it catches

A screen that nothing leads to: no `to` on another screen names it (in any
layout, list item or navigation item), its `presentation` is not `root`, and
no flow has it as its `entry`. A screen's links to itself do not count.

## Why it matters

If no screen links to a screen, the app map shows it floating on its own, and
a reader cannot tell how a person gets there. Either a link is missing from
the registry, the screen is a starting point that should be `root`, or it is
reached from outside the app (a notification, a deep link) and a flow should
say so.

## How to fix

Add the `to` that leads to the screen. If it is a starting point of the app,
make its presentation `root`. If it is reached from outside the app, write a
flow that starts there.

## Example

Nothing leads to the editor:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: root
    layout:
      - {region: title, kind: header, label: Trip name}
  activity.editor:
    title: Edit activity
    area: activity
    presentation: sheet
```

The timeline's primary action opens it:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: root
    layout:
      - {region: title, kind: header, label: Trip name}
      - {region: add, kind: primary-action, label: Add activity, to: activity.editor}
  activity.editor:
    title: Edit activity
    area: activity
    presentation: sheet
```

## Configuration

`unreachable-screen` is a quality rule. Its default severity is `warn`: lint reports it,
and `starboard lint` still passes unless you run it with `--strict`. Change
its severity under `lint.rules` in `starboard.yaml` to `error`, `warn` or
`off`:

```yaml
lint:
  rules:
    unreachable-screen: off
```
