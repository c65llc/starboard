// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

/** The release the app was built from (`vX.Y.Z`, or `dev`): vite.config.ts defines it, as website/scripts/version.mjs does for the site. */
declare const __APP_VERSION__: string;

/**
 * elkjs's layout engine as a Worker-shaped object that runs on this
 * thread: what the embed build's map/engine-embed.ts lays the map out with.
 */
declare module "elkjs/lib/elk-worker.min.js" {
  export const Worker: new () => globalThis.Worker;
}
