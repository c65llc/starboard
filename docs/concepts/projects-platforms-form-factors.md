---
title: Projects, platforms and form factors
description: What a Starboard project is, how platforms say where screens are implemented, and which frame sizes the wireframes are drawn at.
---

## Projects

A **project** is one repository, or one directory of a monorepo, that keeps
its screens and flows in Starboard. Its configuration is `starboard.yaml`,
and the directory holding that file is the **project root**. Every path in
the project is written relative to the root, with `/`, on every operating
system.

The reference itself lives under the **content root**, `docs/flows` unless
`starboard.yaml` sets `content`:

```text
starboard.yaml            the configuration
docs/flows/
  README.md               what the directory is, for people who find it
  screens.yaml            the registry: every screen and its layout
  flows/<flow-id>.md      one file per flow
  generated/              written by starboard generate; never edited by hand
    app-map.md            a Mermaid map of every link between screens
    screens.md            the catalog: each screen's wireframes, files and links
    wireframes/<screen-id>.<form-factor>.svg
```

Every command finds the project the same way: from the working directory
(or the directory `--dir` names), it looks for `starboard.yaml` there and
then in each parent directory. So you can run `starboard lint` from
anywhere inside the project.

Starboard owns exactly `generated/app-map.md`, `generated/screens.md` and
the `.svg` files directly in `generated/wireframes/`. It never touches any
other file under `generated/`.

## Platforms

A **platform** is somewhere the app is implemented: `ios`, `android`,
`web`, `macos`, `windows`, or any other name of lowercase letters, digits
and hyphens. The example travel app has three:

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
  web:
    formFactors: [web-narrow, web-wide]
    roots: [src/web/routes]
    screenFiles: ["**/+page.svelte"]
```

Each platform may set:

- `formFactors`: the frame sizes its screens are drawn at (below).
- `roots`: the directories that hold its screen code.
- `screenFiles`: patterns, matched inside each root, for the files that are
  screens. `**` matches across directories and `*` does not, so
  `*Screen.kt` matches only files directly in `src/android`.

With `roots` and `screenFiles`, Starboard checks **reverse coverage**: every
file that matches must be claimed by a screen's `files`, or listed under
`unmapped` in `screens.yaml` with a reason. A new screen file that nobody
registered fails [unregistered-screen-file](../../rules/unregistered-screen-file/).
Without `screenFiles`, a platform has no reverse coverage.

A screen is on every platform unless it lists a subset under `platforms`,
and then it needs a `platformNote` saying why.

## Form factors

A **form factor** is a named frame size, in points, that wireframes are
drawn at. Five are built in:

| Form factor | Width | Height |
| --- | --- | --- |
| `phone` | 390 | 844 |
| `tablet` | 820 | 1180 |
| `desktop` | 1280 | 800 |
| `web-narrow` | 390 | 844 |
| `web-wide` | 1440 | 900 |

`formFactors` in `starboard.yaml` changes a built-in size or adds a new
one:

```yaml
formFactors:
  phone:
    width: 393
    height: 852
  watch:
    width: 198
    height: 242
```

A screen gets one wireframe for each form factor of each of its platforms:
`trip.timeline`, on iOS, Android and the web, is drawn at `phone`,
`web-narrow` and `web-wide`. Each form factor uses the screen's `layout`,
unless the screen has an override for it under `layouts`; see
[Desktop and web layouts](../../guides/desktop-and-web/).

## Areas

`areas` lists the parts of the product, such as
`[auth, home, trip, activity, sharing, settings]`. Every screen belongs to
one. The generated catalog and app map group screens by area, in this
order.

The full list of settings is in the
[`starboard.yaml` reference](../../reference/starboard-yaml/).
