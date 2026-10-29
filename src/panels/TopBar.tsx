import { getNodesBounds, getViewportForBounds, useReactFlow } from '@xyflow/react';
import {
  Boxes,
  Code2,
  Download,
  FileUp,
  Focus,
  Image,
  LayoutGrid,
  Link2,
  Loader2,
  Map as MapIcon,
  Moon,
  Orbit,
  Redo2,
  Ruler,
  Search,
  Sun,
  Undo2,
  Waypoints,
  Workflow,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ViewMode } from '../model/types';
import { encodeSchema, shareUrl } from '../share/codec';
import { generateSql } from '../sql/generator';
import { useStore } from '../store/store';
import { copyText, download, pickFile, slug } from '../util/files';

const VIEWS: { id: ViewMode; label: string; icon: typeof MapIcon; hint: string }[] = [
  { id: 'atlas', label: 'Atlas', icon: MapIcon, hint: 'Domains as regions, semantic zoom (1)' },
  { id: 'blueprint', label: 'Blueprint', icon: Ruler, hint: 'Classic full-detail ERD (2)' },
  { id: 'constellation', label: 'Constellation', icon: Orbit, hint: 'Explore as a graph; double-click a star for orbits (3)' },
];

function Menu({ label, icon, children }: { label: string; icon: React.ReactNode; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={`tb-btn ${open ? 'is-on' : ''}`} onClick={() => setOpen(!open)}>
        {icon}
        <span className="tb-label">{label}</span>
      </button>
      {open && <div className="menu-pop">{children(() => setOpen(false))}</div>}
    </div>
  );
}

export async function exportPng(rf: ReturnType<typeof useReactFlow>, theme: string) {
  const { toPng } = await import('html-to-image');
  const nodes = rf.getNodes();
  if (!nodes.length) return;
  const b = getNodesBounds(nodes);
  const scale = 2;
  const w = Math.min(12000, Math.round((b.width + 160) * scale));
  const h = Math.min(12000, Math.round((b.height + 160) * scale));
  const vp = getViewportForBounds(b, w, h, 0.05, 4, 0.04);
  const el = document.querySelector('.react-flow__viewport') as HTMLElement;
  const bg = getComputedStyle(document.querySelector('.canvas') as HTMLElement).getPropertyValue('--canvas-bg').trim() || (theme === 'dark' ? '#0b0d12' : '#f7f7f5');
  return toPng(el, { backgroundColor: bg, width: w, height: h, style: { width: `${w}px`, height: `${h}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` } });
}

