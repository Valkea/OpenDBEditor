import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Lock,
  LockOpen,
  StickyNote,
  Trash2,
  Waypoints,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { uid } from '../model/ids';
import { NOTE_COLORS, PALETTE } from '../model/palette';
import type { Column, FkAction, Schema, Table } from '../model/types';
import { relationDDL, tableDDL } from '../sql/generator';
import { BUILTIN_TYPES, canonicalType, EXTENSIONS, FK_ACTIONS, isSerial } from '../sql/pg';
import { parseSql } from '../sql/parser';
import { useIssues } from '../store/derived';
import { useStore } from '../store/store';
import { copyText } from '../util/files';
import { CodeEditor } from './CodeEditor';
import { IssueRow } from './IssueRow';
import { type TypeGroup, TypePicker } from './TypePicker';
import { useFly as useCameraFly } from './useFly';

/** Fly to a table from the inspector, keeping the way back. */
function useFly() {
  const fly = useCameraFly();
  return (tableId: string, columnId?: string) => useStore.getState().visit(() => fly(tableId, columnId));
}

export function Inspector() {
  const sel = useStore((s) => s.selection);
  const exists = useStore((s) => {
    if (!sel) return false;
    if (sel.kind === 'table') return s.schema.tables.some((t) => t.id === sel.id);
    if (sel.kind === 'relation') return s.schema.relations.some((t) => t.id === sel.id);
    if (sel.kind === 'note') return s.schema.notes.some((t) => t.id === sel.id);
    if (sel.kind === 'group') return s.schema.groups.some((t) => t.id === sel.id);
    return s.schema.enums.some((t) => t.id === sel.id);
  });
  if (!sel || !exists || sel.kind === 'enum') return null;
  return (
    <aside className="inspector" key={`${sel.kind}:${sel.id}`}>
      {sel.kind === 'table' && <TableInspector id={sel.id} columnId={sel.columnId} />}
      {sel.kind === 'relation' && <RelationInspector id={sel.id} />}
      {sel.kind === 'note' && <NoteInspector id={sel.id} />}
      {sel.kind === 'group' && <GroupInspector id={sel.id} />}
    </aside>
  );
}

function Head({ title, children }: { title: string; children?: React.ReactNode }) {
  const back = useStore((s) => (s.trail && s.trail.at === s.selection ? s.trail.stack[s.trail.stack.length - 1] : undefined));
  return (
    <div className="pane-head">
      {back && (
        <button className="icon-btn" title={`Back to the ${back.kind}`} onClick={() => useStore.getState().back()}>
          <ArrowLeft size={15} />
        </button>
      )}
      <span className="pane-title">{title}</span>
      <span className="grow" />
      {children}
      <button className="icon-btn" title="Close" onClick={() => useStore.getState().select(null)}>
        <X size={15} />
      </button>
    </div>
  );
}

const COMMON_TYPES = ['text', 'bigint', 'integer', 'uuid', 'boolean', 'timestamptz', 'date', 'numeric(12, 2)', 'jsonb', 'varchar(255)', 'text[]'];

function useTypeGroups(): TypeGroup[] {
  const schema = useStore((s) => s.schema);
  return useMemo(() => {
    const enabled = new Set(schema.extensions.map((e) => e.name));
    const ext = EXTENSIONS.filter((e) => enabled.has(e.name)).flatMap((e) => e.types ?? []);
    if (enabled.has('vector')) ext.push('vector(1536)');
    return [
      { label: 'Common', types: COMMON_TYPES },
      { label: 'Enums', types: schema.enums.map((e) => e.name) },
      { label: 'Extensions', types: ext },
      { label: 'All types', types: BUILTIN_TYPES },
    ];
  }, [schema.enums, schema.extensions]);
}

const singular = (n: string) => (n.endsWith('ies') ? `${n.slice(0, -3)}y` : n.endsWith('ses') ? n.slice(0, -2) : n.endsWith('s') ? n.slice(0, -1) : n);

/** The table a `<thing>_id` column most likely points at. */
function refTarget(name: string, schema: Schema, self: Table): Table | undefined {
  const m = /^(\w+?)_?id$/i.exec(name);
  if (!m || !m[1]) return undefined;
  const base = m[1].toLowerCase();
  const byName = schema.tables.filter((t) => t.id !== self.id || base === singular(self.name.toLowerCase()));
  return byName.find((t) => t.name.toLowerCase() === base) ?? byName.find((t) => singular(t.name.toLowerCase()) === base);
}

