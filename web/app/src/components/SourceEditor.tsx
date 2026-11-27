// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The Source tab: screens.yaml in CodeMirror (src/screens/codemirror.ts,
// loaded on first use). It is read-only while the registry parses, when
// the other tabs edit it; once it does not parse they cannot, and this is
// where it is mended: Save writes the text as typed, and lint and the
// model follow from it.

import { useEffect, useRef, useState } from "preact/hooks";

import type { SourceView } from "../screens/codemirror.ts";
import { sourceLine } from "../screens/editor.ts";

interface Props {
  path: string;
  text: string;
  editable: boolean;
  onSave(text: string): void;
}

export function SourceEditor({ path, text, editable, onSave }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<SourceView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const name = path.split("/").pop() ?? path;
  // The props as they stand, for the editor that mounts after an await.
  const latest = useRef({ text, editable });
  latest.current = { text, editable };

  useEffect(() => {
    let live = true;
    import("../screens/codemirror.ts")
      .then((cm) => {
        if (!live || !host.current) return;
        view.current = cm.mount(host.current, latest.current.text, latest.current.editable, `${name} source`);
        if (sourceLine.value !== null) view.current.reveal(sourceLine.value);
      })
      .catch((err: unknown) => live && setFailed(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
      view.current?.destroy();
      view.current = null;
    };
    // Mounted once, under the name it first had; later texts arrive through update below.
  }, []);

  useEffect(() => {
    view.current?.update(text, editable);
  }, [text, editable]);

  const line = sourceLine.value;
  useEffect(() => {
    if (line !== null) view.current?.reveal(line);
  }, [line]);

  return (
    <div class="source">
      <p class="source__path">
        <code>{path}</code> · {editable ? "editable: it does not parse, so fix it here" : "read-only while it parses; edit it in the other tabs"}
      </p>
      {failed ? <p class="alert">The source editor could not load: {failed}</p> : null}
      <div class="source__editor" ref={host} />
      {editable ? (
        <div class="source__actions">
          <button
            type="button"
            class="button button--primary button--small"
            onClick={() => view.current && onSave(view.current.text())}
          >
            Save {name}
          </button>
        </div>
      ) : null}
    </div>
  );
}