export function TopBar({ onPalette }: { onPalette: () => void }) {
  const schema = useStore((s) => s.schema);
  const view = schema.view ?? 'atlas';
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const sqlOpen = useStore((s) => s.sqlOpen);
  const theme = useStore((s) => s.theme);
  const focus = useStore((s) => s.focus);
  const portals = useStore((s) => s.portals);
  const busy = useStore((s) => s.layoutBusy);
  const direction = useStore((s) => s.direction);
  const arrangeMode = useStore((s) => s.arrangeMode);
  const st = useStore.getState;
  const rf = useReactFlow();

  const share = async () => {
    const url = shareUrl(encodeSchema(st().schema));
    window.history.replaceState(null, '', url);
    if (await copyText(url)) st().toast(`Link copied · ${(url.length / 1024).toFixed(1)} kB, everything lives in the URL`);
  };

  return (
    <header className="topbar">
      <div className="brand" title="OpenDB Editor">
        <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
          <circle cx="10" cy="11" r="3.2" fill="#7c9cff" />
          <circle cx="22" cy="9" r="2.4" fill="#5eead4" />
          <circle cx="20" cy="22" r="3.6" fill="#f0abfc" />
          <path d="M10 11 L22 9 M10 11 L20 22 M22 9 L20 22" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.2" />
        </svg>
        <span>OpenDB</span>
      </div>
      <input
        className="schema-name"
        value={schema.name}
        onChange={(e) => st().commit((d) => void (d.name = e.target.value), 'schema-name')}
        spellCheck={false}
        aria-label="Schema name"
      />
      <div className="segmented" role="tablist">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? 'is-on' : ''} title={v.hint} onClick={() => st().setView(v.id)}>
            <v.icon size={15} />
            <span className="tb-label">{v.label}</span>
          </button>
        ))}
      </div>
      <span className="grow" />
      <div className="tb-group">
        {view !== 'constellation' && (
          <div className="split">
            <button className="tb-btn" title="Auto-layout (L): clusters by group, minimises crossings, keeps locked tables" disabled={busy} onClick={() => void st().runAutoLayout()}>
              {busy ? <Loader2 size={15} className="spin" /> : <LayoutGrid size={15} />}
              <span className="tb-label">Arrange</span>
            </button>
            <button
              className="tb-btn tb-mini"
              title={arrangeMode === 'groups' ? 'Arrange by group: islands per domain, fewest crossings (click: by dependency)' : 'Arrange by dependency: referenced tables first, groups as bands (click: by group)'}
              onClick={() => st().set({ arrangeMode: arrangeMode === 'groups' ? 'flow' : 'groups' })}
            >
              {arrangeMode === 'groups' ? <Boxes size={14} /> : <Workflow size={14} />}
            </button>
            <button className="tb-btn tb-mini" title={`Direction: ${direction === 'RIGHT' ? 'left → right' : 'top → bottom'}`} onClick={() => st().set({ direction: direction === 'RIGHT' ? 'DOWN' : 'RIGHT' })}>
              {direction === 'RIGHT' ? '→' : '↓'}
            </button>
          </div>
        )}
        <div className="split">
          <button className={`tb-btn ${focus.enabled ? 'is-on' : ''}`} title="Focus lens (F): fade tables beyond N hops of the selection" onClick={() => st().set({ focus: { ...focus, enabled: !focus.enabled } })}>
            <Focus size={15} />
            <span className="tb-label">Lens</span>
          </button>
          {focus.enabled && (
            <button className="tb-btn tb-mini" title="Hops" onClick={() => st().set({ focus: { ...focus, hops: (focus.hops % 3) + 1 } })}>
              {focus.hops}
            </button>
          )}
        </div>
        {view === 'atlas' && (
          <button className={`tb-btn ${portals ? 'is-on' : ''}`} title="Portals: references to hub tables (≥5 inbound FKs) become chips instead of long lines" onClick={() => st().set({ portals: !portals })}>
            <Waypoints size={15} />
            <span className="tb-label">Portals</span>
          </button>
        )}
      </div>
      <div className="tb-group">
        <button className="tb-btn" title="Undo (⌘Z)" disabled={!canUndo} onClick={() => st().undo()}>
          <Undo2 size={15} />
        </button>
        <button className="tb-btn" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={() => st().redo()}>
          <Redo2 size={15} />
        </button>
      </div>
      <div className="tb-group">
        <button
          className="tb-btn"
          title="Open a .sql file"
          onClick={async () => {
            const f = await pickFile();
            if (f) await st().importSql(await f.text(), f.name);
          }}
        >
          <FileUp size={15} />
          <span className="tb-label">Open</span>
        </button>
        <Menu label="Export" icon={<Download size={15} />}>
          {(close) => (
            <>
              <button onClick={() => { download(`${slug(schema.name)}.sql`, generateSql(schema, { embedLayout: true }), 'application/sql'); close(); }}>
                <Download size={14} /> SQL + layout <small>re-opens with positions</small>
              </button>
              <button onClick={() => { download(`${slug(schema.name)}.sql`, generateSql(schema), 'application/sql'); close(); }}>
                <Code2 size={14} /> Plain SQL
              </button>
              <button
                onClick={async () => {
                  close();
                  const url = await exportPng(rf, theme);
                  if (url) {
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${slug(schema.name)}-${view}.png`;
                    a.click();
                  }
                }}
              >
                <Image size={14} /> PNG image
              </button>
            </>
          )}
        </Menu>
        <button className="tb-btn primary" title="Copy a link that contains the whole schema" onClick={share}>
          <Link2 size={15} />
          <span className="tb-label">Share</span>
        </button>
      </div>
      <div className="tb-group">
        <button className={`tb-btn ${sqlOpen ? 'is-on' : ''}`} title="Live SQL pane (S)" onClick={() => st().set({ sqlOpen: !sqlOpen })}>
          <Code2 size={15} />
          <span className="tb-label">SQL</span>
        </button>
        <button className="tb-btn" title="Command palette (⌘K)" onClick={onPalette}>
          <Search size={15} />
        </button>
        <button
          className="tb-btn"
          title="Toggle theme"
          onClick={() => {
            const t = theme === 'dark' ? 'light' : 'dark';
            st().set({ theme: t });
            try {
              localStorage.setItem('odbe-theme', t);
            } catch {
              /* ignore */
            }
          }}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
}
