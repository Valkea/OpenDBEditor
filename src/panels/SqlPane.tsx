import { CheckCircle2, CircleAlert, Copy, Download, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { generateSql } from '../sql/generator';
import type { Diagnostic } from '../sql/parser';
import { useStore } from '../store/store';
import { copyText, download, slug } from '../util/files';
import { CodeEditor } from './CodeEditor';

/** The live SQL twin: edits here re-parse into the canvas, canvas edits regenerate the text. */
export function SqlPane() {
  const schema = useStore((s) => s.schema);
  const origin = useStore((s) => s.origin);
  const [text, setText] = useState(() => generateSql(schema));
  const [diags, setDiags] = useState<Diagnostic[]>([]);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<number>(0);

  useEffect(() => {
    if (origin === 'sql') return;
    setText(generateSql(schema));
    setDiags([]);
    setDirty(false);
  }, [schema, origin]);

  const onChange = (v: string) => {
    setText(v);
    setDirty(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const d = useStore.getState().applySqlFromPane(v);
      setDiags(d);
      setDirty(false);
    }, 550);
  };

  const errors = useMemo(() => diags.filter((d) => d.severity === 'error'), [diags]);

  return (
    <aside className="sqlpane">
      <div className="pane-head">
        <span className="pane-title">SQL</span>
        <span className={`sync ${errors.length ? 'sync-err' : dirty ? 'sync-wait' : 'sync-ok'}`}>
          {errors.length ? (
            <>
              <CircleAlert size={13} /> {errors.length} error{errors.length > 1 ? 's' : ''} · canvas paused
            </>
          ) : dirty ? (
            'parsing…'
          ) : (
            <>
              <CheckCircle2 size={13} /> in sync
            </>
          )}
        </span>
        <span className="grow" />
        <button className="icon-btn" title="Copy SQL" onClick={async () => (await copyText(text)) && useStore.getState().toast('SQL copied')}>
          <Copy size={15} />
        </button>
        <button className="icon-btn" title="Download .sql (with layout)" onClick={() => download(`${slug(schema.name)}.sql`, generateSql(schema, { embedLayout: true }), 'application/sql')}>
          <Download size={15} />
        </button>
        <button className="icon-btn" title="Close" onClick={() => useStore.getState().set({ sqlOpen: false })}>
          <X size={15} />
        </button>
      </div>
      <CodeEditor value={text} onChange={onChange} diagnostics={diags} className="sqlpane-editor" />
      {errors.length > 0 && (
        <div className="pane-errors">
          {errors.slice(0, 4).map((d, i) => (
            <div key={i}>
              <b>L{d.line}</b> {d.message}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
