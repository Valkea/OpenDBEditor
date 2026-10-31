import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import type { Table } from '../../model/types';

export interface StarNodeData extends Record<string, unknown> {
  table: Table;
  r: number;
  color: string;
  faded?: boolean;
  lit?: boolean;
  focus?: boolean;
  ring?: number;
  /** hops from the lens centre, for the stars it reaches */
  hop?: number;
  /** the centre star seen from a lens centred elsewhere, out of its reach (hop = Infinity when not connected at all) */
  far?: boolean;
  diff?: 'added' | 'changed' | 'removed';
}

export type StarNodeType = Node<StarNodeData, 'star'>;

function StarNodeImpl({ data, selected }: NodeProps<StarNodeType>) {
  const { r, color, table } = data;
  return (
    <div
      className={['star', selected && 'is-selected', data.faded && 'is-faded', data.lit && 'is-lit', data.focus && 'is-focus', data.far && 'is-far', data.diff && `diff-${data.diff}`].filter(Boolean).join(' ')}
      style={{ width: r * 2, height: r * 2, ['--star' as string]: color }}
    >
      <span className="star-halo" style={{ width: r * 5, height: r * 5 }} />
      <span className="star-core">{data.hop ? <span className="star-hop" style={{ fontSize: Math.max(9, Math.round(r * 0.75)) }}>{data.hop === Infinity ? '∞' : data.hop}</span> : null}</span>
      <Handle type="source" position={Position.Top} id="c" className="h-star" isConnectable={false} />
      <span className="star-label">
        {table.name}
        <small>{table.columns.length}</small>
      </span>
    </div>
  );
}

export const StarNode = memo(StarNodeImpl);

export interface RingsNodeData extends Record<string, unknown> {
  radii: number[];
  /** The outermost ring holds tables with no FK path to the focus. */
  unreachable: boolean;
}
export type RingsNodeType = Node<RingsNodeData, 'rings'>;

export const RingsNode = memo(function RingsNode({ data }: NodeProps<RingsNodeType>) {
  const R = (data.radii[data.radii.length - 1] ?? 0) + 40;
  return (
    <svg className="rings" width={R * 2} height={R * 2} viewBox={`${-R} ${-R} ${R * 2} ${R * 2}`}>
      {data.radii.map((r, i) => (
        <g key={i}>
          <circle r={r} />
          <text y={-r - 8}>{i === data.radii.length - 1 && data.unreachable ? 'not connected' : `${i + 1} hop${i ? 's' : ''}`}</text>
        </g>
      ))}
    </svg>
  );
});
