---
title: edge-parity
description: A form factor's layout override drops a link that the default layout has.
---

## What it catches

A screen with an override under `layouts` that has no `to` to a screen the
default `layout` links to. Each missing link is reported once per override.
Links an override adds are not reported: a wider layout often shows more.

## Why it matters

An override replaces the whole layout for its form factor, so it is easy to
leave out a control when redrawing it. A link the default layout has and the
override lacks means that on that form factor the destination cannot be
reached from this screen, which is rarely intended: the same app usually
goes to the same places on every screen size, just from a different control.

## How to fix

Add the missing link to the override, on whatever control leads there on
that form factor. If the screen really cannot go there on that form factor,
say why in the screen's `purpose` or a flow; there is no per-link exception,
so a project where that is common can lower this rule's severity.

## Example

On the web, the tab bar becomes a sidebar, and the checklist was left out:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - region: tabs
        kind: tabs
        items:
          - {label: Timeline, to: trip.timeline}
          - {label: Checklist, to: trip.checklist}
    layouts:
      web-wide:
        - region: tabs
          kind: nav
          items:
            - {label: Timeline, to: trip.timeline}
  trip.checklist:
    title: Checklist
    area: trip
    presentation: tab
```

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - region: tabs
        kind: tabs
        items:
          - {label: Timeline, to: trip.timeline}
          - {label: Checklist, to: trip.checklist}
    layouts:
      web-wide:
        - region: tabs
          kind: nav
          items:
            - {label: Timeline, to: trip.timeline}
            - {label: Checklist, to: trip.checklist}
  trip.checklist:
    title: Checklist
    area: trip
    presentation: tab
```

## Configuration

`edge-parity` is a quality rule. Its default severity is `warn`: lint reports it,
and `starboard lint` still passes unless you run it with `--strict`. Change
its severity under `lint.rules` in `starboard.yaml` to `error`, `warn` or
`off`:

```yaml
lint:
  rules:
    edge-parity: off
```
