import { useReactFlow } from '@xyflow/react';
import { Command } from 'cmdk';
import { Boxes, Code2, Focus, LayoutGrid, Link2, Map as MapIcon, Orbit, Plus, Ruler, Sparkles, StickyNote, Table2 } from 'lucide-react';
import { suggestGroups } from '../layout/cluster';
import { encodeSchema, shareUrl } from '../share/codec';
import { useStore } from '../store/store';
import { copyText } from '../util/files';
import { useFly } from './useFly';

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tables = useStore((s) => s.schema.tables);
  const fly = useFly();
  const rf = useReactFlow();
  const st = useStore.getState;
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const center = () => {
    const c = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    return { x: c.x - 140, y: c.y - 60 };
  };
  return (
    <Command.Dialog open={open} onOpenChange={(o) => !o && onClose()} label="Command palette" className="palette" overlayClassName="palette-overlay">
      <Command.Input placeholder="Jump to a table or run a command…" />
      <Command.List>
        <Command.Empty>Nothing matches.</Command.Empty>
        <Command.Group heading="Tables">
          {tables.map((t) => (
            <Command.Item key={t.id} value={`table ${t.name} ${t.columns.map((c) => c.name).join(' ')}`} onSelect={run(() => fly(t.id))}>
              <Table2 size={14} /> {t.name}
              <span className="palette-meta">{t.columns.length} cols</span>
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Actions">
          <Command.Item onSelect={run(() => st().addTable(center()))}>
            <Plus size={14} /> New table <kbd>T</kbd>
          </Command.Item>
          <Command.Item onSelect={run(() => st().addNote(center()))}>
            <StickyNote size={14} /> New note <kbd>N</kbd>
          </Command.Item>
          <Command.Item onSelect={run(() => void st().runAutoLayout())}>
            <LayoutGrid size={14} /> Arrange (auto-layout) <kbd>L</kbd>
          </Command.Item>
          <Command.Item
            onSelect={run(() => {
              const s = suggestGroups(st().schema);
              st().commit((d) => {
                d.groups = s.groups;
                for (const t of d.tables) t.groupId = s.assignment.get(t.id);
              });
              void st().runAutoLayout();
            })}
          >
            <Sparkles size={14} /> Suggest groups from foreign keys
          </Command.Item>
          <Command.Item onSelect={run(() => st().set({ focus: { ...st().focus, enabled: !st().focus.enabled } }))}>
            <Focus size={14} /> Toggle focus lens <kbd>F</kbd>
          </Command.Item>
          <Command.Item onSelect={run(() => st().set({ sqlOpen: !st().sqlOpen }))}>
            <Code2 size={14} /> Toggle SQL pane <kbd>S</kbd>
          </Command.Item>
          <Command.Item
            onSelect={run(async () => {
              const url = shareUrl(encodeSchema(st().schema));
              if (await copyText(url)) st().toast('Link copied');
            })}
          >
            <Link2 size={14} /> Copy share link
          </Command.Item>
          <Command.Item onSelect={run(() => st().set({ sidebar: 'health' }))}>
            <Boxes size={14} /> Open schema health
          </Command.Item>
        </Command.Group>
        <Command.Group heading="Views">
          <Command.Item onSelect={run(() => st().setView('atlas'))}>
            <MapIcon size={14} /> Atlas view <kbd>1</kbd>
          </Command.Item>
          <Command.Item onSelect={run(() => st().setView('blueprint'))}>
            <Ruler size={14} /> Blueprint view <kbd>2</kbd>
          </Command.Item>
          <Command.Item onSelect={run(() => st().setView('constellation'))}>
            <Orbit size={14} /> Constellation view <kbd>3</kbd>
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
