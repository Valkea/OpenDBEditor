import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/store';

export interface NoteNodeData extends Record<string, unknown> {
  text: string;
  color: string;
  faded?: boolean;
}

export type NoteNodeType = Node<NoteNodeData, 'note'>;

/** Tiny markdown: **bold**, `code`, # heading, - bullets. */
function renderMd(text: string) {
  return text.split('\n').map((line, i) => {
    const heading = /^#{1,3}\s+/.test(line);
    const bullet = /^\s*[-*]\s+/.test(line);
    const body = line.replace(/^#{1,3}\s+/, '').replace(/^\s*[-*]\s+/, '');
    const parts = body.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, k) =>
      p.startsWith('**') ? <strong key={k}>{p.slice(2, -2)}</strong> : p.startsWith('`') ? <code key={k}>{p.slice(1, -1)}</code> : p,
    );
    if (heading) return <h4 key={i}>{parts}</h4>;
    if (bullet) return <div key={i} className="note-li">• {parts}</div>;
    return <div key={i}>{parts.length && body ? parts : ' '}</div>;
  });
}

function NoteNodeImpl({ id, data, selected }: NodeProps<NoteNodeType>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const commit = useStore((s) => s.commit);
  useEffect(() => setDraft(data.text), [data.text]);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  return (
    <div className={['note', selected && 'is-selected', data.faded && 'is-faded'].filter(Boolean).join(' ')} style={{ ['--note' as string]: data.color }} onDoubleClick={() => setEditing(true)}>
      <Handle type="source" position={Position.Left} id="n" className="h h-note" isConnectable={false} />
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={80}
        lineClassName="note-resize-line"
        handleClassName="note-resize-handle"
        onResizeEnd={(_, p) =>
          commit((d) => {
            const n = d.notes.find((x) => x.id === id);
            if (n) Object.assign(n, { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) });
          })
        }
      />
      {editing ? (
        <textarea
          ref={ref}
          className="note-edit nodrag nowheel"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft !== data.text) commit((d) => void (d.notes.find((x) => x.id === id)!.text = draft));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
          }}
        />
      ) : (
        <div className="note-body">{renderMd(data.text)}</div>
      )}
    </div>
  );
}

export const NoteNode = memo(NoteNodeImpl);
