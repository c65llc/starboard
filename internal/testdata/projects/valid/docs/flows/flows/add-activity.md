---
id: add-activity
title: Add an activity
status: proposed
actors: [traveler]
entry: trip.timeline
platforms: [ios]
---

# Add an activity

```mermaid
flowchart TD
  A["@trip.timeline"] -->|"@trip.timeline#add-activity"| B["@activity.editor"]
  B -->|"@activity.editor#save"| A
```

## Steps

1. On @trip.timeline, tap @trip.timeline#add-activity.
2. Fill in @activity.editor#name and tap @activity.editor#save.
