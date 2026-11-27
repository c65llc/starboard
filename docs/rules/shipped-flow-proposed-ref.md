---
title: shipped-flow-proposed-ref
description: A shipped flow refers to a screen or region that is proposed on one of the flow's platforms.
---

## What it catches

A flow with `status: shipped` whose `entry` or an `@` reference points at
something proposed on one of the flow's platforms (its `platforms`, or every
configured platform when it has none):

- a screen whose status is `proposed` on that platform;
- a region marked `status: proposed` in the layout that platform draws.

Platforms the referenced screen is not on are skipped. The finding names the
first platform where the reference is proposed.

## Why it matters

A shipped flow describes what people can do today. If one of its steps
happens on a screen or region that has not shipped, the flow is describing
the future, and a reader following it will not find what it says. This is a
correctness rule: it is always an error.

## How to fix

If the flow is not yet possible, mark it `proposed`. If the screen or region
has shipped, update its status. If the flow is only shipped on some
platforms, set the flow's `platforms` to those.

## Example

The editor is proposed:

<!-- given: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: add, kind: primary-action, label: Add activity, to: activity.editor}
  activity.editor:
    title: Edit activity
    area: activity
    presentation: sheet
    status: proposed
```

A shipped flow goes through it:

<!-- example: docs/flows/flows/add-activity.md -->
```markdown
---
id: add-activity
title: Add an activity
status: shipped
entry: trip.timeline
---

## Steps

1. Tap @trip.timeline#add.
2. Fill in @activity.editor and save.
```

The flow is proposed until the editor ships:

<!-- fixed: docs/flows/flows/add-activity.md -->
```markdown
---
id: add-activity
title: Add an activity
status: proposed
entry: trip.timeline
---

## Steps

1. Tap @trip.timeline#add.
2. Fill in @activity.editor and save.
```
