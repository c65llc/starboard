---
title: flow-frontmatter-invalid
description: A flow's front matter is missing, never closed, or breaks the flow schema.
---

## What it catches

A flow file in `<content>/flows/` whose front matter Starboard cannot use:

- The file does not start with a `---` line, or the front matter is opened
  and never closed with another `---`.
- The front matter is not valid YAML, or is not a mapping.
- A required key is missing: `id`, `title`, `status` and `entry` are all
  required.
- A key other than `id`, `title`, `status`, `entry`, `actors` and
  `platforms`, or the same key written twice.
- `status` is not `shipped` or `proposed`.
- `entry` is not a screen ID, such as `trip.timeline`.

Anchors and aliases in front matter are reported as
[yaml-alias-not-allowed](../yaml-alias-not-allowed/).

## Why it matters

The front matter says what the flow is, where it starts and whether it has
shipped. The generated pages list flows by it, and
[shipped-flow-proposed-ref](../shipped-flow-proposed-ref/) and
[unreachable-screen](../unreachable-screen/) depend on its `status` and
`entry`. When the front matter is opened and never closed, the whole file is
taken as front matter, so none of the flow's references or steps are read.
This is a correctness rule: it is always an error.

## How to fix

Start the file with front matter between two `---` lines, set the four
required keys, and use `shipped` or `proposed` for `status`. A flow that
describes work not yet built is `proposed`.

## Example

The flow has a status Starboard does not know and no entry:

<!-- example: docs/flows/flows/add-activity.md -->
```markdown
---
id: add-activity
title: Add an activity
status: draft
---

**Goal:** add an activity to a day of the trip.
```

Mark it `proposed` and say where it starts:

<!-- fixed: docs/flows/flows/add-activity.md -->
```markdown
---
id: add-activity
title: Add an activity
status: proposed
entry: trip.timeline
---

**Goal:** add an activity to a day of the trip.
```
