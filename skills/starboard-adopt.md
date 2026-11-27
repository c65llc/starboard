---
name: starboard-adopt
description: Use when adding Starboard to an existing app, to bootstrap the screen registry and flows from the code area by area, keeping starboard lint passing at every commit.
---

# Starboard: adopt an existing app

Adoption writes the reference for an app that already exists: every screen registered from its source, helpers set aside with a reason, layouts drawn from the code, then the flows. Reverse coverage is the to-do list, widened one area at a time so `starboard lint` passes at every commit. Read the `starboard` skill first for the file formats and the check loop.

## When to use

- A repository without `starboard.yaml` that should get a Starboard reference
- A project adding a platform whose screen files are not registered yet

## Workflow

1. **Initialise.** Run `starboard init` with one `--platform` per platform, such as `starboard init --platform ios --platform android`. It writes `starboard.yaml`, the content root with an example screen and flow, its generated pages, and `.gitattributes` lines; keep those lines. It refuses to overwrite an existing project. Run `starboard lint` and commit: a fresh project passes.

2. **Survey the screen files, without committing.** In `starboard.yaml`, give each platform its source `roots` (repo-relative directories) and its full `screenFiles` patterns, such as `'**/*View.swift'` (matched inside each root; `**` spans directories, `*` does not). Run `starboard lint --json`: each `unregistered-screen-file` finding is one screen file. Group them into the app's areas, list the `areas` in the order people meet them, and write the plan down. Then narrow each platform's `screenFiles` to nothing yet adopted: remove the patterns, keeping `roots`, so reverse coverage is off and `starboard lint` passes again.

3. **Widen coverage to one area.** Add that area's patterns to each platform's `screenFiles`. A pattern is matched inside each root, so a directory prefix scopes it, such as `'Timeline/**/*View.swift'`; an exact path with no wildcards, such as `'Settings/SettingsView.swift'`, matches one file when an area is not one directory. Run `starboard lint --json`: the `unregistered-screen-file` findings are now exactly this area's to-do list.

4. **Register the area's screens from the platform's screen files.** For each file the area's patterns match:
   - If it is a screen, add it under `screens:` with an ID such as `<area>.<name>`, a `title`, the `area`, a one-sentence `purpose`, a `presentation`, `status: shipped` and its path under `files.<platform>`. A screen on several platforms gets every platform's files.
   - If it is a helper (a control, a row, a wrapper), add it under `unmapped` with a `reason` naming where it is used, such as `control inside trip.timeline#app-bar`.

5. **Write each screen's layout from its source.** Read the code and describe the regions in order, with the closest `kind`, a `label` for what the content is, and `to` for every navigation the screen performs. Add `layouts` overrides only where a form factor really differs. Check one with `starboard render <screen-id>`. A `to` whose target lives in a later area needs that screen registered now (the `edge-unresolved` rule): register it with its files, and widen the patterns to cover its file too.

6. **Check and commit the area.** Run `starboard fmt`, then `starboard generate`, then `starboard lint --json`, and fix every error. Commit the area on its own only when `starboard lint` passes. Remove the example screen and flow from `starboard init` once the first real ones exist. Repeat steps 3 to 6 for each area.

7. **Restore the full patterns.** When every area is done, replace each platform's per-area patterns with the full ones from step 2. `starboard lint` must still pass, which shows that no screen file is left unregistered. Commit.

8. **Then write the flows.** With the screens registered, write one `flows/<flow-id>.md` per thing a person does, with numbered steps whose first `@screen#region` reference locates each step, and `status: shipped` for flows the app already supports. Run the check loop again, and commit.

## Rules

- Commit only with `starboard lint` passing; do not skip it, and never commit while it reports errors.
- Widen `screenFiles` one area at a time; never commit patterns that match files the registry does not yet claim or list as unmapped.
- Register from the code as it is, not as it should be; everything adoption writes is `shipped`, with real file paths. Plan changes later with `starboard-propose`.
- Never put a file in `unmapped` without a `reason`, and never both claim a file and list it as unmapped (the `unmapped-and-claimed` rule).
- Commit per area, so each commit is reviewable.
- Never hand-edit `generated/`; `starboard generate` rewrites it.
- Do not change the app's code during adoption.
