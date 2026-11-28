// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app's single state and the actions the Open screen and the header
// take. Every project is opened here, so each path records Recent's summary
// and reports a failure the same way.

import { effect, signal } from "@preact/signals";
import type { Files } from "@c65llc/starboard-core";

import { getCore } from "./core.ts";
import { FsAccessHost, openFolder, reconnect, summaryRecorder } from "./host/fsaccess.ts";
import type { RecentEntry } from "./host/fsaccess.ts";
import type { Host, NativeOpener, ScopeFn } from "./host/host.ts";
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

/**
 * The desktop app's own ways to open a project (its folder dialog, its
 * recent list, the folder it was started with), which src/desktop.tsx
 * installs; null in the browser, where Open offers the browser's.
 */
export const nativeOpener = signal<NativeOpener | null>(null);

/** openWith opens the host make gives; make gives null when the user cancelled, which is no error. */
async function openWith(make: () => Promise<Host | null>): Promise<void> {
  if (opening.value) return;
  opening.value = true;
  openError.value = null;
  try {
    const host = await make();
    if (!host) return;
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
    return createMemoryHost(exampleFiles, { name: EXAMPLE_NAME, scope });
  });

/** openMemory opens files held in memory: the e2e hook's way in (src/e2e-hook.ts). */
export const openMemory = (files: Files, name: string) => openWith(() => Promise.resolve(createMemoryHost(files, { name, scope })));

export const openInPlace = () => openWith(() => openFolder({ scope }));

export const openRecent = (entry: RecentEntry) => openWith(() => reconnect(entry, { scope }));

export const openViewOnly = (files: FileList) => openWith(() => fromDirectoryInput(files, { scope }));

export const openDropped = (items: DataTransferItemList) => openWith(() => fromDrop(items, { scope }));

/** native is the installed NativeOpener; the desktop actions below are offered only when there is one. */
function native(): NativeOpener {
  const opener = nativeOpener.value;
  if (!opener) throw new Error("This is not the desktop app, so it has no folder dialog of its own.");
  return opener;
}

/**
 * Counts each open the desktop app's own ways made, or tried: opening moves
 * a project to the top of its recent list, and one that has moved or gone
 * leaves it, so Open reads the list again whenever this moves, whether the
 * open came from its buttons or the app's menu.
 */
export const nativeRecentsChanged = signal(0);

/** openNative opens through the desktop app, then says its recent list may have changed. */
const openNative = (make: () => Promise<Host | null>) =>
  openWith(make).finally(() => {
    nativeRecentsChanged.value++;
  });

/** openNativeFolder opens a folder the desktop app's own dialog picks. */
export const openNativeFolder = () => openNative(() => native().pick());

/** openNativeRecent reopens one of the desktop app's recent projects, by the path its list gave. */
export const openNativeRecent = (path: string) => openNative(() => native().reopen(path));

/** openNativeArg opens the folder the desktop app was started with, if any. */
export const openNativeArg = () => openNative(() => native().arg());

/**
 * downloadChanges saves a view-only host's pending changes as a download
 * and says where they go: one file by its base name, so the notice names
 * its project-relative path; several, or any deletion, as a zip. With
 * nothing pending it gives the last download again (until the next edit),
 * since the browser may have blocked or lost it.
 */
export function downloadChanges(): void {
  const host = app.host.value;
  if (!(host instanceof ReadonlyHost)) return;
  const only = host.downloadPath();
  const { deleted } = host.downloadSummary();
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

// Recent shows each folder's counts as of its last lint. Most lints leave
// them as they were; summaryRecorder writes only a change, in order, and
// counts it as written once IndexedDB has it.
const recordSummary = summaryRecorder();
effect(() => {
  const host = app.host.value;
  const lint = app.lint.value;
  const model = app.model.value;
  if (!(host instanceof FsAccessHost) || !lint || !model) return;
  void recordSummary(host.recentId, {
    screens: model.screens.length,
    flows: model.flows.length,
    errors: lint.errors,
    warnings: lint.warnings,
  });
});
