---
name: starboard
description: Use when reading or editing a project's Starboard reference (screens.yaml, flow files or starboard.yaml), so every edit stays formatted, lint-clean and in step with the generated pages.
---

# Starboard

Starboard keeps a product's screens and user flows as plain text in the repo: a screen registry, Markdown flows, and pages generated from them. This runbook is how to read that reference and change it safely.

## When to use

- Before answering a question about a screen, a region, a flow or how screens connect, when the project has a `starboard.yaml`
- Before and after any edit to `starboard.yaml`, `screens.yaml` or a flow file
- When `starboard lint` reports findings, locally or in CI
- Together with `starboard-propose` (plan a change), `starboard-implement` (build it on one platform) and `starboard-adopt` (start a reference for an existing app)

## Workflow

1. **Find the reference.** `starboard.yaml` sits at the project root. Its `content` key names the content root (default `docs/flows`), which holds:
   - `screens.yaml`: the registry of screens
   - `flows/<flow-id>.md`: one Markdown file per user flow
   - `generated/`: the app map, the screen catalog and the wireframes, written by `starboard generate`
   - `README.md`: a short guide for people

   `starboard.yaml` also lists the `platforms` (each with `formFactors`, source `roots` and `screenFiles` patterns), any extra `formFactors`, the `areas` in display order, and optional `vocabularies`.

2. **Read a screen.** Each key under `screens:` is a stable dotted ID such as `trip.timeline`. A screen has `title`, `area`, `purpose`, `presentation` (`root`, `push`, `tab`, `sheet`, `dialog`, `window` or `route`), `status`, optional `platforms` (a subset needs a `platformNote`), `states`, `files` (the source files per platform), `screenshots`, a `layout`, and optional per-form-factor `layouts` that replace the whole tree.
   - `status` is `shipped` or `proposed`, either one value or a map per platform such as `{ios: shipped, android: proposed}`. A platform missing from the map counts as `shipped`, so list every platform.
   - `unmapped:` lists screen-pattern files that are deliberately not screens, each with a `reason`.

3. **Read a region.** A layout is a tree of regions. Each node has a `region` name (unique in its tree), a `kind`, and optionally `label` (what the content is, not final copy), `to` (a target screen ID, which is navigation), `requires`, `status`, `platformNote`, `width`, `children` (containers only), `item` and `empty` (lists only) or `items` (tabs, nav and menus only). A region is written `@screen.id#region`, and the same name in the default layout and an override means the same region.

4. **Read the map and the flows.** The app map in `generated/app-map.md` is navigation only: every `to` edge, with no order and no action wording. A flow is one ordered path: front matter (`id`, `title`, `status`, `actors`, `entry`, optional `platforms`), a **Goal**, a Mermaid diagram, and a `## Steps` numbered list. Each step's first `@screen#region` reference locates that step; later references and sub-bullets add detail and branches. Run `starboard render <screen-id>` to see one screen's wireframe.

5. **Edit, then check.** After every edit to reference files, run `starboard fmt` then `starboard lint --json`, and fix findings by `rule`:

   ```bash
   starboard fmt          # canonical form for every source file
   starboard lint --json  # {"version":1,"errors":[...],"warnings":[...]}
   ```

   Each finding carries `rule`, `severity`, `file`, `path` (where in the file, such as `screens.trip.timeline.files.ios[0]`), an optional `line`, `message` and, when a safe fix exists, `fix`. Act on the `rule`, not on the wording of the message.

6. **Fix by rule.** The usual ones:
   - A `generated-stale` finding: run `starboard generate`, or `starboard lint --fix`, which formats and regenerates.
   - A `not-formatted` finding: run `starboard fmt`.
   - The `edge-unresolved` and `ref-unresolved` rules: a `to` or an `@` reference names a screen or region that does not exist. Fix the ID or register the screen.
   - The `file-missing` rule: a `files` or `screenshots` path does not exist on a platform where the screen is `shipped`.
   - The `unregistered-screen-file` rule: a file matching a platform's `screenFiles` is claimed by no screen. Register it, or list it under `unmapped` with a reason.
   - The `status-conflict` and `shipped-flow-proposed-ref` rules: a `shipped` region under a `proposed` screen, or a `shipped` flow that refers to something `proposed`.
   - When a `schema-invalid` or `config-invalid` finding is unclear, run `starboard schema screens` or `starboard schema config` to see the exact grammar.

7. **Repeat** steps 5 and 6 until `starboard lint` exits 0. With `starboard lint --strict`, warnings fail too.

## Rules

- Never hand-edit `generated/`; run `starboard generate` or `starboard lint --fix` to rewrite it.
- Never skip `starboard lint` after an edit to reference files, and never report a change as done while it fails.
- Correctness rules are always errors and cannot be configured. Quality rules can be set to `error`, `warn` or `off` under `lint.rules` in `starboard.yaml`; do not change them to silence a finding unless the person asks.
- IDs are stable. Renaming a screen or region means updating every `to` and every `@` reference to it in the same change.
- The map is navigation only. Put order, actions and wording in a flow, not in the registry.
- A `label` says what the content is, not its final copy.
- When changing the reference, edit only the content root and `starboard.yaml`; platform code is the job of `starboard-implement`.
