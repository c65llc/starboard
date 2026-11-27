---
title: flow-id-mismatch
description: A flow's id does not match its file name.
---

## What it catches

A flow whose front matter `id` is not its file name without `.md`. The flow
in `flows/add-activity.md` must have `id: add-activity`.

## Why it matters

A flow is found by its ID, and its file by its name; when they differ, a
reader, an agent or a link going by one will not find the other. It usually
happens when a flow file is renamed or copied. This is a correctness rule: it
is always an error.

## How to fix

Change the `id` to the file name, or rename the file to the `id`.

## Example

The file is `docs/flows/flows/add-activity.md`:

<!-- example: docs/flows/flows/add-activity.md -->
```markdown
---
id: new-activity
title: Add an activity
status: proposed
entry: trip.timeline
---
```

<!-- fixed: docs/flows/flows/add-activity.md -->
```markdown
---
id: add-activity
title: Add an activity
status: proposed
entry: trip.timeline
---
```
