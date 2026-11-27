---
name: starboard-adopt
description: Use when adding Starboard to an existing app, to bootstrap the screen registry and flows from the code area by area until every screen file is registered.
---

# Starboard: adopt an existing app

Adoption writes the reference for an app that already exists: every screen registered from its source, helpers set aside with a reason, layouts drawn from the code, then the flows. Reverse coverage is the to-do list. Read the `starboard` skill first for the file formats and the check loop.

## When to use

- A repository without `starboard.yaml` that should get a Starboard reference
- A project whose `starboard lint` reports many `unregistered-screen-file` findings because a platform was just added

## Workflow

1. **Initialise.** Run `starboard init` with one `--platform` per platform, such as `starboard init --platform ios --platform android`. It writes `starboard.yaml`, the content root with an example screen and flow, its generated pages, and `.gitattributes` lines; keep those lines. It refuses to overwrite an existing project.

2. **Configure the platforms.** In `starboard.yaml`, give each platform its source `roots` (repo-relative directories) and its `screenFiles` patterns (matched inside each root; `**` spans directories, `*` does not), and list the app's `areas` in the order people meet them. Remove the example screen and flow once the first real ones exist.

3. **Get the to-do list.** Run `starboard lint --json`. Each `unregistered-screen-file` finding is one screen file no screen claims yet. Group them by area.

4. **Register screens area by area, from the platform's screen files.** For each file in the area:
   - If it is a screen, add it under `screens:` with an ID such as `<area>.<name>`, a `title`, the `area`, a one-sentence `purpose`, a `presentation`, `status: shipped` and its path under `files.<platform>`. A screen on several platforms gets every platform's files.
   - If it is a helper (a control, a row, a wrapper), add it under `unmapped` with a `reason` naming where it is used, such as `control inside trip.timeline#app-bar`.

5. **Write each screen's layout from its source.** Read the code and describe the regions in order, with the closest `kind`, a `label` for what the content is, and `to` for every navigation the screen performs. Add `layouts` overrides only where a form factor really differs. Check one with `starboard render <screen-id>`.

6. **Check and commit the area.** Run `starboard fmt`, then `starboard generate`, then `starboard lint --json`. Fix every error in the area (the `edge-unresolved` rule for a `to` whose target is not registered yet is the usual one; register it, even in another area). Until the last area is done, the only errors left should be `unregistered-screen-file` findings for files in areas not yet adopted. Then commit the area on its own. Repeat steps 4 to 6 until no `unregistered-screen-file` finding is left.

7. **Then write the flows.** With the screens registered, write one `flows/<flow-id>.md` per thing a person does, with numbered steps whose first `@screen#region` reference locates each step, and `status: shipped` for flows the app already supports. Run the check loop again, and commit.

## Rules

- Register from the code as it is, not as it should be; everything adoption writes is `shipped`, with real file paths. Plan changes later with `starboard-propose`.
- Never put a file in `unmapped` without a `reason`, and never both claim a file and list it as unmapped (the `unmapped-and-claimed` rule).
- Do not skip `starboard lint` at the end of an area; commit only when its only errors are `unregistered-screen-file` findings for areas not yet adopted, and finish with `starboard lint` passing.
- Commit per area, so each commit is reviewable.
- Never hand-edit `generated/`; `starboard generate` rewrites it.
- Do not change the app's code during adoption.
