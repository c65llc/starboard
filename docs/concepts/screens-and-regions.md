---
title: Screens and regions
description: A screen is anything a person navigates to; its layout is a tree of named regions of a few fixed kinds, which Starboard draws as a wireframe.
---

## Screens

A **screen** is anything with its own layout that a person navigates to: a
pushed view, a tab, a sheet, a window, a web route, or a dialog with
meaningful content. A control inside a screen, such as a picker in its
toolbar, is not a screen: it is a region of one.

Every screen is registered in `screens.yaml` under a stable **ID** of two or
more dot-separated parts, such as `trip.timeline` or `auth.sign-in`. Each
part is lowercase letters, digits and hyphens, starting with a letter. The
ID is how flows, links and agents refer to the screen, so choose it for the
product, not for a class name, and keep it when the code moves.

From the example travel app:

```yaml
screens:
  trip.day:
    title: Day
    area: trip
    purpose: One day of the trip on its own, with its places on a map.
    presentation: push
    files:
      ios: [src/ios/Screens/Trip/DayView.swift]
      android: [src/android/DayScreen.kt]
      web: [src/web/routes/trip/day/+page.svelte]
    layout:
      - {region: title, kind: header, label: Day · date · place}
      - {region: route, kind: map, label: The day's places in order}
      - region: activities
        kind: list
        item: {kind: card, label: Time · activity, to: activity.detail}
        empty:
          label: Nothing planned this day
      - region: add
        kind: primary-action
        label: Add activity
        to: activity.add
        requires: editLogistics
```

- `title` is the screen's name for people; `area` is one of the project's
  areas.
- `purpose` is one sentence on what the screen is for. It is optional, but
  [missing-purpose](../../rules/missing-purpose/) warns without it.
- `presentation` is how a person gets there:

  | Presentation | Meaning |
  | --- | --- |
  | `root` | a starting point: the first screen, or a top-level destination |
  | `push` | pushed onto a navigation stack |
  | `tab` | one tab of a tab bar or sidebar |
  | `sheet` | a sheet or modal over another screen |
  | `dialog` | a dialog over another screen |
  | `window` | a window of its own, on the desktop |
  | `route` | a web route |

- `files` are the source files that implement the screen, per platform.
  Starboard checks that they exist
  ([file-missing](../../rules/file-missing/)), and they count toward
  reverse coverage.

A screen can also have `status`, `platforms` with a `platformNote`,
`states`, `screenshots` and per-form-factor `layouts`. The
[`screens.yaml` reference](../../reference/screens-yaml/) lists every field.

## Regions

A screen's `layout` is a tree of **regions**: the named parts of the screen.
Each region has a **name** (`region`), unique within the layout tree, and a
**kind**. A region is written `screen#region` when you refer to it:
`trip.day#add` is the button above.

The kinds are a small fixed vocabulary that the renderer knows how to draw:

| Group | Kinds |
| --- | --- |
| containers | `column`, `row`, `section`, `bar` |
| navigation | `tabs`, `nav` (a sidebar), `menu` |
| content | `header`, `text`, `list`, `card`, `media`, `map`, `banner`, `form`, `field` |
| actions | `action`, `primary-action` |

Only containers hold `children`. A `list` has an `item`, the region each of
its rows is drawn as, and an `empty` state. `tabs`, `nav` and `menu` have
`items`, each with a `label` and usually a `to`.

A region's `label` says what the content is (`Day · date · place`), not its
final copy. Copy changes often; what the region holds rarely does.

Regions also carry:

- `to`: a link to another screen, by ID. Every `to` in the registry is an
  edge of the app map.
- `requires`: what a person must be allowed to do to see or use it, such as
  `editLogistics`. A project can check these names against a list it keeps
  elsewhere, with a vocabulary (see the
  [`starboard.yaml` reference](../../reference/starboard-yaml/#vocabularies)).
- `status`: `proposed` for a region that is planned but not built, on a
  screen that is (see [Status](../status/)).
- `width`: for a child of a `row`, its width in pixels or a fraction such as
  `1/3`.

The [`screens.yaml` reference](../../reference/screens-yaml/) shows every
kind with the wireframe Starboard draws for it.

## Wireframes

`starboard generate` draws each screen as a grey-box wireframe, one SVG per
form factor, from its layout. The wireframe is a sketch of structure, not a
design: each kind has one look, region names are printed in small monospace
so you can find them in the YAML, a proposed region is dashed, and a
`requires` shows a lock with its name. `starboard render` draws one screen
on demand.

The same region name in two layouts means the same region. A tab bar on the
phone and a sidebar on the web can both be `tabs`, so a flow that says
`@trip.timeline#tabs` is right on both. See
[Desktop and web layouts](../../guides/desktop-and-web/).
