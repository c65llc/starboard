---
title: file-missing
description: A platform root, or a file a screen claims on a platform where it is shipped, does not exist.
---

## What it catches

- A platform's `roots` entry in `starboard.yaml` that does not exist, or is
  not a directory.
- A directory under a root that cannot be listed while looking for screen
  files (reported on the root).
- A path in a screen's `files` that does not exist or is a directory, on a
  platform where the screen is not `proposed`.

Files of a `proposed` screen are not checked, so a screen can name the files
it will have before they are written. Screenshots are checked by
[screenshot-missing](../screenshot-missing/), and paths that are not valid
by [path-invalid](../path-invalid/).

## Why it matters

`files` links each screen to the code that builds it, so a person or an agent
changing a screen can find its source, and reverse coverage can tell which
screen files are accounted for. A path to nothing breaks that link, usually
because the file was moved or renamed. This is a correctness rule: it is
always an error.

## How to fix

Update the path to where the file is now. If the screen is not built on that
platform yet, mark it `proposed` there; if it no longer exists, remove it.

## Example

The file was renamed from `TimelinView.swift`, and the registry still names
the old path:

<!-- exists: ios/Timeline/TimelineView.swift -->
<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
    files:
      ios: [ios/Timeline/TimelinView.swift]
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
