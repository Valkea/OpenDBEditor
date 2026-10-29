import type { Node, NodeProps } from '@xyflow/react';
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
}

export type RegionNodeType = Node<RegionNodeData, 'region'>;

function RegionNodeImpl({ data, selected }: NodeProps<RegionNodeType>) {
  return (
    <div
      className={['region', data.blueprint && 'region-bp', selected && 'is-selected', data.faded && 'is-faded'].filter(Boolean).join(' ')}
      style={{ width: data.width, height: data.height, ['--region' as string]: data.color }}
    >
      <div className="region-label">
        <span className="region-name">{data.name}</span>
        <span className="region-count">{data.count}</span>
        {data.locked && <Lock size={13} />}
      </div>
    </div>
  );
}

export const RegionNode = memo(RegionNodeImpl);
