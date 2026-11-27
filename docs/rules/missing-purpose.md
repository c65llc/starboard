---
title: missing-purpose
description: A screen has no purpose.
---

## What it catches

A screen with no `purpose`, or one that is empty or only whitespace.

## Why it matters

The purpose is one sentence saying what the screen is for: "The trip's days
in order with each day's activities." The title says what a screen is called;
the purpose says why it exists, which is what a person or an agent deciding
where a change belongs needs to know. The screen catalog shows it under each
screen.

## How to fix

Add a `purpose` of one sentence, about what a person does or learns there,
not how it looks.

## Example

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: root
```

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    purpose: The trip's days in order, with each day's activities.
    presentation: root
```

## Configuration

`missing-purpose` is a quality rule. Its default severity is `warn`: lint reports it,
and `starboard lint` still passes unless you run it with `--strict`. Change
its severity under `lint.rules` in `starboard.yaml` to `error`, `warn` or
`off`:

```yaml
lint:
  rules:
    missing-purpose: error
```
