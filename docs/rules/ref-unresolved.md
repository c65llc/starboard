---
title: ref-unresolved
description: A flow's entry or @ reference names a screen or region that does not exist.
---

## What it catches

In a flow file:

- an `entry` in the front matter that is not a registered screen;
- an `@screen.id` reference, anywhere in the text or the diagram, to a screen
  that is not registered;
- an `@screen.id#region` reference to a region that is not in any of that
  screen's layouts (the default layout or an override).

## Why it matters

References are how a flow says where each step happens, and how the
generated pages connect flows to screens. A reference to nothing is a step
nobody can find, and usually means a screen or region was renamed and the
flow was not updated. This is a correctness rule: it is always an error.

## How to fix

Correct the screen ID or region name, or register the screen or add the
region. References are written `@` then the screen ID, with `#` and the
region name for a region: `@trip.timeline#add`.

## Example

The timeline's primary action is the region `add`:

<!-- given: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: add, kind: primary-action, label: Add activity}
```

The flow calls it `add-activity`:

<!-- example: docs/flows/flows/add-activity.md -->
```markdown
---
id: add-activity
title: Add an activity
status: shipped
entry: trip.timeline
---

## Steps

1. Tap @trip.timeline#add-activity.
```

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
