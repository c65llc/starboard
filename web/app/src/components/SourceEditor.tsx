// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The Source tab: screens.yaml in CodeMirror (src/screens/codemirror.ts,
// loaded on first use). It is read-only while the registry parses, when
// the other tabs edit it; once it does not parse they cannot, and this is
// where it is mended: Save writes the text as typed, and lint and the
// model follow from it. Typing not yet saved there is kept when the file
// is read again from disk (a reload): the editor says so, and Discard my
// text takes the file's.

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
  // The text last handed to the editor; the editor holding anything else
  // means unsaved typing.
  const given = useRef(text);
  // The file changed underneath unsaved typing, which was kept.
  const [stale, setStale] = useState(false);
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
        given.current = latest.current.text;
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

  /** take shows the file's text, dropping any typing. */
  const take = () => {
    view.current?.update(latest.current.text, latest.current.editable);
    given.current = latest.current.text;
    setStale(false);
  };

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const typed = v.text();
    if (editable && typed !== given.current && typed !== text) {
      setStale(true); // unsaved typing: keep it, and say the file moved under it
      return;
    }
    take();
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
      {stale && editable ? (
        <p class="alert source__stale">
          {name} changed on disk while you were typing. Your text is kept: Save {name} writes it over the change.{" "}
          <button type="button" class="button button--small" onClick={take}>
            Discard my text
          </button>
        </p>
      ) : null}
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
