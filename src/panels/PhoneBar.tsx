import {
  Boxes,
  Code2,
  Focus,
  LayoutGrid,
  Loader2,
  Moon,
  Plus,
  SlidersHorizontal,
  StickyNote,
  Sun,
  Table2,
  Waypoints,
  Workflow,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { SidebarTabs } from './Sidebar';
import { useIsPhone } from '../util/phone';
import { VIEWS } from './TopBar';
import { useActions } from './useActions';

type Section = 'add' | 'layout' | 'view';

/** One tool in the ribbon: icon above a short label. */
function Tool({ icon, label, on, disabled, onClick }: { icon: React.ReactNode; label: string; on?: boolean; disabled?: boolean; onClick: () => unknown }) {
  return (
    <button className={`ribbon-btn ${on ? 'is-on' : ''}`} disabled={disabled} onClick={() => void onClick()}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

/**
 * Phone only: a narrow bar of icons down the left edge. The panel and view buttons act at once; the other icons open a
 * ribbon of tools along the top of the diagram. One-shot tools close the ribbon, switches keep it open.
 */
export function PhoneBar() {
  const phone = useIsPhone();
  const [open, setOpen] = useState<Section | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const schema = useStore((s) => s.schema);
  const view = schema.view ?? 'atlas';
  const welcome = useStore((s) => s.welcome);
  const sqlOpen = useStore((s) => s.sqlOpen);
  const theme = useStore((s) => s.theme);
  const focus = useStore((s) => s.focus);
  const portals = useStore((s) => s.portals);
  const busy = useStore((s) => s.layoutBusy);
  const direction = useStore((s) => s.direction);
  const arrangeMode = useStore((s) => s.arrangeMode);
  const directionIgnored = arrangeMode === 'groups' && schema.groups.length > 0;
  const st = useStore.getState;
  const { toggleTheme, center } = useActions();

  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    // pointerdown + capture: also fires for taps, before the canvas can swallow them
    window.addEventListener('pointerdown', h, true);
    return () => window.removeEventListener('pointerdown', h, true);
  }, [open]);
  // the layout tools mean nothing in the constellation view
  useEffect(() => {
    if (view === 'constellation' && open === 'layout') setOpen(null);
  }, [view, open]);

  if (!phone) return null;

  const once = (fn: () => unknown) => () => {
    setOpen(null);
    void fn();
  };
  const toggle = (s: Section) => setOpen(open === s ? null : s);
  const SECTIONS: { id: Section; label: string; icon: typeof Plus; hidden?: boolean }[] = [
    { id: 'add', label: 'Add', icon: Plus },
    { id: 'layout', label: 'Layout', icon: LayoutGrid, hidden: view === 'constellation' },
    { id: 'view', label: 'View', icon: SlidersHorizontal },
  ];

  return (
    <div className="phonebar" ref={ref}>
      <nav className="phonebar-icons">
        {!welcome && (
          <>
            <SidebarTabs onPick={() => { setOpen(null); st().set({ sqlOpen: false }); }} />
            <span className="phonebar-sep" />
          </>
        )}
        {VIEWS.map((v) => (
          <button key={v.id} className={`rail-btn ${view === v.id ? 'is-active' : ''}`} title={v.label} aria-pressed={view === v.id} onClick={() => st().setView(v.id)}>
            <v.icon size={18} />
          </button>
        ))}
        <span className="phonebar-sep" />
        {SECTIONS.filter((s) => !s.hidden).map((s) => (
          <button key={s.id} className={`rail-btn ${open === s.id ? 'is-active' : ''}`} title={s.label} aria-expanded={open === s.id} onClick={() => toggle(s.id)}>
            <s.icon size={18} />
          </button>
        ))}
      </nav>
      {open && (
        <div className="ribbon" role="toolbar" aria-label={SECTIONS.find((s) => s.id === open)?.label}>
          {open === 'add' && (
            <>
              <Tool icon={<Table2 size={18} />} label="Table" onClick={once(() => st().addTable(center()))} />
              <Tool icon={<StickyNote size={18} />} label="Note" onClick={once(() => st().addNote(center()))} />
            </>
          )}
          {open === 'layout' && (
            <>
              <Tool icon={busy ? <Loader2 size={18} className="spin" /> : <LayoutGrid size={18} />} label="Arrange" disabled={busy} onClick={once(() => st().runAutoLayout())} />
              <Tool
                icon={arrangeMode === 'groups' ? <Boxes size={18} /> : <Workflow size={18} />}
                label={arrangeMode === 'groups' ? 'By group' : 'By dependency'}
                onClick={() => st().set({ arrangeMode: arrangeMode === 'groups' ? 'flow' : 'groups' })}
              />
              {!directionIgnored && (
                <Tool
                  icon={<span className="ribbon-glyph">{direction === 'RIGHT' ? '→' : '↓'}</span>}
                  label={direction === 'RIGHT' ? 'Left → right' : 'Top → bottom'}
                  onClick={() => st().set({ direction: direction === 'RIGHT' ? 'DOWN' : 'RIGHT' })}
                />
              )}
            </>
          )}
          {open === 'view' && (
            <>
              <Tool icon={<Code2 size={18} />} label="SQL pane" on={sqlOpen} onClick={once(() => st().set({ sqlOpen: !sqlOpen, sidebar: null }))} />
              <Tool icon={<Focus size={18} />} label="Focus lens" on={focus.enabled} onClick={() => st().set({ focus: { ...focus, enabled: !focus.enabled } })} />
              {focus.enabled && (
                <Tool
                  icon={<span className="ribbon-glyph">{focus.hops}</span>}
                  label={`${focus.hops} hop${focus.hops > 1 ? 's' : ''}`}
                  onClick={() => st().set({ focus: { ...focus, hops: (focus.hops % 3) + 1 } })}
                />
              )}
              {view === 'atlas' && <Tool icon={<Waypoints size={18} />} label="Portals" on={portals} onClick={() => st().set({ portals: !portals })} />}
              <Tool icon={theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />} label={theme === 'dark' ? 'Light' : 'Dark'} onClick={toggleTheme} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
