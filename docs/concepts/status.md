---
title: Status
description: shipped and proposed, on screens, regions, navigation items and flows, per platform when the platforms differ.
---

Everything in the reference is either **shipped**, built and in the app, or
**proposed**, agreed on but not built yet. The reference therefore holds
the app as it is and the changes planned for it, side by side, and lint
keeps the two apart.

## Where status goes

- A **screen** has `status`: `shipped` (the default) or `proposed`.
- A **region**, or an entry in a `tabs`, `nav` or `menu` region's `items`,
  can be `proposed` on a shipped screen. That is the usual way to propose a
  change to a screen that exists.
- A **flow** has `status` in its front matter, and it is required.

From the example travel app, a proposed screen and the proposed button that
leads to it, on a screen that has shipped:

```yaml
  trip.checklist:
    title: Checklist
    area: trip
    purpose: What has to be done before the trip, and who is doing it.
    presentation: tab
    # ...
    layout:
      # ...
      - {region: packing, kind: action, label: Packing list, to: trip.packing, status: proposed}
  # ...
  trip.packing:
    title: Packing list
    area: trip
    purpose: What to bring, and who brings each thing so nothing is packed twice.
    presentation: push
    status: proposed
```

## Per platform

Platforms rarely ship a screen on the same day. A screen's status can be a
mapping from platform to status instead of one value:

```yaml
  sharing.invite:
    title: Invite someone
    area: sharing
    purpose: Send an invitation to the trip by email.
    presentation: sheet
    status:
      ios: shipped
      android: proposed
      web: shipped
```

A platform the mapping leaves out is `shipped`. The
[per-platform status guide](../../guides/per-platform-status/) walks through
shipping one screen platform by platform.

## What status changes

On a given platform, a region's **effective status** is `proposed` if its
screen is proposed there, and otherwise the region's own status, which
defaults to `shipped`. Lint uses it to keep the reference honest:

- A proposed screen's `files` need not exist yet; a shipped screen's must
  ([file-missing](../../rules/file-missing/)).
- Nothing on a proposed screen can say it has shipped
  ([status-conflict](../../rules/status-conflict/)).
- A shipped flow cannot go through anything that is proposed on one of its
  platforms ([shipped-flow-proposed-ref](../../rules/shipped-flow-proposed-ref/)).
  Write the flow as `proposed` until everything it uses has shipped.

Wireframes draw proposed regions dashed, so a proposal is visible on the
page next to what exists.

## The leading loop

Status is what lets one platform lead without its code becoming the spec:

1. Propose the change in the reference: new screens, regions and flows
   marked `proposed`, reviewed like any other pull request.
2. Build it on one platform. In the same pull request, add the files to the
   screen and mark it `shipped` on that platform.
3. The other platforms follow from the same reference, each flipping its
   own status when it ships.

The agent skills follow this loop; see
[Working with coding agents](../../guides/agents/).
