import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Lock } from 'lucide-react';
import { memo } from 'react';

export interface RegionNodeData extends Record<string, unknown> {
  name: string;
  color: string;
  count: number;
  locked?: boolean;
  width: number;
  height: number;
  blueprint?: boolean;
  faded?: boolean;
  /** Far zoom: the group stands for its tables (solid block, name in the middle). */
  overview?: boolean;
  /** Foreign keys to / from other groups, shown in overview. */
  links?: number;
  dim?: boolean;
}

export type RegionNodeType = Node<RegionNodeData, 'region'>;

function RegionNodeImpl({ data, selected }: NodeProps<RegionNodeType>) {
  return (
    <div
      className={['region', data.blueprint && 'region-bp', data.overview && 'region-overview', selected && 'is-selected', data.faded && 'is-faded', data.dim && 'is-dim'].filter(Boolean).join(' ')}
      style={{ width: data.width, height: data.height, ['--region' as string]: data.color }}
    >
      <Handle type="source" position={Position.Top} id="c" className="h-star" isConnectable={false} />
      {data.overview && (
        <div className="region-ov">
          <span className="region-ov-name">{data.name}</span>
          <span className="region-ov-meta">
            {data.count} table{data.count === 1 ? '' : 's'}
            {!!data.links && ` · ${data.links} link${data.links === 1 ? '' : 's'} out`}
          </span>
        </div>
      )}
      <div className="region-label">
        <span className="region-name">{data.name}</span>
        <span className="region-count">{data.count}</span>
        {data.locked && <Lock size={13} />}
      </div>
    </div>
  );
}

export const RegionNode = memo(RegionNodeImpl);
