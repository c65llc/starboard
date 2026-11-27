// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// CodeMirror 6 for a flow's Markdown body, loaded on demand as its own
// chunk. It lives in a shadow root for the CSP's sake, as the screen
// editor's Source tab does (src/screens/codemirror.ts says why). It adds:
// @ autocomplete of screen IDs and of a screen's regions after #, lint
// markers from core.lint of the draft, and highlighting of headings and
// references. Saving is the view's: ⌘/Ctrl-S and the idle autosave.

import { autocompletion, completionKeymap, completionStatus } from "@codemirror/autocomplete";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { forceLinting, linter, lintKeymap } from "@codemirror/lint";
import type { Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { Annotation, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { Decoration, EditorView, keymap, lineNumbers, MatchDecorator, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

import { diff } from "./body.ts";
import type { BodyMark } from "./body.ts";
import { refContext } from "./refs.ts";
import type { RefContext, RefSyntax } from "./refs.ts";

export interface FlowEditorOptions {
  text: string;
  label: string;
  /** Core's reference pattern, compiled (refs.ts refSyntax). */
  syntax: RefSyntax;
  /** The completions for a context refContext found. */
  complete(ctx: Exclude<RefContext, null>): Completion[];
  /** The findings for a draft of the body, placed on its lines. */
  lint(body: string): Promise<BodyMark[]>;
  onChange(body: string): void;
}

export interface FlowView {
  text(): string;
  /**
   * Replaces the text with the file's, keeping the cursor where it was as
   * far as it can; onChange is not called. While a completion list is open
   * it waits for it to close, unless force.
   */
  set(text: string, force?: boolean): void;
  /** Re-runs lint now, as when the project's other files changed. */
  relint(): void;
  /** Puts the cursor at the start of line (1-based) and focuses the editor. */
  reveal(line: number): void;
  focus(): void;
  destroy(): void;
}

const theme = EditorView.theme({
  "&": {
    color: "var(--color-ink)",
    backgroundColor: "var(--color-surface)",
    fontSize: "var(--text-sm)",
    height: "100%",
  },
  "&.cm-focused": { outline: "2px solid var(--color-focus)", outlineOffset: "-2px" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.7", overflow: "auto" },
  ".cm-content": { caretColor: "var(--color-ink)", padding: "var(--space-3) 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-ink)" },
  ".cm-gutters": {
    backgroundColor: "var(--color-surface-sunken)",
    color: "var(--color-muted)",
    borderRight: "1px solid var(--color-border)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--color-ok-bg)",
  },
  ".cm-heading": { fontWeight: "600" },
  ".cm-ref": { color: "var(--color-flow)", backgroundColor: "var(--color-ok-bg)", borderRadius: "3px" },
  ".cm-tooltip": {
    backgroundColor: "var(--color-surface)",
    color: "var(--color-ink)",
    border: "1px solid var(--color-border-strong)",
    borderRadius: "var(--radius-md)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--color-flow)", color: "var(--color-on-flow)" },
  ".cm-completionDetail": { color: "inherit", opacity: "1", marginLeft: "1em" },
  ".cm-diagnostic-error": { borderLeftColor: "var(--color-error)" },
  ".cm-diagnostic-warning": { borderLeftColor: "var(--color-warn)" },
});

/** decorate marks each match of re with class cls, from skip(match) characters into it. */
function decorate(re: RegExp, cls: string, skip: (m: RegExpExecArray) => number = () => 0) {
  const mark = Decoration.mark({ class: cls });
  const matcher = new MatchDecorator({
    regexp: re,
    decorate: (add, from, to, m) => add(from + skip(m), to, mark),
  });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }
      update(u: ViewUpdate) {
        this.decorations = matcher.updateDeco(u, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/** Marks the changes set makes, which are the file's, not the user's. */
const fromFile = Annotation.define<boolean>();

/** mount puts a flow editor holding opts.text into a shadow root on host. */
export function mount(host: HTMLElement, opts: FlowEditorOptions): FlowView {
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });

  const complete = (cx: CompletionContext): CompletionResult | null => {
    const line = cx.state.doc.lineAt(cx.pos);
    const ctx = refContext(line.text.slice(0, cx.pos - line.from), line.from, opts.syntax);
    if (!ctx) return null;
    const options = opts.complete(ctx);
    // No validFor: each keystroke asks refContext again, so the list follows the pattern.
    return options.length > 0 ? { from: ctx.from, options } : null;
  };

  const lint = async (view: EditorView): Promise<CmDiagnostic[]> => {
    const marks = await opts.lint(view.state.doc.toString());
    const doc = view.state.doc;
    return marks.map((m) => {
      const line = doc.line(Math.min(Math.max(1, m.line), doc.lines));
      const from = line.from + Math.min(m.from, line.length);
      return {
        from,
        to: Math.max(from, line.from + Math.min(m.to, line.length)),
        severity: m.severity,
        source: m.rule,
        message: m.message,
      };
    });
  };

  // The file's text set had to hold back, and the text it was to replace.
  let waiting: { expect: string; next: string } | null = null;

  const view = new EditorView({
    root,
    parent: root,
    state: EditorState.create({
      doc: opts.text,
      extensions: [
        lineNumbers(),
        history(),
        EditorView.lineWrapping,
        // no indentWithTab: Tab must leave the editor
        keymap.of([...completionKeymap, ...lintKeymap, ...defaultKeymap, ...historyKeymap]),
        autocompletion({ override: [complete], icons: false }),
        linter(lint, { delay: 300 }),
        decorate(/^#{1,6}[ \t].*$/g, "cm-heading"),
        // References as core reads them; group 1 is the character before the @.
        decorate(new RegExp(opts.syntax.pattern, "g"), "cm-ref", (m) => (m[1] ?? "").length),
        theme,
        EditorView.contentAttributes.of({ "aria-label": opts.label, tabindex: "0" }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((t) => t.annotation(fromFile))) opts.onChange(u.state.doc.toString());
          if (waiting && completionStatus(u.state) === null) {
            const w = waiting;
            waiting = null;
            if (u.state.doc.toString() === w.expect) queueMicrotask(() => replace(w.next));
          }
        }),
      ],
    }),
  });

  /** replace changes only the part of the text that differs (formatting usually touches little), so the cursor stays put. */
  function replace(next: string): void {
    const now = view.state.doc.toString();
    if (now === next) return;
    const d = diff(now, next);
    const head = view.state.selection.main.head;
    const at = head <= d.from ? head : head >= d.to ? head + next.length - now.length : d.from + d.insert.length;
    view.dispatch({
      changes: d,
      selection: EditorSelection.cursor(at),
      annotations: [fromFile.of(true), Transaction.addToHistory.of(false)],
    });
  }

  return {
    text: () => view.state.doc.toString(),
    set(next, force = false) {
      // Any change but typing closes an open completion list, so while one
      // is open the file's text waits, and is dropped if the user types on;
      // unless forced, as by a reload, whose text must replace the draft.
      if (!force && completionStatus(view.state) !== null) {
        waiting = { expect: view.state.doc.toString(), next };
        return;
      }
      waiting = null;
      replace(next);
    },
    relint: () => forceLinting(view),
    reveal(line) {
      const at = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines)).from;
      view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
      view.focus();
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
