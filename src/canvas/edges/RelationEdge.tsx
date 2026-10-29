import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Position, type Edge, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';

export interface RelationEdgeData extends Record<string, unknown> {
  label: string;
  onDelete: string;
  childUnique: boolean;
  childNullable: boolean;
  faded?: boolean;
  lit?: boolean;
  path?: boolean;
  diff?: 'added';
  color?: string;
  blueprint?: boolean;
  /** Orthogonal route from the router (source → target); falls back to a smooth step without it. */
  points?: { x: number; y: number }[];
  /** Pushed back while something else has focus. */
  dim?: boolean;
  hover?: boolean;
}

export type RelationEdgeType = Edge<RelationEdgeData, 'relation'>;

/** Crow's-foot glyph drawn at an endpoint. `dir` = 1 when the line leaves to the right. */
function endGlyph(x: number, y: number, dir: number, kind: 'many' | 'one' | 'zero-one' | 'one-one') {
  const p: string[] = [];
  if (kind === 'many') {
    const bx = x + dir * 14;
    p.push(`M ${bx} ${y} L ${x} ${y - 7}`, `M ${bx} ${y} L ${x} ${y + 7}`, `M ${bx} ${y} L ${x} ${y}`);
  }
  if (kind === 'one' || kind === 'one-one' || kind === 'zero-one') {
    const b1 = x + dir * 10;
    p.push(`M ${b1} ${y - 6} L ${b1} ${y + 6}`);
  }
  if (kind === 'one-one') {
    const b2 = x + dir * 16;
    p.push(`M ${b2} ${y - 6} L ${b2} ${y + 6}`);
  }
  return p.join(' ');
}

/** Polyline with rounded corners, plus the point halfway along it (for the label). */
function roundedPath(pts: { x: number; y: number }[], radius = 10): [string, number, number] {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const lin = Math.hypot(b.x - a.x, b.y - a.y);
    const lout = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, lin / 2, lout / 2);
    if (!r) {
      d += ` L ${b.x} ${b.y}`;
      continue;
    }
    d += ` L ${b.x + ((a.x - b.x) / lin) * r} ${b.y + ((a.y - b.y) / lin) * r} Q ${b.x} ${b.y} ${b.x + ((c.x - b.x) / lout) * r} ${b.y + ((c.y - b.y) / lout) * r}`;
  }
  const z = pts[pts.length - 1];
  d += ` L ${z.x} ${z.y}`;
  // label anchor: halfway along the line
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (left <= len && len) return [d, a.x + ((b.x - a.x) * left) / len, a.y + ((b.y - a.y) * left) / len];
    left -= len;
  }
  return [d, z.x, z.y];
}

function RelationEdgeImpl(props: EdgeProps<RelationEdgeType>) {
  const { id, sourcePosition, targetPosition, data, selected } = props;
  let { sourceX, sourceY, targetX, targetY } = props;
  const pts = data?.points && data.points.length > 1 ? data.points : null;
  let path: string, lx: number, ly: number;
  let sDir = sourcePosition === Position.Right ? 1 : -1;
  let tDir = targetPosition === Position.Right ? 1 : -1;
  if (pts) {
    [path, lx, ly] = roundedPath(pts);
    const a = pts[0], b = pts[1], y = pts[pts.length - 2], z = pts[pts.length - 1];
    [sourceX, sourceY, targetX, targetY] = [a.x, a.y, z.x, z.y];
    sDir = b.x >= a.x ? 1 : -1;
    tDir = y.x >= z.x ? 1 : -1;
  } else {
    [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14, offset: 26 });
  }
  const childKind = data?.childUnique ? 'one' : 'many';
  const parentKind = data?.childNullable ? 'zero-one' : 'one-one';
  const cls = [
    'rel',
    selected && 'is-selected',
    data?.faded && 'is-faded',
    data?.dim && 'is-dim',
    data?.lit && 'is-lit',
    data?.hover && 'is-hover',
    data?.path && 'is-path',
    data?.diff && `diff-${data.diff}`,
    data?.onDelete === 'CASCADE' && 'is-cascade',
  ]
    .filter(Boolean)
    .join(' ');
  const style = data?.color ? ({ ['--rel' as string]: data.color } as React.CSSProperties) : undefined;
  return (
    <g className={cls} style={style}>
      <BaseEdge id={id} path={path} className="rel-line" interactionWidth={14} />
      {data?.path && <path d={path} className="rel-flow" />}
      <path d={endGlyph(sourceX, sourceY, sDir, childKind)} className="rel-glyph" />
      <path d={endGlyph(targetX, targetY, tDir, parentKind)} className="rel-glyph" />
      {data?.childNullable && <circle cx={targetX + tDir * 22} cy={targetY} r={3.5} className="rel-glyph rel-hollow" />}
      {(selected || data?.path || data?.hover) && (
        <EdgeLabelRenderer>
          <div className={`rel-label ${data?.path ? 'is-path' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
            {data?.label}
            {data?.onDelete && data.onDelete !== 'NO ACTION' && <span className="rel-action">ON DELETE {data.onDelete}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

export const RelationEdge = memo(RelationEdgeImpl);

export interface ArcEdgeData extends Record<string, unknown> {
  faded?: boolean;
  lit?: boolean;
  color?: string;
  path?: boolean;
}
export type ArcEdgeType = Edge<ArcEdgeData, 'arc'>;

export const ArcEdge = memo(function ArcEdge({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<ArcEdgeType>) {
  const mx = (sourceX + targetX) / 2;
  const my = (sourceY + targetY) / 2;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const bend = 0.18;
  const cx = mx - dy * bend;
  const cy = my + dx * bend;
  const path = `M ${sourceX} ${sourceY} Q ${cx} ${cy} ${targetX} ${targetY}`;
  const cls = ['arc', selected && 'is-selected', data?.faded && 'is-faded', data?.lit && 'is-lit', data?.path && 'is-path'].filter(Boolean).join(' ');
  return (
    <g className={cls} style={data?.color ? ({ ['--rel' as string]: data.color } as React.CSSProperties) : undefined}>
      <BaseEdge id={id} path={path} className="arc-line" interactionWidth={10} />
      {data?.path && <path d={path} className="rel-flow" />}
    </g>
  );
});

export const NoteLinkEdge = memo(function NoteLinkEdge({ sourceX, sourceY, targetX, targetY }: EdgeProps) {
  return <path d={`M ${sourceX} ${sourceY} L ${targetX} ${targetY}`} className="note-link" />;
});
