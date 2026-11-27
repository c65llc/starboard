---
title: Adopting Starboard in an existing app
description: Build the registry and the flows for an app that already exists, one area at a time, with lint passing at every commit.
---

Adopting Starboard means writing down the app you already have: every
screen registered from its source, files that are not screens set aside
with a reason, layouts drawn from the code, and then the flows. Done one
area at a time, every commit along the way passes `starboard lint`, so the
work can be reviewed and merged in pieces.

Coding agents can do most of this; the `starboard-adopt` skill follows the
steps below. See [Working with coding agents](../agents/).

## 1. Start the project

At the repository root, run `init` with each platform the app ships on:

<!-- verified: empty -->
```bash
starboard init --platform ios --platform android
starboard lint
```

Commit what it writes, `.gitattributes` lines included. A new project
passes lint.

## 2. Find the screen files

Tell Starboard where each platform's screens are. In `starboard.yaml`, give
each platform its source `roots` and the `screenFiles` patterns that match
its screen files:

```yaml
platforms:
  ios:
    formFactors: [phone]
    roots: [src/ios/Screens]
    screenFiles: ["**/*View.swift"]
  android:
    formFactors: [phone]
    roots: [src/android]
    screenFiles: ["*Screen.kt"]
```

Now every matching file that no screen claims is a finding. Here, one
Android screen the travel app has not registered:

<!-- verified-file: examples/travel-app src/android/ExpensesScreen.kt -->
```kotlin
// The trip's shared expenses: a screen not in the reference yet.
```

<!-- verified: examples/travel-app exit 1 -->
```bash
starboard lint
```

<!-- output -->
```text
src/android/ExpensesScreen.kt: error unregistered-screen-file: matches platforms.android.screenFiles "*Screen.kt" but no screen claims it; add it to a screen's files, or to unmapped in docs/flows/screens.yaml with a reason
1 error, 0 warnings
```

On an app with no screens registered, this list is every screen file: your
to-do list. Run `starboard lint --json` for it in a form you can sort, group
the files into the app's areas, and list the `areas` in `starboard.yaml` in
the order people meet them. Then remove the `screenFiles` patterns again,
keeping `roots`, so lint passes while you work, and keep the list.

## 3. One area at a time

For each area:

1. **Widen coverage to the area.** Add patterns that match only its files.
   Patterns are matched inside each root, so a directory scopes them
   (`Trip/**/*View.swift`), and a path with no wildcard matches one file
   (`Settings/SettingsView.swift`). `starboard lint` now lists exactly this
   area's unregistered files.
2. **Register each screen.** Give it an ID such as `trip.timeline`, a
   `title`, its `area`, a one-sentence `purpose`, a `presentation`, and its
   source under `files` for each platform. Everything adoption writes is
   shipped, because it describes the app as it is.
3. **Set aside what is not a screen.** A row, a control or a wrapper that
   happens to match goes under `unmapped`, with a `reason` that says where
   it is used:

   ```yaml
   unmapped:
     - path: src/macos/Notes/QuickLookWindow.swift
       reason: a floating preview of the note selected in library.main#notes, not a screen
   ```

4. **Draw each layout from the code.** List the regions in order, each with
   the closest [kind](../../reference/screens-yaml/#kinds), a `label` for
   what it shows, and a `to` for every place it navigates. Check a layout
   with `starboard render <screen-id>`. A `to` to a screen in a later area
   needs that screen registered now: register it, and widen the patterns to
   its file.
5. **Check and commit.** Run `starboard fmt`, `starboard generate` and
   `starboard lint`, fix every error, and commit the area on its own.

Remove the example screen and flow that `init` wrote once the first real
screens exist.

When every area is done, put back the full patterns from step 2.
`starboard lint` still passes, which shows no screen file is left out.

## 4. Write the flows

With the screens registered, write a flow for each thing people do with the
app, as `docs/flows/flows/<id>.md` with `status: shipped`. Start with the
flows that matter most; [orphan-screen](../../rules/orphan-screen/) warnings
show which screens no flow covers yet. The [Flows](../../concepts/flows/)
page has the format.

## Then

Add `starboard lint` to CI ([Check it in CI](../../getting-started/ci/)), so
the reference stays true. From here on, a change to the app starts as a
proposal in the reference: see [Status](../../concepts/status/) and
[Per-platform status](../per-platform-status/).
