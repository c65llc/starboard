// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app's single state and the actions the Open screen and the header
// take. Every project is opened here, so each path records Recent's summary
// and reports a failure the same way.

import { effect, signal } from "@preact/signals";
import type { Files } from "@c65llc/starboard-core";

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

/** openMemory opens files held in memory: the e2e hook's way in (src/e2e-hook.ts). */
export const openMemory = (files: Files, name: string) => openWith(() => Promise.resolve(createMemoryHost(files, { name })));

export const openInPlace = () => openWith(() => openFolder({ scope }));

export const openRecent = (entry: RecentEntry) => openWith(() => reconnect(entry, { scope }));

export const openViewOnly = (files: FileList) => openWith(() => fromDirectoryInput(files, { scope }));

export const openDropped = (items: DataTransferItemList) => openWith(() => fromDrop(items, { scope }));

/**
 * downloadChanges saves a view-only host's pending changes as a download
 * and says where they go: one file by its base name, so the notice names
 * its project-relative path; several, or any deletion, as a zip.
 */
export function downloadChanges(): void {
  const host = app.host.value;
  if (!(host instanceof ReadonlyHost)) return;
  const only = host.downloadPath();
  const { deleted } = host.summary();
  const name = host.downloadName();
  const url = URL.createObjectURL(host.downloadPending());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  // The link is put in the document for the click, which some browsers
  // need, and the URL outlives the click, as a browser may read the blob
  // after click returns.
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  host.clearPending();
  app.markDownloaded();
  app.notice.value =
    only !== null
      ? `Downloaded ${name}. Save as ${only} in your project.`
      : `Downloaded ${name}. Unzip ${name} into ${host.name}` +
        (deleted.length > 0 ? ", then delete the files .starboard-deleted.txt lists, and that list too." : ".");
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