/** A sensible first guess for a column known only by its name; everything is editable afterwards. */
function guessColumn(name: string, schema: Schema, table: Table): { col: Column; ref?: Table } {
  const n = name.toLowerCase();
  const enabled = new Set(schema.extensions.map((e) => e.name));
  const col: Column = { id: uid(), name, type: 'text', nullable: true, pk: false, unique: false };
  const ref = refTarget(n, schema, table);
  const refPk = ref?.columns.find((c) => c.pk);
  if (n === 'id' && !table.columns.some((c) => c.pk)) Object.assign(col, { type: 'bigint', pk: true, nullable: false, identity: 'ALWAYS' });
  else if (ref && refPk) Object.assign(col, { type: isSerial(refPk.type) ? canonicalType(refPk.type) : refPk.type, nullable: false });
  else if (/(^|_)(uuid|guid)$/.test(n)) col.type = 'uuid';
  else if (/_?id$/.test(n)) col.type = 'bigint';
  else if (/^(is|has|can|should|allow)_/.test(n) || /^(active|enabled|archived|deleted|visible)$/.test(n)) Object.assign(col, { type: 'boolean', nullable: false, default: 'false' });
  else if (/^(created|updated)_at$/.test(n)) Object.assign(col, { type: 'timestamptz', nullable: false, default: 'now()' });
  else if (/_at$|^timestamp$/.test(n)) col.type = 'timestamptz';
  else if (/_(on|date)$|^(date|birthday|dob)$/.test(n)) col.type = 'date';
  else if (/(^|_)(count|qty|quantity|position|rank|order|year|age|version|size)$/.test(n)) col.type = 'integer';
  else if (/(^|_)(amount|price|total|cost|balance|rate|fee)$/.test(n)) col.type = 'numeric(12, 2)';
  else if (/(^|_)(data|metadata|meta|payload|settings|config|attributes|properties|json)$/.test(n)) col.type = 'jsonb';
  else if (/(^|_)(tags|labels)$/.test(n)) col.type = 'text[]';
  else if (/(^|_)email$/.test(n) && enabled.has('citext')) col.type = 'citext';
  else if (/(^|_)embedding$/.test(n) && enabled.has('vector')) col.type = 'vector(1536)';
  else {
    const en = schema.enums.find((e) => e.name.toLowerCase() === n || e.name.toLowerCase() === `${singular(table.name.toLowerCase())}_${n}`);
    if (en) col.type = en.name;
  }
  return { col, ref: refPk ? ref : undefined };
}

