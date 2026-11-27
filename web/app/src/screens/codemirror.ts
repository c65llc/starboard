// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// CodeMirror 6 for the Source tab, loaded on demand as its own chunk.
//
// The CSP's style-src is 'self', and CodeMirror's style-mod writes its
// styles into a <style> element when mounted in a document, which that
// policy refuses. Mounted in a shadow root, style-mod uses a constructed
// stylesheet (adoptedStyleSheets) instead, which no CSP governs; so the
// editor lives in a shadow root and the policy stays as it is. Its colours
// are the app's tokens, which custom properties carry into the shadow.

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export interface SourceView {
  /** The editor's text now. */
  text(): string;
  /** Shows text, replacing what is there only if it differs, and sets whether it may be edited. */
  update(text: string, editable: boolean): void;
  /** Scrolls line (1-based) into view and puts the cursor at its start. */
  reveal(line: number): void;
  focus(): void;
  destroy(): void;
}

const theme = EditorView.theme({
  "&": {
    color: "var(--color-ink)",
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-border-strong)",
    borderRadius: "var(--radius-md)",
    fontSize: "var(--text-sm)",
    height: "100%",
  },
  "&.cm-focused": { outline: "2px solid var(--color-focus)", outlineOffset: "2px" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6", overflow: "auto" },
  ".cm-content": { caretColor: "var(--color-ink)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-ink)" },
  ".cm-gutters": {
    backgroundColor: "var(--color-surface-sunken)",
    color: "var(--color-muted)",
    borderRight: "1px solid var(--color-border)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--color-ok-bg)",
  },
});

const highlight = HighlightStyle.define([
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "var(--color-flow)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--color-ink)" },
  { tag: [tags.comment, tags.lineComment], color: "var(--color-muted)", fontStyle: "italic" },
  { tag: [tags.number, tags.bool, tags.null, tags.keyword], color: "var(--color-nav)" },
  { tag: [tags.punctuation, tags.separator, tags.squareBracket, tags.brace], color: "var(--color-secondary)" },
]);

/** mount puts an editor holding text into a shadow root on host, labelled label. */
export function mount(host: HTMLElement, text: string, editable: boolean, label: string): SourceView {
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const access = new Compartment();
  const modes = (on: boolean) => [EditorState.readOnly.of(!on)];
  const view = new EditorView({
    root,
    parent: root,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]), // no indentWithTab: Tab must leave the editor
        yaml(),
        syntaxHighlighting(highlight),
        theme,
        // tabindex makes the content a tab stop axe recognises inside its scroller.
        EditorView.contentAttributes.of({ "aria-label": label, tabindex: "0" }),
        access.of(modes(editable)),
      ],
    }),
  });
  return {
    text: () => view.state.doc.toString(),
    update(next, on) {
      const same = view.state.doc.toString() === next;
      view.dispatch({
        ...(same ? {} : { changes: { from: 0, to: view.state.doc.length, insert: next } }),
        effects: access.reconfigure(modes(on)),
      });
    },
    reveal(line) {
      const at = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines)).from;
      view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
