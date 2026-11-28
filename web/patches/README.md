# Package patches

Every patch in this directory is listed here with its reason, its regression
test and its removal criterion (see the root `AGENTS.md`). The patches are
registered under `patchedDependencies` in `../pnpm-workspace.yaml`.

## @preact/signals-core@1.14.5

File: `@preact__signals-core@1.14.5.patch`

**Reason.** The desktop app freezes `Object.prototype` (Tauri's
`freezePrototype`). signals-core 1.14.5 assigns `valueOf`, `toString` and
`toJSON` on `Signal.prototype`; with a frozen `Object.prototype` that
assignment throws in strict code (the "override mistake"). The patch defines
the three with `Object.defineProperty` in each shipped build (`dist/*.js`,
`*.min.js`, `*.mjs`, `*.module.js`), which does not throw.

**Regression test.** `app/e2e/frozen-prototype.spec.ts` (in `web/app`) loads
the app with `Object.prototype` frozen and fails if a dependency assigns to it.

**Removal criterion.** Drop the patch when signals-core defines those
properties with `Object.defineProperty` upstream, or when the app stops using
`freezePrototype`. Check on every signals-core bump: pnpm fails the install
if the pinned version changes, so the patch cannot silently go stale.
