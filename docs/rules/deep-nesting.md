---
title: deep-nesting
description: A layout nests regions deeper than the limit, 5 levels by default.
---

## What it catches

A region nested deeper than the limit, 5 levels by default. A region at the
top of a layout is at level 1; each container's `children` and a list's
`item` are one level deeper. Navigation `items` do not count. The finding is
on the first region past the limit, and the regions inside it are not
reported again.

## Why it matters

A wireframe is a sketch of what is on a screen, not its view hierarchy. Deep
nesting usually means the layout mirrors the code's containers, which makes
it hard to read, hard to keep in step, and too small to draw: each level of
nesting takes room from the content inside it.

## How to fix

Flatten the layout to the groups a person sees. Wrappers that exist only for
spacing or alignment in code do not belong in the wireframe.

## Example

Six levels, from the code's wrappers:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: root
    layout:
      - region: body
        kind: column
        children:
          - region: content
            kind: section
            children:
              - region: day
                kind: section
                children:
                  - region: day-row
                    kind: row
                    children:
                      - region: day-text
                        kind: column
                        children:
                          - {region: day-title, kind: header, label: Day · place}
```

The two groups a person sees:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: root
    layout:
      - region: day
        kind: section
        children:
          - {region: day-title, kind: header, label: Day · place}
```

## Configuration

`deep-nesting` is a quality rule. Its default severity is `warn`: lint reports it,
and `starboard lint` still passes unless you run it with `--strict`. Change
its severity under `lint.rules` in `starboard.yaml` to `error`, `warn` or
`off`:

```yaml
lint:
  rules:
    deep-nesting: off
```

The limit is set under `lint.limits`, as a positive number of levels:

```yaml
lint:
  limits:
    deep-nesting: 6
```
