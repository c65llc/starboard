---
title: path-invalid
description: A path or pattern in starboard.yaml or screens.yaml is not a relative path inside the project.
---

## What it catches

A path that is not a relative path inside the project, written with `/` and
with no `.` or `..` element (and so no leading `/` or `./`) and no `\`. It is
checked in:

- `starboard.yaml`: `content`, each platform's `roots`, and each vocabulary's
  `file`;
- `screens.yaml`: each screen's `files` and `screenshots`, and each
  `unmapped` entry's `path`.

Each platform's `screenFiles` patterns are checked the same way, and must
also be valid globs, with no `/` inside a `{…}` group.

Paths are relative to the project root, the directory that holds
`starboard.yaml`.

## Why it matters

Starboard reads only inside the project, so that linting a repository can
never read files outside it, and checks the same way on every operating
system. A path that leaves the project, or uses `\`, would mean different
files on different machines. A path that is not valid is never opened, so
whatever it names is not checked. This is a correctness rule: it is always an
error.

## How to fix

Write the path from the project root with `/` and no `./`, `../` or leading
`/`. If the file really lives outside the project, move `starboard.yaml` up to
a directory that contains both.

## Example

The screen's file starts with `./`:

<!-- exists: ios/Timeline/TimelineView.swift -->
<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    files:
      ios: [./ios/Timeline/TimelineView.swift]
```

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    files:
      ios: [ios/Timeline/TimelineView.swift]
```
