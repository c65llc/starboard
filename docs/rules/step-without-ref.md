---
title: step-without-ref
description: A flow step has no @screen reference saying where it happens.
---

## What it catches

An item of the numbered list under a flow's `Steps` heading with no
`@screen.id` or `@screen.id#region` reference in its text. The step's own
text counts, wrapped lines included; its nested bullets (branches) do not.

## Why it matters

A step's first reference is where it happens: it is how a reader, an agent or
the viewer's walkthrough knows which screen the step is on. A step without
one cannot be placed, and the walkthrough has no wireframe to show for it.

## How to fix

Add a reference to the screen, or better the region, where the step happens:
"Tap @trip.timeline#add", not "Tap Add". If the step happens outside the app
(an email arrives, the person thinks it over), consider whether it is a step
of this flow or context for the Goal.

## Example

The timeline opens the editor:

<!-- given: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: root
    layout:
      - {region: add, kind: primary-action, label: Add activity, to: activity.editor}
  activity.editor:
    title: Edit activity
    area: activity
    presentation: sheet
    layout:
      - {region: form, kind: form}
```

The second step does not say where the form is:

<!-- example: docs/flows/flows/add-activity.md -->
```markdown
---
id: add-activity
title: Add an activity
status: proposed
entry: trip.timeline
---

## Steps

1. Tap @trip.timeline#add.
2. Fill in the form and save.
```

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
2. Fill in @activity.editor#form and save.
```

## Configuration

`step-without-ref` is a quality rule. Its default severity is `warn`: lint reports it,
and `starboard lint` still passes unless you run it with `--strict`. Change
its severity under `lint.rules` in `starboard.yaml` to `error`, `warn` or
`off`:

```yaml
lint:
  rules:
    step-without-ref: error
```
