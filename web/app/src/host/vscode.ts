// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The host inside the VS Code extension's panel (embed.tsx): each read and
// write is a message to the extension (vscode-messages.ts), which reads
// the project with the editor's unsaved buffers laid over the disk and
// writes through applyCoreResult, a WorkspaceEdit, so nothing is written
// behind a dirty buffer. The extension writes only a result core gave this
// page; the Source tab, the app's one raw-text write, is hidden here.

import type { Files } from "@c65llc/starboard-core";

import { checkChanges, checkPath, DEFAULT_CONTENT } from "./host.ts";
import type { Host, Stamp } from "./host.ts";
import { checkFromExtension, checkValue } from "./vscode-messages.ts";
import type { FromExtension, ReadAllResult, Request, RequestType, ToExtension } from "./vscode-messages.ts";

/**
 * The notice when the panel reads the project again: in VS Code the
 * change is as often a buffer typed in as a file on disk.
 */
export const EDITOR_RELOADED_NOTICE = "Reloaded: changed in the editor or on disk";

/** Distributes Omit over a union, so each request keeps its own fields. */
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

/** The two ends a Channel needs: VS Code's webview API and the window's message events. */
export interface ChannelEnds {
  post(msg: ToExtension): void;
  listen(handle: (data: unknown) => void): void;
  /** Where a refused message is reported. */
  warn(message: string): void;
}

/** The extension refused a request, or answered it with something other than it asked for. */
export class PanelError extends Error {
  override name = "PanelError";
}

/**
 * Channel is the page's end of the message protocol: request sends a
 * Request and settles with the reply of its id, checked against what was
 * asked; on adds a handler for the extension's other messages. Messages
 * that fail their guard are dropped and reported through warn.
 */
export class Channel {
  private readonly ends: ChannelEnds;
  private next = 1;
  private readonly pending = new Map<number, { type: RequestType; resolve(v: unknown): void; reject(e: Error): void }>();
  private readonly handlers: ((msg: Exclude<FromExtension, { type: "reply" }>) => void)[] = [];

  constructor(ends: ChannelEnds) {
    this.ends = ends;
    ends.listen((data) => this.receive(data));
  }

  request<T>(msg: WithoutId<Request>): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { type: msg.type, resolve: resolve as (v: unknown) => void, reject });
      this.ends.post({ ...msg, id } as Request);
    });
  }

  /** send posts a message that has no reply. */
  send(msg: Exclude<ToExtension, Request>): void {
    this.ends.post(msg);
  }

  on(handle: (msg: Exclude<FromExtension, { type: "reply" }>) => void): void {
    this.handlers.push(handle);
  }

  private receive(data: unknown): void {
    const checked = checkFromExtension(data);
    if (!checked.ok) {
      this.ends.warn(`Starboard ignored a message from the extension: ${checked.error}`);
      return;
    }
    const msg = checked.value;
    if (msg.type !== "reply") {
      for (const h of this.handlers) h(msg);
      return;
    }
    const call = this.pending.get(msg.id);
    if (!call) return;
    this.pending.delete(msg.id);
    if (!msg.ok) {
      const err = new PanelError(msg.error);
      // The host's own refusals keep their names, as the state reads them.
      err.name = msg.name;
      call.reject(err);
      return;
    }
    const value = checkValue(call.type, msg.value);
    if (value.ok) call.resolve(value.value);
    else call.reject(new PanelError(value.error));
  }
}

interface VsCodeApi {
  postMessage(msg: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let channel: Channel | undefined;

/** getChannel is the page's one Channel, over VS Code's webview API, which a page may acquire only once. */
export function getChannel(): Channel {
  if (!channel) {
    const api = acquireVsCodeApi();
    channel = new Channel({
      post: (msg) => api.postMessage(msg),
      listen: (handle) => addEventListener("message", (e: MessageEvent) => handle(e.data)),
      warn: (message) => console.warn(message),
    });
  }
  return channel;
}

/** VscodeHost is a Host whose files the extension reads and writes. */
export class VscodeHost implements Host {
  readonly kind = "vscode";
  readonly name: string;
  readonly canWrite = true;
  private readonly channel: Channel;
  private content = DEFAULT_CONTENT;
  private listed: ReadonlySet<string> = new Set();

  constructor(channel: Channel, name: string) {
    this.channel = channel;
    this.name = name;
  }

  async readAll(): Promise<Files> {
    const got = await this.channel.request<ReadAllResult>({ type: "readAll" });
    this.content = got.content;
    this.listed = new Set(got.listedOnly);
    return got.files;
  }

  async read(path: string): Promise<string | null> {
    checkPath(path);
    return this.channel.request<string | null>({ type: "read", path });
  }

  async stat(path: string): Promise<Stamp | null> {
    checkPath(path);
    return this.channel.request<Stamp | null>({ type: "stat", path });
  }

  listedOnly(): ReadonlySet<string> {
    return this.listed;
  }

  async write(changes: Record<string, string | null>): Promise<void> {
    checkChanges(changes, this.content);
    if (Object.keys(changes).length === 0) return;
    await this.channel.request<null>({ type: "write", changes });
  }
}
