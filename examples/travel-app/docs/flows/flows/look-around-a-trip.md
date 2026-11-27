---
id: look-around-a-trip
title: Look around a trip
status: shipped
entry: trips.list
---

```mermaid
flowchart TD
  list["@trips.list"] -->|"@trips.list#trips"| timeline["@trip.timeline"]
  timeline -->|"@trip.timeline#days"| detail["@activity.detail"]
  timeline --> map["@trip.map"]
  list -->|"@trips.list#account"| account["@account.settings"]
```

## Steps

1. Tap a trip in @trips.list#trips.
2. Tap an activity in @trip.timeline#days to open @activity.detail.
3. Switch to @trip.map from the trip's tabs.
4. Tap @trips.list#account to change @account.settings.