/** Parse a column written as SQL: `email citext NOT NULL UNIQUE REFERENCES users(id)`. */
function parseColumnFragment(fragment: string, schema: Schema): { col?: Column; ref?: { table: Table; col?: string }; error?: string } {
  let ref: { table: Table; col?: string } | undefined;
  const m = /\breferences\s+("?[\w.]+"?)\s*(?:\(\s*"?(\w+)"?\s*\))?/i.exec(fragment);
  let text = fragment;
  if (m) {
    const name = m[1].replace(/"/g, '').split('.').pop()!;
    const table = schema.tables.find((t) => t.name === name) ?? schema.tables.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (!table) return { error: `Unknown table ${name}` };
    ref = { table, col: m[2] };
    text = fragment.replace(m[0], '');
  }
  const enumDefs = schema.enums.map((e) => `CREATE TYPE "${e.name}" AS ENUM ('x');`).join('\n');
  const res = parseSql(`${enumDefs}\nCREATE TABLE __frag (${text});`);
  const err = res.diagnostics.find((d) => d.severity === 'error');
  const col = res.schema.tables[0]?.columns[0];
  if (err || !col) return { error: err?.message ?? 'Could not read that column' };
  return { col: { ...col, id: uid() }, ref };
}

// ---------------------------------------------------------------- table

function TableInspector({ id, columnId }: { id: string; columnId?: string }) {
  const table = useStore((s) => s.schema.tables.find((t) => t.id === id))!;
  const schema = useStore((s) => s.schema);
  const commit = useStore((s) => s.commit);
  const typeGroups = useTypeGroups();
  const fly = useFly();
  const [quick, setQuick] = useState('');
  const [quickErr, setQuickErr] = useState('');
  const [openCol, setOpenCol] = useState<string | null>(columnId ?? null);
  const [showDDL, setShowDDL] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [fkTarget, setFkTarget] = useState('');
  const [fresh, setFresh] = useState<string | null>(null); // column just added: its type picker takes the focus
  const issues = useIssues().filter((i) => i.tableId === id);
  const listRef = useRef<HTMLDivElement>(null);
  const quickRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!columnId) return;
    setOpenCol(columnId);
    listRef.current?.querySelector(`[data-ins-col="${columnId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [columnId]);

  const upd = (fn: (t: Table, d: Schema) => void, key?: string) =>
    commit((d) => {
      const t = d.tables.find((x) => x.id === id);
      if (t) fn(t, d);
    }, key);
  const updCol = (cid: string, fn: (c: Column, t: Table) => void, key?: string) =>
    upd((t) => {
      const c = t.columns.find((x) => x.id === cid);
      if (c) fn(c, t);
    }, key);

  const outgoing = schema.relations.filter((r) => r.from.table === id);
  const incoming = schema.relations.filter((r) => r.to.table === id && r.from.table !== id);
  const fkCols = new Set(outgoing.flatMap((r) => r.from.columns));
  const tname = (tid: string) => schema.tables.find((t) => t.id === tid)?.name ?? '?';
  const cname = (tid: string, cid: string) => schema.tables.find((t) => t.id === tid)?.columns.find((c) => c.id === cid)?.name ?? '?';

  const addQuick = () => {
    const text = quick.trim();
    let name = text.replace(/^"|"$/g, '');
    if (!name) {
      // no name: add a placeholder and let the user rename it
      let k = table.columns.length + 1;
      while (table.columns.some((c) => c.name === `column_${k}`)) k++;
      name = `column_${k}`;
    }
    let col: Column, ref: { table: Table; col?: string } | undefined;
    if (/^"?[A-Za-z_][\w$]*"?$/.test(text) || !text) {
      const g = guessColumn(name, schema, table);
      col = g.col;
      ref = g.ref && { table: g.ref };
    } else {
      const r = parseColumnFragment(text, schema);
      if (r.error || !r.col) {
        setQuickErr(r.error ?? 'Invalid');
        return;
      }
      col = r.col;
      ref = r.ref;
    }
    if (table.columns.some((c) => c.name === col.name)) {
      setQuickErr(`${table.name} already has a column ${col.name}`);
      return;
    }
    commit((d) => {
      const t = d.tables.find((x) => x.id === id)!;
      t.columns.push(col);
      if (ref) {
        const target = d.tables.find((x) => x.id === ref!.table.id)!;
        const tc = ref.col ? target.columns.find((c) => c.name === ref!.col) : target.columns.find((c) => c.pk);
        if (tc) d.relations.push({ id: uid(), from: { table: id, columns: [col.id] }, to: { table: target.id, columns: [tc.id] }, onDelete: 'NO ACTION', onUpdate: 'NO ACTION' });
      }
    });
    setQuick('');
    setQuickErr('');
    setOpenCol(col.id);
    setFresh(col.id);
  };

  /** Point a column at another table's primary key (or at nothing). */
  const setRef = (cid: string, targetId: string) => {
    const target = schema.tables.find((t) => t.id === targetId);
    const pk = target?.columns.find((c) => c.pk);
    if (target && !pk) {
      useStore.getState().toast(`${target.name} has no primary key to reference`, 'warn');
      return;
    }
    commit((d) => {
      d.relations = d.relations.filter((r) => !(r.from.table === id && r.from.columns.length === 1 && r.from.columns[0] === cid));
      if (!target || !pk) return;
      d.relations.push({ id: uid(), from: { table: id, columns: [cid] }, to: { table: target.id, columns: [pk.id] }, onDelete: 'NO ACTION', onUpdate: 'NO ACTION' });
      const c = d.tables.find((x) => x.id === id)?.columns.find((x) => x.id === cid);
      if (c) c.type = isSerial(pk.type) ? canonicalType(pk.type) : pk.type;
    });
  };

  const addFk = (targetId: string) => {
    const target = schema.tables.find((t) => t.id === targetId);
    const pk = target?.columns.find((c) => c.pk);
    if (!target || !pk) {
      useStore.getState().toast(`${target?.name ?? 'Target'} has no primary key to reference`, 'warn');
      return;
    }
    const colId = uid();
    let name = `${singular(target.name)}_${pk.name}`;
    while (table.columns.some((c) => c.name === name)) name += '_2';
    const type = isSerial(pk.type) ? canonicalType(pk.type) : pk.type;
    commit((d) => {
      const t = d.tables.find((x) => x.id === id)!;
      t.columns.push({ id: colId, name, type, nullable: false, pk: false, unique: false });
      d.relations.push({ id: uid(), from: { table: id, columns: [colId] }, to: { table: target.id, columns: [pk.id] }, onDelete: 'NO ACTION', onUpdate: 'NO ACTION' });
    });
    setFkTarget('');
  };

  return (
    <>
      <Head title="Table">
        <button
          className="icon-btn"
          title="Add a note attached to this table"
          onClick={() => useStore.getState().addNote({ x: table.x + 320, y: table.y - 40 }, id)}
        >
          <StickyNote size={15} />
        </button>
        <button className="icon-btn danger" title="Delete table" onClick={() => useStore.getState().deleteSelection()}>
          <Trash2 size={15} />
        </button>
      </Head>
      <div className="inspector-body">
        <div className="row">
          <input className="input title-input grow" value={table.name} onChange={(e) => upd((t) => void (t.name = e.target.value), `tname-${id}`)} spellCheck={false} />
        </div>
        <div className="row wrap">
          <select className="input grow" value={table.groupId ?? ''} onChange={(e) => upd((t) => void (t.groupId = e.target.value || undefined))}>
            <option value="">No group</option>
            {schema.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select className="input" value={table.status ?? ''} onChange={(e) => upd((t) => void (t.status = (e.target.value || undefined) as Table['status']))}>
            <option value="">active</option>
            <option value="draft">draft</option>
            <option value="deprecated">deprecated</option>
          </select>
          <button className={`toggle ${table.locked ? 'is-on' : ''}`} title="Lock position (auto-layout won't move it)" onClick={() => upd((t) => void (t.locked = !t.locked || undefined))}>
            {table.locked ? <Lock size={14} /> : <LockOpen size={14} />}
          </button>
          <button className={`toggle ${table.portal ? 'is-on' : ''}`} title="Portal: show references to this table as chips instead of lines" onClick={() => upd((t) => void (t.portal = !t.portal || undefined))}>
            <Waypoints size={14} />
          </button>
        </div>
        <div className="swatches">
          <button className={`swatch ${!table.color ? 'is-on' : ''}`} style={{ background: 'transparent' }} title="Group colour" onClick={() => upd((t) => void (t.color = undefined))}>
            ∅
          </button>
          {PALETTE.map((c) => (
            <button key={c} className={`swatch ${table.color === c ? 'is-on' : ''}`} style={{ background: c }} onClick={() => upd((t) => void (t.color = c))} />
          ))}
        </div>
        <textarea
          className="input"
          rows={2}
          placeholder="Table comment (COMMENT ON TABLE)…"
          value={table.comment ?? ''}
          onChange={(e) => upd((t) => void (t.comment = e.target.value || undefined), `tcomment-${id}`)}
        />

        {issues.length > 0 && (
          <>
            <div className="section-title clickable" onClick={() => setShowIssues(!showIssues)}>
              {showIssues ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Issues
              {(['error', 'warning', 'info'] as const).map((sev) => {
                const n = issues.filter((i) => i.severity === sev).length;
                return n > 0 && <span key={sev} className={`count count-${sev}`} title={`${n} ${sev}${n > 1 ? 's' : ''}`}>{n}</span>;
              })}
            </div>
            {showIssues && <section className="rule">
              {issues.map((i) => (
                <IssueRow
                  key={i.id}
                  issue={i}
                  dot
                  onClick={() => {
                    if (!i.columnId) return;
                    setOpenCol(i.columnId);
                    listRef.current?.querySelector(`[data-ins-col="${i.columnId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                  }}
                />
              ))}
            </section>}
          </>
        )}

        <div className="section-title">
          Columns <span className="count">{table.columns.length}</span>
        </div>
        <div className="cols" ref={listRef}>
          {table.columns.map((c, i) => {
            const open = openCol === c.id;
            return (
              <div key={c.id} className={`col ${open ? 'is-open' : ''} ${columnId === c.id ? 'is-target' : ''}`} data-ins-col={c.id}>
                <div className="col-row">
                  <button className={`icon-btn sm ${c.pk ? 'pk-on' : 'muted'}`} title="Primary key" onClick={() => updCol(c.id, (x) => { x.pk = !x.pk; if (x.pk) x.nullable = false; })}>
                    <KeyRound size={13} />
                  </button>
                  <input className="ghost-input mono col-name" value={c.name} spellCheck={false} onChange={(e) => {
                    const v = e.target.value;
                    updCol(c.id, (x, t) => {
                      for (const ix of t.indexes) ix.columns = ix.columns.map((n) => (n === x.name ? v : n));
                      for (const k of t.constraints) if (k.columns) k.columns = k.columns.map((n) => (n === x.name ? v : n));
                      x.name = v;
                    }, `cname-${c.id}`);
                  }} />
                  <TypePicker
                    className={`ghost-input mono col-type ${fkCols.has(c.id) ? 'is-fk' : ''}`}
                    value={c.type}
                    groups={typeGroups}
                    autoFocus={fresh === c.id}
                    onChange={(v) => updCol(c.id, (x) => void (x.type = v), `ctype-${c.id}`)}
                    onDone={() => {
                      setFresh(null);
                      quickRef.current?.focus();
                    }}
                  />
                  <button className={`flag ${!c.nullable ? 'is-on' : ''}`} title="NOT NULL" onClick={() => updCol(c.id, (x) => void (x.nullable = !x.nullable))}>
                    NN
                  </button>
                  <button className={`flag ${c.unique ? 'is-on' : ''}`} title="UNIQUE" onClick={() => updCol(c.id, (x) => void (x.unique = !x.unique))}>
                    U
                  </button>
                  <button className="icon-btn sm" onClick={() => setOpenCol(open ? null : c.id)} title="More">
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                </div>
                {open && (
                  <div className="col-more">
                    <label>
                      References
                      <select className="input" value={outgoing.find((r) => r.from.columns.length === 1 && r.from.columns[0] === c.id)?.to.table ?? ''} onChange={(e) => setRef(c.id, e.target.value)}>
                        <option value="">— none —</option>
                        {schema.tables
                          .filter((t) => t.columns.some((x) => x.pk))
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Default
                      <input className="input mono" value={c.default ?? ''} placeholder="e.g. now()" onChange={(e) => updCol(c.id, (x) => void (x.default = e.target.value || undefined), `cdef-${c.id}`)} />
                    </label>
                    <label>
                      Check
                      <input className="input mono" value={c.check ?? ''} placeholder="e.g. price > 0" onChange={(e) => updCol(c.id, (x) => void (x.check = e.target.value || undefined), `cchk-${c.id}`)} />
                    </label>
                    <label>
                      Identity
                      <select className="input" value={c.identity ?? ''} onChange={(e) => updCol(c.id, (x) => void (x.identity = (e.target.value || undefined) as Column['identity']))}>
                        <option value="">—</option>
                        <option value="ALWAYS">GENERATED ALWAYS</option>
                        <option value="BY DEFAULT">GENERATED BY DEFAULT</option>
                      </select>
                    </label>
                    <label>
                      Comment
                      <textarea className="input" rows={2} value={c.comment ?? ''} onChange={(e) => updCol(c.id, (x) => void (x.comment = e.target.value || undefined), `ccom-${c.id}`)} />
                    </label>
                    <div className="row">
                      <button className="btn sm" disabled={i === 0} onClick={() => upd((t) => void t.columns.splice(i - 1, 0, ...t.columns.splice(i, 1)))}>
                        <ArrowUp size={12} /> Up
                      </button>
                      <button className="btn sm" disabled={i === table.columns.length - 1} onClick={() => upd((t) => void t.columns.splice(i + 1, 0, ...t.columns.splice(i, 1)))}>
                        <ArrowDown size={12} /> Down
                      </button>
                      <span className="grow" />
                      <button
                        className="btn sm danger"
                        onClick={() =>
                          commit((d) => {
                            const t = d.tables.find((x) => x.id === id)!;
                            t.columns = t.columns.filter((x) => x.id !== c.id);
                            d.relations = d.relations.filter((r) => !r.from.columns.includes(c.id) && !r.to.columns.includes(c.id));
                          })
                        }
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <form
          className="quick-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (quick.trim()) addQuick();
          }}
        >
          <input ref={quickRef} className="input mono grow" placeholder="+ new column name" value={quick} onChange={(e) => { setQuick(e.target.value); setQuickErr(''); }} spellCheck={false} />
          <button type="submit" className="btn sm" title="Add the column (Enter)">
            Add
          </button>
        </form>
        {quickErr && <div className="error-box small">{quickErr}</div>}
        <div className="hint">Type a name and press Enter, then pick its type. The type is guessed from the name (<span className="mono">user_id</span> links to users, <span className="mono">created_at</span> is a timestamp…). Full SQL works too: <span className="mono">email text NOT NULL UNIQUE</span>.</div>

        <div className="section-title">
          References <span className="count">{outgoing.length}</span>
        </div>
        {outgoing.map((r) => (
          <div key={r.id} className="rel-row">
            <button className="link mono" onClick={() => useStore.getState().visit(() => useStore.getState().select({ kind: 'relation', id: r.id }))}>
              {cname(id, r.from.columns[0])} → {tname(r.to.table)}.{cname(r.to.table, r.to.columns[0])}
            </button>
            <select className="input xs" title="ON DELETE" value={r.onDelete} onChange={(e) => commit((d) => void (d.relations.find((x) => x.id === r.id)!.onDelete = e.target.value as FkAction))}>
              {FK_ACTIONS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
        ))}
        <div className="row">
          <select className="input grow" value={fkTarget} onChange={(e) => { setFkTarget(e.target.value); if (e.target.value) addFk(e.target.value); }}>
            <option value="">+ Reference another table…</option>
            {schema.tables.filter((t) => t.id !== id).sort((a, b) => a.name.localeCompare(b.name)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {incoming.length > 0 && (
          <>
            <div className="section-title">
              Referenced by <span className="count">{incoming.length}</span>
            </div>
            <div className="chips">
              {incoming.map((r) => (
                <button key={r.id} className="chip chip-btn" onClick={() => fly(r.from.table)}>
                  {tname(r.from.table)}.{cname(r.from.table, r.from.columns[0])}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="section-title">
          Indexes <span className="count">{table.indexes.length}</span>
          <span className="grow" />
          <button className="btn sm" onClick={() => upd((t) => void t.indexes.push({ id: uid(), name: `idx_${t.name}_${t.indexes.length + 1}`, columns: [t.columns[0]?.name ?? 'id'], unique: false }))}>
            + Index
          </button>
        </div>
        {table.indexes.map((ix) => (
          <div key={ix.id} className="index-card">
            <div className="row">
              <input className="ghost-input mono grow" value={ix.name} onChange={(e) => upd((t) => void (t.indexes.find((x) => x.id === ix.id)!.name = e.target.value), `ixn-${ix.id}`)} />
              <button className={`flag ${ix.unique ? 'is-on' : ''}`} onClick={() => upd((t) => void (t.indexes.find((x) => x.id === ix.id)!.unique = !ix.unique))}>
                U
              </button>
              <button className="icon-btn sm" onClick={() => upd((t) => void (t.indexes = t.indexes.filter((x) => x.id !== ix.id)))}>
                <Trash2 size={12} />
              </button>
            </div>
            <div className="row">
              <select className="input xs" value={ix.method ?? 'btree'} onChange={(e) => upd((t) => void (t.indexes.find((x) => x.id === ix.id)!.method = e.target.value === 'btree' ? undefined : e.target.value))}>
                {['btree', 'hash', 'gin', 'gist', 'spgist', 'brin', 'hnsw', 'ivfflat'].map((m) => <option key={m}>{m}</option>)}
              </select>
              <IndexColumns value={ix.columns} onChange={(cols) => upd((t) => void (t.indexes.find((x) => x.id === ix.id)!.columns = cols), `ixc-${ix.id}`)} />
            </div>
            <input className="input mono small" placeholder="WHERE (partial index)…" value={ix.where ?? ''} onChange={(e) => upd((t) => void (t.indexes.find((x) => x.id === ix.id)!.where = e.target.value || undefined), `ixw-${ix.id}`)} />
          </div>
        ))}

        {table.constraints.length > 0 && (
          <>
            <div className="section-title">Constraints</div>
            {table.constraints.map((k) => (
              <div key={k.id} className="index-card">
                <div className="row">
                  <span className="badge">{k.kind}</span>
                  <span className="mono small grow ellipsis">{k.name ?? '(unnamed)'}</span>
                  <button className="icon-btn sm" onClick={() => upd((t) => void (t.constraints = t.constraints.filter((x) => x.id !== k.id)))}>
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="mono small muted">{k.kind === 'unique' ? `(${k.columns?.join(', ')})` : k.expr}</div>
              </div>
            ))}
          </>
        )}
        <div className="row">
          <button className="btn sm" onClick={() => upd((t) => void t.constraints.push({ id: uid(), kind: 'unique', columns: t.columns.filter((c) => !c.pk).slice(0, 2).map((c) => c.name) }))}>
            + Unique
          </button>
          <button className="btn sm" onClick={() => upd((t) => void t.constraints.push({ id: uid(), kind: 'check', expr: 'true' }))}>
            + Check
          </button>
        </div>

        <div className="section-title clickable" onClick={() => setShowDDL(!showDDL)}>
          {showDDL ? <ChevronDown size={13} /> : <ChevronRight size={13} />} DDL
          <span className="grow" />
          <button className="btn sm" onClick={async (e) => { e.stopPropagation(); if (await copyText(tableDDL(table, schema))) useStore.getState().toast('DDL copied'); }}>
            <Copy size={12} /> Copy
          </button>
        </div>
        {showDDL && <CodeEditor value={tableDDL(table, schema)} readOnly className="code-small" />}
      </div>
    </>
  );
}

function IndexColumns({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  useEffect(() => setText(value.join(', ')), [value]);
  return (
    <input
      className="input mono grow small"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const cols = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
        if (cols.length) onChange(cols);
      }}
    />
  );
}

// ---------------------------------------------------------------- relation

function RelationInspector({ id }: { id: string }) {
  const schema = useStore((s) => s.schema);
  const r = schema.relations.find((x) => x.id === id)!;
  const commit = useStore((s) => s.commit);
  const fly = useFly();
  const f = schema.tables.find((t) => t.id === r.from.table)!;
  const t = schema.tables.find((x) => x.id === r.to.table)!;
  const fc = f.columns.find((c) => c.id === r.from.columns[0]);
  const tc = t.columns.find((c) => c.id === r.to.columns[0]);
  const upd = (fn: (x: typeof r) => void, key?: string) => commit((d) => fn(d.relations.find((x) => x.id === id)!), key);
  const card = fc?.unique ? 'one-to-one' : 'many-to-one';
  return (
    <>
      <Head title="Relationship">
        <button className="icon-btn danger" title="Delete relationship" onClick={() => useStore.getState().deleteSelection()}>
          <Trash2 size={15} />
        </button>
      </Head>
      <div className="inspector-body">
        <div className="rel-hero">
          <button className="link" onClick={() => fly(f.id, fc?.id)}>
            <b>{f.name}</b>
            <span className="mono">.{fc?.name}</span>
          </button>
          <span className="rel-arrow">{card === 'one-to-one' ? '1 ─── 1' : 'N ───▶ 1'}</span>
          <button className="link" onClick={() => fly(t.id, tc?.id)}>
            <b>{t.name}</b>
            <span className="mono">.{tc?.name}</span>
          </button>
        </div>
        <div className="muted small">
          Each <b>{f.name}</b> row points to {fc?.nullable ? 'zero or one' : 'exactly one'} <b>{t.name}</b>; a {t.name} has {card === 'one-to-one' ? 'at most one' : 'any number of'} {f.name}.
        </div>
        <label className="field">
          Constraint name
          <input className="input mono" placeholder={`${f.name}_${fc?.name}_fkey`} value={r.name ?? ''} onChange={(e) => upd((x) => void (x.name = e.target.value || undefined), `rname-${id}`)} />
        </label>
        <label className="field">
          ON DELETE
          <select className="input" value={r.onDelete} onChange={(e) => upd((x) => void (x.onDelete = e.target.value as FkAction))}>
            {FK_ACTIONS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label className="field">
          ON UPDATE
          <select className="input" value={r.onUpdate} onChange={(e) => upd((x) => void (x.onUpdate = e.target.value as FkAction))}>
            {FK_ACTIONS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <div className="row">
          <button
            className="btn"
            onClick={() =>
              commit((d) => {
                const col = d.tables.find((tt) => tt.id === r.from.table)?.columns.find((c) => c.id === r.from.columns[0]);
                if (col) col.unique = !col.unique;
              })
            }
          >
            Make {card === 'one-to-one' ? 'many-to-one' : 'one-to-one'}
          </button>
        </div>
        <CodeEditor value={relationDDL(schema, id) ?? ''} readOnly className="code-small" />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- note / group

function NoteInspector({ id }: { id: string }) {
  const n = useStore((s) => s.schema.notes.find((x) => x.id === id))!;
  const tables = useStore((s) => s.schema.tables);
  const commit = useStore((s) => s.commit);
  const upd = (fn: (x: typeof n) => void, key?: string) => commit((d) => fn(d.notes.find((x) => x.id === id)!), key);
  return (
    <>
      <Head title="Note">
        <button className="icon-btn danger" title="Delete note" onClick={() => useStore.getState().deleteSelection()}>
          <Trash2 size={15} />
        </button>
      </Head>
      <div className="inspector-body">
        <textarea className="input" rows={8} value={n.text} onChange={(e) => upd((x) => void (x.text = e.target.value), `note-${id}`)} />
        <div className="hint">Supports **bold**, `code`, # headings and - bullets. Double-click the note to edit in place.</div>
        <div className="swatches">
          {NOTE_COLORS.map((c) => (
            <button key={c} className={`swatch ${n.color === c ? 'is-on' : ''}`} style={{ background: c }} onClick={() => upd((x) => void (x.color = c))} />
          ))}
        </div>
        <label className="field">
          Attached to
          <select className="input" value={n.attachedTo ?? ''} onChange={(e) => upd((x) => void (x.attachedTo = e.target.value || undefined))}>
            <option value="">— nothing —</option>
            {[...tables].sort((a, b) => a.name.localeCompare(b.name)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      </div>
    </>
  );
}

function GroupInspector({ id }: { id: string }) {
  const g = useStore((s) => s.schema.groups.find((x) => x.id === id))!;
  const tables = useStore((s) => s.schema.tables);
  const members = useMemo(() => tables.filter((t) => t.groupId === id), [tables, id]);
  const commit = useStore((s) => s.commit);
  const fly = useFly();
  const upd = (fn: (x: typeof g) => void, key?: string) => commit((d) => fn(d.groups.find((x) => x.id === id)!), key);
  return (
    <>
      <Head title="Group">
        <button className="icon-btn danger" title="Delete group (keeps tables)" onClick={() => useStore.getState().deleteSelection()}>
          <Trash2 size={15} />
        </button>
      </Head>
      <div className="inspector-body">
        <input className="input title-input" value={g.name} onChange={(e) => upd((x) => void (x.name = e.target.value), `gname-${id}`)} />
        <div className="swatches">
          {PALETTE.map((c) => (
            <button key={c} className={`swatch ${g.color === c ? 'is-on' : ''}`} style={{ background: c }} onClick={() => upd((x) => void (x.color = c))} />
          ))}
        </div>
        <button className={`btn ${g.locked ? 'primary' : ''}`} onClick={() => upd((x) => void (x.locked = !x.locked || undefined))}>
          {g.locked ? <Lock size={14} /> : <LockOpen size={14} />} {g.locked ? 'Locked — auto-layout keeps it in place' : 'Lock this group in place'}
        </button>
        <div className="section-title">
          Tables <span className="count">{members.length}</span>
        </div>
        <div className="chips">
          {members.map((t) => (
            <button key={t.id} className="chip chip-btn" onClick={() => fly(t.id)}>
              {t.name}
            </button>
          ))}
        </div>
        <div className="hint">Drag the region on the canvas to move all its tables together.</div>
      </div>
    </>
  );
}
