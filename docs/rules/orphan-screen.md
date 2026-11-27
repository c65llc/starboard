---
title: orphan-screen
description: No flow references a screen.
---

## What it catches

A screen that no flow mentions: no flow has it as its `entry`, and no flow
refers to it, or to one of its regions, with an `@` reference anywhere in its
text or diagram.

## Why it matters

Flows are where the reference says what people do with each screen. A screen
no flow uses is one whose purpose in the product is undocumented, and it is
often a screen that is no longer used at all. In a project still adopting
Starboard, these findings are the list of screens still to cover.

## How to fix

Write or extend a flow that goes through the screen, referring to it as
`@screen.id`. If the screen is no longer used, remove it.

## Example

The project has one screen, and no flows:

<!-- given: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: root
    layout:
      - {region: add, kind: primary-action, label: Add activity}
```

Write the flow that starts there:

<!-- fixed: docs/flows/flows/add-activity.md -->
```markdown
---
id: add-activity
title: Add an activity
status: shipped
entry: trip.timeline
---

## Steps

1. Tap @trip.timeline#add.
```

## Configuration

`orphan-screen` is a quality rule. Its default severity is `warn`: lint reports it,
and `starboard lint` still passes unless you run it with `--strict`. Change
its severity under `lint.rules` in `starboard.yaml` to `error`, `warn` or
`off`:

```yaml
lint:
  rules:
    orphan-screen: off
```
