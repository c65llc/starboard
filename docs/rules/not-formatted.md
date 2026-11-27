---
title: not-formatted
description: A source file is not in the canonical form starboard fmt writes.
---

## What it catches

`starboard.yaml`, `screens.yaml` or a flow file that differs from the
canonical form `starboard fmt` writes, or that the formatter cannot format.
In canonical form:

- YAML keys are in the schema's order, indented two spaces.
- A region with no `children`, `item` or `items` is written on one line,
  `{region: title, kind: text}` with no spaces inside the braces, when that
  fits in 100 columns, and in block form otherwise.
- Screens are grouped by area, in the order `areas` lists them, then sorted
  by ID.
- A flow's front matter keys are in canonical order. Its lines have no
  trailing whitespace (except a Markdown hard break), and runs of blank lines
  outside code blocks become one. Its prose and diagram are otherwise left as
  written.
- Every file ends with one newline and uses LF line endings. A file whose
  only difference is CRLF line endings counts as formatted.

A file the formatter refuses is reported as "cannot be formatted" with the
reason: formatting would drop a comment or change the data, a line ends in a
lone CR, or the YAML uses something the formatter cannot write back, such as
a local tag like `!x`. A file that
does not parse is left to its syntax rule.

## Why it matters

Every file has exactly one canonical form, so people, editors and agents
that change the same file converge on the same bytes, and a diff shows only
real changes, never reformatting. This is a correctness rule: it is always
an error.

## How to fix

Run `starboard fmt`, or `starboard lint --fix`, which also regenerates the
generated pages. For a file that cannot be formatted, change what the reason
names. The formatter keeps each comment with the node it precedes, so a
comment it would drop is one it cannot attach to a node; move it onto its
own line just before the node it describes.

## Example

The regions have spaces inside their braces and the screen's keys are out
of order:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    presentation: tab
    area: trip
    layout:
      - { region: title, kind: header, label: Trip name }
```

The same screen in canonical form:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    layout:
      - {region: title, kind: header, label: Trip name}
```
