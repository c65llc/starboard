---
name: starboard-implement
description: Use when building proposed Starboard screens, regions or flows on one named platform, to implement them in that platform's code and mark them shipped in the same change.
---

# Starboard: implement a proposal on one platform

A proposal becomes `shipped` one platform at a time. The code, its file paths in the registry, and that platform's status flip land together, so the reference never claims something the code does not have. Read the `starboard` skill first for the file formats and the check loop.

## When to use

- A person asks to implement a proposed screen, region or flow on one platform (for example "build the new checkout sheet on iOS")
- After a proposal from `starboard-propose` has been reviewed and accepted

## Workflow

1. **Name the platform.** Work on exactly one platform from `starboard.yaml`'s `platforms`. If the person did not name one, ask.

2. **Find the proposed items for that platform.** In `screens.yaml`, a screen is proposed on the platform when its `status` is `proposed`, or its per-platform map says `proposed` for it. A region is proposed when its own `status` is `proposed`. Then list the flows with `status: proposed` that refer to those screens and regions, and read them: they say what a person does, step by step.

3. **Implement them in that platform's code.** Follow each screen's `layout` (or its override in `layouts` for the platform's form factors) for the regions, `to` for where each region navigates, and `requires` for gating. Work under the platform's `roots`, name screen files to match its `screenFiles` patterns, and follow the platform's own conventions and tests.

4. **Add the file paths under `files.<platform>`.** For each screen, list the exact repo-relative paths of the source files that implement it on this platform, with `/` separators. A helper file that matches `screenFiles` but is not a screen goes under `unmapped` with a reason.

5. **Flip that platform's status to `shipped`, in the same change as the code.** Only once the code and its file paths exist:
   - A screen with one `status` for every platform becomes a per-platform map: this platform `shipped`, every other platform still `proposed`, such as `status: {ios: shipped, android: proposed, web: proposed}`.
   - A screen already mapped per platform: change only this platform's entry.
   - A region's `status` is one value for every platform. Leave it `proposed` until every platform its screen runs on has it, and set it to `shipped` (or remove it) in the change that implements the last one.
   - A flow's `status` is one value too. Set it to `shipped` only when nothing it refers to is `proposed` on any of its platforms.
   - With the Starboard MCP tools, make these edits with `starboard_screen_set`, such as fields `{"files.ios": ["src/ios/TimelineView.swift"], "status": {"ios": "shipped", "android": "proposed", "web": "proposed"}}` (a dotted key such as `status.ios` works once `status` is a map), and `starboard_flow_set`; each writes the file formatted and returns the lint report.

6. **Check.** Run `starboard fmt`, then `starboard generate`, then `starboard lint --json` (with the MCP tools: `starboard_generate`, then `starboard_lint`), and fix findings by `rule`. Expect the `file-missing` rule if a path is wrong, the `unregistered-screen-file` rule if a new screen file is claimed by nothing, and the `status-conflict` or `shipped-flow-proposed-ref` rules if a status flipped too far. Then run the platform's own tests. Both must pass.

## Rules

- One platform per change. Leave the other platforms `proposed`.
- Never set `shipped` before the code and its file paths under `files.<platform>` exist; the status flip, the code and the paths land in the same change.
- Do not skip `starboard lint` or the platform's tests, and do not report the work done while either fails.
- Never hand-edit `generated/`; `starboard generate` rewrites it.
- If the code must differ from the proposal, change the reference in the same change and say so in the summary; do not let them drift.
- Do not change other platforms' code or files.
