---
title: Desktop and web layouts
description: Lay out multi-pane windows with rows and sidebars, give a wide form factor its own layout, and keep links and region names the same across them.
---

A phone screen is a column: things stack top to bottom. A desktop window
or a wide browser window is usually several panes side by side. Starboard
draws both from the same few kinds: a `row` sets its children side by side,
and a `nav` is a sidebar. This guide uses the two example projects:
`examples/desktop-notes`, a note-taking app for macOS, Windows and the web,
and the web layout of `examples/travel-app`.

## Panes: rows, widths and sidebars

The notes app's main window is three panes: notebooks, the notes in one,
and the note being written.

```yaml
  library.main:
    title: Library
    area: library
    purpose: The main window, in three panes - notebooks, the notes in one, and the note being written.
    presentation: window
    # ...
    layout:
      - region: app-menu
        kind: menu
        items:
          - {label: New notebook, to: notebooks.new}
          - {label: Preferences, to: settings.preferences}
      - region: toolbar
        kind: bar
        children:
          - {region: search, kind: field, label: Search every note}
          - {region: new-note, kind: primary-action, label: New note}
      - region: panes
        kind: row
        children:
          - region: notebooks
            kind: nav
            width: 220
            items:
              - {label: All notes}
              - {label: Pinned}
              - {label: Trash}
          - region: list
            kind: column
            width: 320
            children:
              - {region: list-title, kind: header, label: Notebook name · count}
              - region: notes
                kind: list
                item: {kind: card, label: Title · first line · date}
                empty:
                  label: No notes in this notebook
          - region: editor
            kind: column
            children:
              # the note bar, the "more" menu, the title and the body
```

- A `row`'s children each take their `width`, in pixels (`220`) or as a
  fraction of the row (`1/3`); children without one share what is left
  equally. Here the editor takes everything after the sidebar and the list.
- A `nav` is a sidebar of `items`. A `column` inside a row stacks its own
  children.
- A `menu` holds a window's menu, or any set of choices. Its items can link
  to screens like any other.

## Windows, sheets and dialogs

The screen's `presentation` changes the frame:

- `window` draws window chrome, a title bar with its three buttons. The
  notes app's main window, each note opened on its own (`notes.window`) and
  the preferences are windows.
- `sheet` and `dialog` draw a panel over a dimmed, generic screen, so it is
  clear they sit on top of something: `notes.export` is a sheet and
  `notes.delete` a dialog.

## A different layout for a wide form factor

A screen gets a wireframe for each form factor of its platforms, and by
default every one uses its `layout`. When a form factor needs a really
different arrangement, give it an override under `layouts`, keyed by form
factor. The travel app's timeline is a column with a tab bar on the phone;
on `web-wide`, the tabs become a sidebar and a map of the day sits beside
the list:

```yaml
    layouts:
      web-wide:
        - region: shell
          kind: row
          children:
            - region: tabs
              kind: nav
              width: 220
              items:
                - {label: Timeline, to: trip.timeline}
                - {label: Checklist, to: trip.checklist}
                - {label: Inbox, to: trip.inbox}
                - {label: Map, to: trip.map}
            - region: main
              kind: column
              children:
                - region: app-bar
                  kind: bar
                  children:
                    - {region: title, kind: header, label: Trip name · dates}
                    - {region: info, kind: action, label: Info, to: trip.info, requires: viewTrip}
                - {region: day-heading, kind: header, label: Day · place · weather, to: trip.day}
                - region: days
                  kind: list
                  item: {kind: card, label: Time · activity · who is going, to: activity.detail}
                  empty:
                    label: No activities yet
                - region: add-activity
                  kind: primary-action
                  label: Add activity
                  to: activity.add
                  requires: editLogistics
            - {region: day-map, kind: map, label: The day's places, width: 1/3}
```

An override replaces the whole tree for its form factor; nothing is merged.
The phone and `web-narrow` still use `layout`.

To see both while you work:

<!-- verified: examples/travel-app -->
```bash
starboard render trip.timeline -o timeline.svg
starboard render trip.timeline --form-factor web-wide -o timeline-wide.svg
```

## Keep names and links the same

Two rules keep an override honest:

- **The same name means the same region.** The phone's tab bar and the
  web's sidebar are both `tabs`, and the add button is `add-activity` in
  both. A flow step that says `@trip.timeline#add-activity` is then right on
  every form factor, and the web app's walk-through highlights the right
  box on each.
- **Links do not disappear.** Every `to` in the default layout should still
  be somewhere in the override, even if it moves. Starboard compares the
  links of each override with the default layout's, and
  [edge-parity](../../rules/edge-parity/) warns when one goes missing. If a
  wide layout really does drop a way out, say why in the review, or set the
  rule's severity in `starboard.yaml`.

Region names only need to be unique within one layout tree, so `shell` and
`main`, which exist only on the web, do not clash with anything on the
phone.

The [examples gallery](../../examples/travel-app/) shows the generated
wireframes for every screen and form factor of both projects.
