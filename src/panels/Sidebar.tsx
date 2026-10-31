import { useReactFlow } from '@xyflow/react';
import {
  Code2,
  Moon,
  Sun,
  ArrowLeftRight,
  Boxes,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  GitCompareArrows,
  HeartPulse,
  ListOrdered,
  Lock,
  LockOpen,
  Plus,
  Puzzle,
  Route,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { migrationSql } from '../analysis/diff';
import { joinSql } from '../analysis/graph';
import { RULE_LABELS, type Issue } from '../analysis/lint';
import { suggestGroups } from '../layout/cluster';
import { uid } from '../model/ids';
import { PALETTE } from '../model/palette';
import { EXTENSIONS } from '../sql/pg';
import { useDiff, useIssues, usePath } from '../store/derived';
import { newGroupColor, type SidebarTab, useStore } from '../store/store';
import { copyText, download, pickFile, slug } from '../util/files';
import { CodeEditor } from './CodeEditor';
import { IssueRow } from './IssueRow';
import { useIsPhone } from '../util/phone';
import { useActions } from './useActions';
import { useFly } from './useFly';

/** Top: what is in the schema. Below the divider: questions about it (read-only). */
const TABS: { id: SidebarTab; label: string; icon: typeof Boxes }[] = [
  { id: 'tables', label: 'Tables', icon: Boxes },
  { id: 'enums', label: 'Enums', icon: ListOrdered },
  { id: 'extensions', label: 'Extensions', icon: Puzzle },
  { id: 'health', label: 'Health', icon: HeartPulse },
  { id: 'paths', label: 'Join paths', icon: Route },
  { id: 'diff', label: 'Compare', icon: GitCompareArrows },
];

/** The panel buttons down the left rail. */
export function SidebarTabs({ onPick }: { onPick?: () => void }) {
  const tab = useStore((s) => s.sidebar);
  const issues = useIssues();
  const diff = useDiff();
  const errs = issues.filter((i) => i.severity !== 'info').length;
  return (
    <>
      {TABS.map((t) => [
        t.id === 'health' && <span key="sep" className="rail-sep" role="separator" />,
        <button
          key={t.id}
          className={`rail-btn ${tab === t.id ? 'is-active' : ''}`}
          title={t.label}
          aria-pressed={tab === t.id}
          onClick={() => {
            onPick?.();
            useStore.getState().set({ sidebar: tab === t.id ? null : t.id });
          }}
        >
          <t.icon size={18} />
          {t.id === 'health' && errs > 0 && <span className="rail-dot">{errs}</span>}
          {t.id === 'diff' && diff && diff.count > 0 && <span className="rail-dot rail-dot-ok">{diff.count}</span>}
        </button>,
      ])}
    </>
  );
}

/** The live SQL pane: the schema as text, opening on the right. */
function SqlButton() {
  const sqlOpen = useStore((s) => s.sqlOpen);
  const phone = useIsPhone();
  return (
    <button
      className={`rail-btn ${sqlOpen ? 'is-active' : ''}`}
      title="Live SQL pane (S)"
      aria-pressed={sqlOpen}
      // on a phone the pane covers the side panel: show one at a time
      onClick={() => useStore.getState().set(phone ? { sqlOpen: !sqlOpen, sidebar: null } : { sqlOpen: !sqlOpen })}
    >
      <Code2 size={18} />
    </button>
  );
}

/** App setting, not a panel: parked at the foot of the rail. */
function ThemeButton() {
  const theme = useStore((s) => s.theme);
  const { toggleTheme } = useActions();
  return (
    <button className="rail-btn rail-foot" title={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'} onClick={toggleTheme}>
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export function SidebarRail() {
  const welcome = useStore((s) => s.welcome);
  const phone = useIsPhone();
  if (welcome) return null; // nothing open yet: keep the welcome screen clean
  return (
    <nav className="rail">
      <SidebarTabs onPick={phone ? () => useStore.getState().set({ sqlOpen: false }) : undefined} />
      <span className="rail-sep" role="separator" />
      <SqlButton />
      <ThemeButton />
    </nav>
  );
}

export function Sidebar() {
  const tab = useStore((s) => s.sidebar);
  const welcome = useStore((s) => s.welcome);
  if (!tab || welcome) return null;
  return (
    <aside className="sidebar">
      <div className="pane-head">
        <span className="pane-title">{TABS.find((t) => t.id === tab)?.label}</span>
        <span className="grow" />
        <button className="icon-btn" onClick={() => useStore.getState().set({ sidebar: null })} title="Close">
          <X size={15} />
        </button>
      </div>
      <div className="sidebar-body">
        {tab === 'tables' && <TablesTab />}
        {tab === 'enums' && <EnumsTab />}
        {tab === 'extensions' && <ExtensionsTab />}
        {tab === 'health' && <HealthTab />}
        {tab === 'paths' && <PathsTab />}
        {tab === 'diff' && <DiffTab />}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- tables

function TablesTab() {
  const schema = useStore((s) => s.schema);
  const selection = useStore((s) => s.selection);
  const commit = useStore((s) => s.commit);
  const fly = useFly();
  const rf = useReactFlow();
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const match = (name: string) => !q || name.toLowerCase().includes(q.toLowerCase());
  const sections = [
    ...schema.groups.map((g) => ({ group: g, tables: schema.tables.filter((t) => t.groupId === g.id) })),
    { group: null, tables: schema.tables.filter((t) => !t.groupId || !schema.groups.some((g) => g.id === t.groupId)) },
  ];

  return (
    <div className="stack">
      <div className="row">
        <input className="input grow" placeholder="Filter tables & columns…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="row wrap">
        <button
          className="btn"
          onClick={() => {
            const c = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
            useStore.getState().addTable({ x: c.x - 140, y: c.y - 60 });
          }}
        >
          <Plus size={14} /> Table
        </button>
        <button
          className="btn"
          onClick={() => {
            const id = uid();
            commit((d) => void d.groups.push({ id, name: `Group ${d.groups.length + 1}`, color: newGroupColor(d) }));
            useStore.getState().select({ kind: 'group', id });
          }}
        >
          <Plus size={14} /> Group
        </button>
        <button
          className="btn"
          title="Detect domains from foreign keys (Louvain communities) and re-layout"
          onClick={() => {
            const s = suggestGroups(useStore.getState().schema);
            commit((d) => {
              d.groups = s.groups;
              for (const t of d.tables) t.groupId = s.assignment.get(t.id);
            });
            useStore.getState().toast(`Suggested ${s.groups.length} groups from FK clusters`);
            void useStore.getState().runAutoLayout();
          }}
        >
          <Sparkles size={14} /> Suggest groups
        </button>
      </div>
      {sections.map(({ group, tables }) => {
        const shown = tables.filter((t) => match(t.name) || t.columns.some((c) => match(c.name)));
        if (!shown.length && (q || !group)) return null;
        const key = group?.id ?? '__none';
        const open = !collapsed.has(key);
        return (
          <section key={key} className="tree-group">
            <div className={`tree-head ${selection?.kind === 'group' && selection.id === group?.id ? 'is-selected' : ''}`}>
              <button className="icon-btn sm" onClick={() => setCollapsed((s) => { const n = new Set(s); if (open) n.add(key); else n.delete(key); return n; })}>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {group ? (
                <>
                  <button
                    className="swatch"
                    style={{ background: group.color }}
                    title="Change colour"
                    onClick={() => commit((d) => {
                      const g = d.groups.find((x) => x.id === group.id)!;
                      g.color = PALETTE[(PALETTE.indexOf(g.color) + 1) % PALETTE.length];
                    })}
                  />
                  <input
                    className="ghost-input grow"
                    value={group.name}
                    onFocus={() => useStore.getState().select({ kind: 'group', id: group.id })}
                    onChange={(e) => commit((d) => void (d.groups.find((x) => x.id === group.id)!.name = e.target.value), `group-name-${group.id}`)}
                  />
                  <span className="count">{tables.length}</span>
                  <button className="icon-btn sm" title={group.locked ? 'Unlock group' : 'Lock group (auto-layout keeps it in place)'} onClick={() => commit((d) => void (d.groups.find((x) => x.id === group.id)!.locked = !group.locked))}>
                    {group.locked ? <Lock size={13} /> : <LockOpen size={13} className="muted" />}
                  </button>
                  <button className="icon-btn sm" title="Delete group (keeps tables)" onClick={() => commit((d) => {
                    d.groups = d.groups.filter((x) => x.id !== group.id);
                    for (const t of d.tables) if (t.groupId === group.id) t.groupId = undefined;
                  })}>
                    <Trash2 size={13} />
                  </button>
                </>
              ) : (
                <span className="grow muted">Ungrouped</span>
              )}
            </div>
            {open &&
              shown.map((t) => (
                <button key={t.id} className={`tree-item ${selection?.kind === 'table' && selection.id === t.id ? 'is-selected' : ''}`} onClick={() => fly(t.id)}>
                  <span className="tree-dot" style={{ background: t.color ?? group?.color ?? 'var(--text-faint)' }} />
                  <span className="grow ellipsis">{t.name}</span>
                  {t.locked && <Lock size={11} className="muted" />}
                  <span className="count">{t.columns.length}</span>
                </button>
              ))}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- enums

function EnumsTab() {
  const schema = useStore((s) => s.schema);
  const commit = useStore((s) => s.commit);
  const selection = useStore((s) => s.selection);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of schema.tables) for (const c of t.columns) m.set(c.type.replace(/\[\]$/, ''), (m.get(c.type.replace(/\[\]$/, '')) ?? 0) + 1);
    return m;
  }, [schema]);

  return (
    <div className="stack">
      <div className="section-title">
        Enums <span className="count">{schema.enums.length}</span>
        <span className="grow" />
        <button
          className="btn sm"
          onClick={() => {
            const id = uid();
            commit((d) => void d.enums.push({ id, name: `new_enum_${d.enums.length + 1}`, values: ['value_a', 'value_b'] }));
            useStore.getState().select({ kind: 'enum', id });
          }}
        >
          <Plus size={13} /> Enum
        </button>
      </div>
      {schema.enums.map((e) => (
        <EnumCard key={e.id} id={e.id} usage={usage.get(e.name) ?? 0} selected={selection?.kind === 'enum' && selection.id === e.id} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- extensions

function ExtensionsTab() {
  const schema = useStore((s) => s.schema);
  const commit = useStore((s) => s.commit);
  const [custom, setCustom] = useState('');
  const enabled = new Set(schema.extensions.map((e) => e.name));

  return (
    <div className="stack">
      <div className="section-title">
        Extensions <span className="count">{schema.extensions.length}</span>
      </div>
      <div className="ext-grid">
        {EXTENSIONS.map((x) => (
          <label key={x.name} className={`ext ${enabled.has(x.name) ? 'is-on' : ''}`} title={x.description}>
            <input
              type="checkbox"
              checked={enabled.has(x.name)}
              onChange={() =>
                commit((d) => {
                  if (d.extensions.some((e) => e.name === x.name)) d.extensions = d.extensions.filter((e) => e.name !== x.name);
                  else d.extensions.push({ name: x.name });
                })
              }
            />
            <span className="ext-name">{x.label}</span>
            <span className="ext-desc">{x.description}</span>
            {x.types && <span className="ext-types">{x.types.join(' · ')}</span>}
          </label>
        ))}
        {schema.extensions
          .filter((e) => !EXTENSIONS.some((x) => x.name === e.name))
          .map((e) => (
            <label key={e.name} className="ext is-on">
              <input type="checkbox" checked onChange={() => commit((d) => void (d.extensions = d.extensions.filter((x) => x.name !== e.name)))} />
              <span className="ext-name">{e.name}</span>
              <span className="ext-desc">Custom extension</span>
            </label>
          ))}
      </div>
      <form
        className="row"
        onSubmit={(ev) => {
          ev.preventDefault();
          const n = custom.trim();
          if (n) commit((d) => void (d.extensions.some((e) => e.name === n) || d.extensions.push({ name: n })));
          setCustom('');
        }}
      >
        <input className="input grow" placeholder="Other extension name…" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button className="btn" type="submit">
          Add
        </button>
      </form>
    </div>
  );
}

function EnumCard({ id, usage, selected }: { id: string; usage: number; selected: boolean }) {
  const e = useStore((s) => s.schema.enums.find((x) => x.id === id))!;
  const commit = useStore((s) => s.commit);
  const [val, setVal] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  if (!e) return null;
  const rename = (name: string) =>
    commit((d) => {
      const en = d.enums.find((x) => x.id === id)!;
      const old = en.name;
      en.name = name;
      for (const t of d.tables) for (const c of t.columns) if (c.type === old || c.type === `${old}[]`) c.type = c.type.replace(old, name);
    }, `enum-name-${id}`);
  return (
    <div ref={ref} className={`enum-card ${selected ? 'is-selected' : ''}`} onClick={() => useStore.getState().select({ kind: 'enum', id })}>
      <div className="row">
        <input className="ghost-input mono grow" value={e.name} onChange={(ev) => rename(ev.target.value)} />
        <span className="count" title="columns using it">{usage} use{usage === 1 ? '' : 's'}</span>
        <button className="icon-btn sm" title="Delete enum" onClick={() => commit((d) => void (d.enums = d.enums.filter((x) => x.id !== id)))}>
          <Trash2 size={13} />
        </button>
      </div>
      <div className="chips">
        {e.values.map((v, i) => (
          <span key={`${v}-${i}`} className="chip">
            {v}
            <button
              title="Move left"
              className="chip-x"
              onClick={() => i > 0 && commit((d) => {
                const vals = d.enums.find((x) => x.id === id)!.values;
                [vals[i - 1], vals[i]] = [vals[i], vals[i - 1]];
              })}
            >
              ‹
            </button>
            <button className="chip-x" title="Remove" onClick={() => commit((d) => void d.enums.find((x) => x.id === id)!.values.splice(i, 1))}>
              ×
            </button>
          </span>
        ))}
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            const v = val.trim();
            if (v && !e.values.includes(v)) commit((d) => void d.enums.find((x) => x.id === id)!.values.push(v));
            setVal('');
          }}
        >
          <input className="chip-input" placeholder="+ value" value={val} onChange={(ev) => setVal(ev.target.value)} />
        </form>
      </div>
      <input
        className="ghost-input small muted"
        placeholder="Comment…"
        value={e.comment ?? ''}
        onChange={(ev) => commit((d) => void (d.enums.find((x) => x.id === id)!.comment = ev.target.value || undefined), `enum-comment-${id}`)}
      />
    </div>
  );
}

// ---------------------------------------------------------------- health

function HealthTab() {
  const issues = useIssues();
  const importDiags = useStore((s) => s.importDiagnostics);
  const commit = useStore((s) => s.commit);
  const fly = useFly();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const byRule = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of issues) {
      if (!m.has(i.rule)) m.set(i.rule, []);
      m.get(i.rule)!.push(i);
    }
    return [...m.entries()];
  }, [issues]);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  const importNotes = importDiags.filter((d) => d.severity !== 'info');

  return (
    <div className="stack">
      <div className="health-score">
        <div className={`score ${counts.error ? 'bad' : counts.warning ? 'meh' : 'good'}`}>{counts.error ? '!' : counts.warning ? '~' : '✓'}</div>
        <div>
          <div>
            <b>{counts.error}</b> errors · <b>{counts.warning}</b> warnings · <b>{counts.info}</b> hints
          </div>
          <div className="muted small">Live checks over the whole schema. Click an item to jump to it.</div>
        </div>
      </div>
      {importNotes.length > 0 && (
        <section className="rule">
          <div className="rule-head">
            <span className="sev sev-warning" />
            <span className="grow">From the imported SQL</span>
            <span className="count">{importNotes.length}</span>
            <button className="icon-btn sm" title="Dismiss" onClick={() => useStore.getState().set({ importDiagnostics: [] })}>
              <X size={13} />
            </button>
          </div>
          {importNotes.map((d, i) => (
            <div key={i} className="issue">
              <span className="mono small muted">L{d.line}</span> {d.message}
            </div>
          ))}
        </section>
      )}
      {byRule.map(([rule, list]) => {
        const isOpen = open.has(rule) || list.length <= 3;
        const fixable = list.filter((i) => i.fix);
        return (
          <section key={rule} className="rule">
            <div className="rule-head" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(rule)) n.delete(rule); else n.add(rule); return n; })}>
              <span className={`sev sev-${list[0].severity}`} />
              <span className="grow">{RULE_LABELS[rule] ?? rule}</span>
              <span className="count">{list.length}</span>
              {fixable.length > 1 && (
                <button
                  className="btn sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    commit((d) => fixable.forEach((i) => i.fix!.apply(d)));
                    useStore.getState().toast(`Applied ${fixable.length} fixes`);
                  }}
                >
                  <Wand2 size={12} /> Fix all
                </button>
              )}
            </div>
            {isOpen &&
              list.map((i) => (
                <IssueRow key={i.id} issue={i} onClick={() => i.tableId && fly(i.tableId, i.columnId)} />
              ))}
          </section>
        );
      })}
      {!issues.length && !importNotes.length && <div className="empty">No issues. Nice schema.</div>}
    </div>
  );
}

// ---------------------------------------------------------------- join paths

function TablePicker({ value, onChange, placeholder }: { value?: string; onChange: (id: string | undefined) => void; placeholder: string }) {
  const tables = useStore((s) => s.schema.tables);
  return (
    <select className="input grow" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">{placeholder}</option>
      {[...tables].sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

function PathsTab() {
  const schema = useStore((s) => s.schema);
  const p = useStore((s) => s.path);
  const sel = useStore((s) => s.selection);
  const res = usePath();
  const setPath = (next: { a?: string; b?: string }) => useStore.getState().set({ path: next });
  const sql = res?.rels && p.a ? joinSql(schema, p.a, res.rels) : '';
  const name = (id?: string) => schema.tables.find((t) => t.id === id)?.name;

  return (
    <div className="stack">
      <p className="muted small">Pick two tables: the shortest chain of foreign keys between them lights up on the canvas, and you get the JOIN to copy.</p>
      <div className="row">
        <TablePicker value={p.a} onChange={(a) => setPath({ ...p, a })} placeholder="From table…" />
        {sel?.kind === 'table' && (
          <button className="btn sm" title="Use selected table" onClick={() => setPath({ ...p, a: sel.id })}>
            sel
          </button>
        )}
      </div>
      <div className="row">
        <TablePicker value={p.b} onChange={(b) => setPath({ ...p, b })} placeholder="To table…" />
        {sel?.kind === 'table' && (
          <button className="btn sm" title="Use selected table" onClick={() => setPath({ ...p, b: sel.id })}>
            sel
          </button>
        )}
      </div>
      <div className="row">
        <button className="btn" onClick={() => setPath({ a: p.b, b: p.a })} disabled={!p.a || !p.b}>
          <ArrowLeftRight size={14} /> Swap
        </button>
        <button className="btn" onClick={() => setPath({})} disabled={!p.a && !p.b}>
          Clear
        </button>
      </div>
      {res && !res.rels && <div className="empty">No foreign-key path between {name(p.a)} and {name(p.b)}.</div>}
      {res?.rels && (
        <>
          <ol className="path-list">
            <li>{name(p.a)}</li>
            {res.rels.map((r) => {
              const f = schema.tables.find((t) => t.id === r.from.table)!;
              const t = schema.tables.find((x) => x.id === r.to.table)!;
              const fc = f.columns.find((c) => c.id === r.from.columns[0])?.name;
              const tc = t.columns.find((c) => c.id === r.to.columns[0])?.name;
              return (
                <li key={r.id}>
                  <span className="mono small muted">
                    {f.name}.{fc} → {t.name}.{tc}
                  </span>
                </li>
              );
            })}
            <li>{name(p.b)}</li>
          </ol>
          <div className="row">
            <span className="muted small grow">{res.rels.length} join{res.rels.length === 1 ? '' : 's'}</span>
            <button className="btn sm" onClick={async () => (await copyText(sql)) && useStore.getState().toast('JOIN copied')}>
              <Copy size={12} /> Copy SQL
            </button>
          </div>
          <CodeEditor value={sql} readOnly className="code-small" />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- compare

function DiffTab() {
  const base = useStore((s) => s.diffBase);
  const schema = useStore((s) => s.schema);
  const diff = useDiff();
  const fly = useFly();
  const [paste, setPaste] = useState('');
  const [err, setErr] = useState('');

  const loadBase = (text: string, name: string) => {
    const e = useStore.getState().loadCompareBase(text, name);
    setErr(e ?? '');
    if (!e) setPaste('');
  };

  const migration = useMemo(() => (base && diff ? migrationSql(base.schema, schema, diff) : ''), [base, diff, schema]);

  if (!base || !diff) {
    return (
      <div className="stack">
        <p className="muted small">
          Compare the current schema with an older version (e.g. <span className="mono">schema-v14.sql</span>). Changes are highlighted on the canvas and a migration script is generated. You can also drop the file on the page while this panel is open.
        </p>
        <button
          className="btn primary"
          onClick={async () => {
            const f = await pickFile();
            if (f) loadBase(await f.text(), f.name);
          }}
        >
          <Upload size={14} /> Load base .sql file
        </button>
        <textarea className="input mono" rows={6} placeholder="…or paste SQL or a schema link here" value={paste} onChange={(e) => setPaste(e.target.value)} />
        <button className="btn" disabled={!paste.trim()} onClick={() => loadBase(paste, 'pasted')}>
          Compare with pasted
        </button>
        {err && <div className="error-box">{err}</div>}
      </div>
    );
  }

  const KIND = { added: '+', removed: '−', changed: '~' } as const;
  return (
    <div className="stack">
      <div className="row">
        <span className="grow">
          <span className="muted small">Base</span> <b>{base.name}</b> → <b>current</b>
        </span>
        <button className="btn sm" onClick={() => useStore.getState().set({ diffBase: null })}>
          <X size={12} /> Stop
        </button>
      </div>
      {diff.count === 0 && <div className="empty">No structural differences.</div>}
      {(diff.extensionsAdded.length > 0 || diff.extensionsRemoved.length > 0) && (
        <section className="diff-sec">
          <div className="section-title">Extensions</div>
          {diff.extensionsAdded.map((e) => <div key={e} className="diff-line d-added">+ {e}</div>)}
          {diff.extensionsRemoved.map((e) => <div key={e} className="diff-line d-removed">− {e}</div>)}
        </section>
      )}
      {diff.enums.length > 0 && (
        <section className="diff-sec">
          <div className="section-title">Enums</div>
          {diff.enums.map((e) => (
            <div key={e.name} className={`diff-line d-${e.kind}`}>
              {KIND[e.kind]} <span className="mono">{e.name}</span>
              {e.kind === 'changed' && <span className="muted small"> {e.added.map((v) => `+${v}`).concat(e.removed.map((v) => `−${v}`)).join(' ')}</span>}
            </div>
          ))}
        </section>
      )}
      {diff.tables.length > 0 && (
        <section className="diff-sec">
          <div className="section-title">Tables</div>
          {diff.tables.map((t) => (
            <div key={t.name} className={`diff-table d-${t.kind}`} onClick={() => t.current && fly(t.current.id)}>
              <div className="diff-line">
                {KIND[t.kind]} <b className="mono">{t.name}</b>
              </div>
              {t.columns.map((c) => (
                <div key={c.name} className={`diff-sub d-${c.kind}`}>
                  {KIND[c.kind]} <span className="mono">{c.name}</span> {c.details.length > 0 && <span className="muted small">{c.details.join(', ')}</span>}
                </div>
              ))}
              {t.indexesAdded.map((i) => <div key={`+${i.name}`} className="diff-sub d-added">+ index {i.name}</div>)}
              {t.indexesRemoved.map((i) => <div key={`-${i.name}`} className="diff-sub d-removed">− index {i.name}</div>)}
              {t.commentChanged && <div className="diff-sub d-changed">~ comment</div>}
            </div>
          ))}
        </section>
      )}
      {(diff.relationsAdded.length > 0 || diff.relationsRemoved.length > 0) && (
        <section className="diff-sec">
          <div className="section-title">Foreign keys</div>
          {diff.relationsAdded.map((r) => <div key={r.sig} className="diff-line d-added mono small">+ {r.sig}</div>)}
          {diff.relationsRemoved.map((r) => <div key={r.sig} className="diff-line d-removed mono small">− {r.sig}</div>)}
        </section>
      )}
      <div className="section-title">
        Migration
        <span className="grow" />
        <button className="btn sm" onClick={async () => (await copyText(migration)) && useStore.getState().toast('Migration copied')}>
          <Copy size={12} /> Copy
        </button>
        <button className="btn sm" onClick={() => download(`migrate-${slug(base.name)}-to-${slug(schema.name)}.sql`, migration, 'application/sql')}>
          <Download size={12} /> .sql
        </button>
      </div>
      <CodeEditor value={migration} readOnly className="code-small" />
    </div>
  );
}
