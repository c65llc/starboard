---
title: unknown-kind
description: A region's kind is not one of the kinds the renderer knows.
---

## What it catches

A region whose `kind` is not one of the fixed vocabulary:

- containers: `column`, `row`, `section`, `bar`
- navigation: `tabs`, `nav`, `menu`
- content: `header`, `text`, `list`, `card`, `media`, `map`, `banner`,
  `form`, `field`
- actions: `action`, `primary-action`

## Why it matters

The kind decides how the wireframe draws the region and which fields it may
have (only containers have `children`, only lists have `item`, and only
navigation has `items`). A kind outside the vocabulary cannot be drawn. The
vocabulary is small on purpose: a wireframe says what is on a screen, not how
it is styled. This is a correctness rule: it is always an error.

## How to fix

Pick the kind from the list that says what the region is for. A button is an
`action`, or a `primary-action` when it is the screen's main one; a text input
is a `field`; an image or video is `media`.

## Example

A button is written as `button`:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: share, kind: button, label: Share}
```

It is an `action`:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: share, kind: action, label: Share}
```
