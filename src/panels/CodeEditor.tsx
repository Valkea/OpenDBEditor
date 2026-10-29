// CodeMirror 6 wrapper: PostgreSQL highlighting, lint diagnostics, themed via CSS variables.

import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import type { Diagnostic } from '../sql/parser';

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: [tags.typeName, tags.standard(tags.name)], color: 'var(--syn-type)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: [tags.lineComment, tags.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.special(tags.name), color: 'var(--syn-ident)' },
  { tag: tags.name, color: 'var(--text)' },
  { tag: tags.operator, color: 'var(--syn-op)' },
  { tag: tags.bool, color: 'var(--syn-number)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px', backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--text-faint)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--hover)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
  '.cm-tooltip': { background: 'var(--panel-solid)', border: '1px solid var(--line)', color: 'var(--text)' },
  '.cm-panels': { background: 'var(--panel-solid)', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
});

export interface CodeEditorProps {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  diagnostics?: Diagnostic[];
  className?: string;
}

export function CodeEditor({ value, onChange, readOnly, diagnostics, className }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const diagRef = useRef<Diagnostic[]>(diagnostics ?? []);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  diagRef.current = diagnostics ?? [];

  useEffect(() => {
    const exts: Extension[] = [
      basicSetup,
      sql({ dialect: PostgreSQL, upperCaseKeywords: true }),
      syntaxHighlighting(highlight),
      theme,
      EditorView.lineWrapping,
      lintGutter(),
      linter(
        (v) =>
          diagRef.current
            .filter((d) => d.to <= v.state.doc.length)
            .map<CmDiagnostic>((d) => ({ from: d.from, to: Math.max(d.to, d.from + 1), severity: d.severity, message: d.message })),
        { delay: 150 },
      ),
      EditorState.readOnly.of(!!readOnly),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && u.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete') || t.isUserEvent('undo') || t.isUserEvent('redo') || t.isUserEvent('move')))
          changeRef.current?.(u.state.doc.toString());
      }),
    ];
    view.current = new EditorView({ state: EditorState.create({ doc: value, extensions: exts }), parent: host.current! });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  useEffect(() => {
    // poke the linter so new diagnostics show up
    const v = view.current;
    if (v) v.dispatch({});
  }, [diagnostics]);

  return <div ref={host} className={`code ${className ?? ''}`} />;
}
