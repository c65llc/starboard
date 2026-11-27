---
id: join-a-trip
title: Join a trip
status: shipped
actors: [traveller]
entry: home.trips
---

**Goal:** join a trip someone else planned, with the code they shared.

```mermaid
flowchart TD
  trips["@home.trips"] -->|"@home.trips#join"| join["@sharing.join"]
  join -->|"@sharing.join#join"| timeline["@trip.timeline"]
  join -->|"@sharing.join#cancel"| trips
  join --> wrong{"Code not found"}
  wrong --> join
```

## Steps

1. Tap @home.trips#join.
2. Type the code in @sharing.join#code.
3. Tap @sharing.join#join.
   - If no trip has that code, @sharing.join stays open and says so.
4. The trip's @trip.timeline opens, and the trip is now in @home.trips#trips.
