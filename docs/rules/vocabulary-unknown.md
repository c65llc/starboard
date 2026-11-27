---
title: vocabulary-unknown
description: A requires value is not in the project's requires vocabulary.
---

## What it catches

A `requires` on a region or a navigation item whose value is not in the list
the `requires` vocabulary in `starboard.yaml` selects. It is checked only
when a vocabulary is configured and can be read; `requires` itself stays
optional.

## Why it matters

`requires` says what a person must be allowed to do to see a control. When
the project keeps that list in code, such as a generated list of capabilities,
the vocabulary keeps the screens in step with it: a misspelt or retired
capability is caught here instead of being read as real. This is a
correctness rule: it is always an error.

## How to fix

Use a value from the vocabulary. If the capability is new, add it to the
source list first.

## Example

The project's capabilities are listed in `caps.json`, and the vocabulary
selects their names:

<!-- given: caps.json -->
```json
{"capabilities": [{"name": "viewTrip"}, {"name": "editLogistics"}]}
```

<!-- given: starboard.yaml -->
```yaml
version: 1
platforms:
  ios:
    formFactors: [phone]
vocabularies:
  requires:
    file: caps.json
    select: .capabilities[].name
areas: [trip]
```

The button requires a capability that is not in the list:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: add, kind: primary-action, label: Add activity, requires: editTrip}
```

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: add, kind: primary-action, label: Add activity, requires: editLogistics}
```
