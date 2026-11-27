// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app's single state and the actions the Open screen and the header
// take. Every project is opened here, so each path records Recent's summary
// and reports a failure the same way.

import { effect, signal } from "@preact/signals";

import { getCore } from "./core.ts";
import { FsAccessHost, openFolder, reconnect, rememberSummary } from "./host/fsaccess.ts";
import type { RecentEntry } from "./host/fsaccess.ts";
import type { Host, ScopeFn } from "./host/host.ts";
import { createMemoryHost } from "./host/memory.ts";
import { fromDirectoryInput, fromDrop, ReadonlyHost } from "./host/readonly.ts";
import { navigate } from "./router.ts";
import { createState } from "./state.ts";

export const app = createState(getCore());

/** What went wrong opening a project, in words the user can act on; null when nothing did. */
export const openError = signal<string | null>(null);
/** A project is being opened. */
export const opening = signal(false);

const scope: ScopeFn = (files) => getCore().scope(files);

async function openWith(make: () => Promise<Host>): Promise<void> {
  if (opening.value) return;
  opening.value = true;
  openError.value = null;
  try {
    const host = await make();
    await app.open(host);
    navigate({ name: "screens" });
  } catch (err) {
    // The picker's own Cancel is not an error.
    if (!(err instanceof DOMException && err.name === "AbortError")) openError.value = describe(err);
  } finally {
    opening.value = false;
  }
}

function describe(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return `Starboard could not open the project (${String(err)}). Try again, or choose another folder.`;
}

export const openExample = () =>
  openWith(async () => {
    const { exampleFiles, EXAMPLE_NAME } = await import("./example.ts");
    return createMemoryHost(exampleFiles, { name: EXAMPLE_NAME });
  });

export const openInPlace = () => openWith(() => openFolder({ scope }));

export const openRecent = (entry: RecentEntry) => openWith(() => reconnect(entry, { scope }));

export const openViewOnly = (files: FileList) => openWith(() => fromDirectoryInput(files, { scope }));

export const openDropped = (items: DataTransferItemList) => openWith(() => fromDrop(items, { scope }));

/** downloadChanges saves a view-only host's pending changes as a download. */
export function downloadChanges(): void {
  const host = app.host.value;
  if (!(host instanceof ReadonlyHost)) return;
  const url = URL.createObjectURL(host.downloadPending());
  const a = document.createElement("a");
  a.href = url;
  a.download = host.downloadName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  host.clearPending();
  app.markDownloaded();
}

// Recent shows each folder's counts as of its last lint.
effect(() => {
  const host = app.host.value;
  const lint = app.lint.value;
  const model = app.model.value;
  if (!(host instanceof FsAccessHost) || !lint || !model) return;
  void rememberSummary(host.recentId, {
    screens: model.screens.length,
    flows: model.flows.length,
    errors: lint.errors,
    warnings: lint.warnings,
  }).catch(() => undefined); // Recent's counts are a convenience; never fail the project over them
});
