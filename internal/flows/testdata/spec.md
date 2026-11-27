---
id: add-activity
title: Add an activity
status: proposed
entry: trip.timeline
actors: [traveler]
platforms: [ios, web]
---

# Add an activity

References are `@screen.id` or `@screen.id#region`, anywhere in the text:

```mermaid
flowchart TD
  A["@trip.timeline"] -->|"@trip.timeline#add-activity"| B["@activity.editor"]
  B -->|Save| C["@activity.detail"]
  B -->|Cancel| A
```

Non-screen nodes (decisions, system events) are plain text. The `@` form is
plain text, so it survives every Markdown renderer and agents can grep for it.
