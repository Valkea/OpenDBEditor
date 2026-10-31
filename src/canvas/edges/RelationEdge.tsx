import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Position, useStore, type Edge, type EdgeProps } from '@xyflow/react';
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
  /** A portal relation shown for a moment while its hub's mark is hovered. */
  ghost?: boolean;
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
    data?.ghost && 'is-ghost',
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
  /** hops the link reaches from the lens centre (1 = touches it) */
  reach?: number;
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
  const cls = ['arc', selected && 'is-selected', data?.faded && 'is-faded', data?.lit && 'is-lit', data?.reach && 'is-reach', data?.path && 'is-path'].filter(Boolean).join(' ');
  const style = { ...(data?.color && { ['--rel' as string]: data.color }), ...(data?.reach && { ['--reach' as string]: data.reach }) } as React.CSSProperties;
  return (
    <g className={cls} style={style}>
      <BaseEdge id={id} path={path} className="arc-line" interactionWidth={10} />
      {data?.path && <path d={path} className="rel-flow" />}
    </g>
  );
});

export const NoteLinkEdge = memo(function NoteLinkEdge({ sourceX, sourceY, targetX, targetY }: EdgeProps) {
  return <path d={`M ${sourceX} ${sourceY} L ${targetX} ${targetY}`} className="note-link" />;
});

export interface BundleEdgeData extends Record<string, unknown> {
  /** frames of both ends (flow coordinates) */
  a: { x: number; y: number; w: number; h: number };
  b: { x: number; y: number; w: number; h: number };
  /** relations a → b (a references b) and b → a */
  ab: number;
  ba: number;
  title: string;
  color?: string;
  lit?: boolean;
  dim?: boolean;
}
export type BundleEdgeType = Edge<BundleEdgeData, 'bundle'>;

/** Point where the ray from the centre of `r` towards (tx, ty) leaves `r`, pushed out by `pad`. */
function exitPoint(r: BundleEdgeData['a'], tx: number, ty: number, pad: number) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = tx - cx, dy = ty - cy;
  const k = Math.min(dx ? (r.w / 2 + pad) / Math.abs(dx) : Infinity, dy ? (r.h / 2 + pad) / Math.abs(dy) : Infinity);
  return { x: cx + dx * k, y: cy + dy * k };
}

type Pt = { x: number; y: number };

/** Outline of a whole arrow (shaft plus a head at either end) as one closed shape, so nothing overlaps or shows through. */
function arrowShape(pa: Pt, pb: Pt, shaft: number, head: number, headA: boolean, headB: boolean) {
  const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
  const ux = (pb.x - pa.x) / len, uy = (pb.y - pa.y) / len;
  const vx = -uy, vy = ux;
  const h = Math.min(head, len / ((headA ? 1 : 0) + (headB ? 1 : 0) || 1));
  const hw = Math.max(head * 0.55, shaft * 1.1);
  const ws = shaft / 2;
  const at = (p: Pt, along: number, side: number): Pt => ({ x: p.x + ux * along + vx * side, y: p.y + uy * along + vy * side });
  const pts: Pt[] = [];
  if (headA) pts.push(pa, at(pa, h, hw), at(pa, h, ws));
  else pts.push(at(pa, 0, ws));
  if (headB) pts.push(at(pb, -h, ws), at(pb, -h, hw), pb, at(pb, -h, -hw), at(pb, -h, -ws));
  else pts.push(at(pb, 0, ws), at(pb, 0, -ws));
  if (headA) pts.push(at(pa, h, -ws), at(pa, h, -hw));
  else pts.push(at(pa, 0, -ws));
  return `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`;
}

/** Group-to-group link at overview zoom: one thick line per pair of groups, with the number of foreign keys behind it. */
export const BundleEdge = memo(function BundleEdge({ id, data }: EdgeProps<BundleEdgeType>) {
  // sized in screen pixels: this edge only exists when zoomed far out
  const zoom = useStore((s) => s.transform[2]);
  if (!data) return null;
  const { a, b, ab, ba } = data;
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const pa = exitPoint(a, cb.x, cb.y, 14);
  const pb = exitPoint(b, ca.x, ca.y, 14);
  const n = ab + ba;
  const width = (1.5 + Math.sqrt(n) * 1.5) / zoom;
  const head = (7 + Math.sqrt(n) * 1.5) / zoom;
  // each count sits just inside the group its arrows start from, so it never hides a short line or covers a third group
  const inset = -11 / zoom;
  const qa = exitPoint(a, cb.x, cb.y, inset);
  const qb = exitPoint(b, ca.x, ca.y, inset);
  const cls = ['bundle', data.lit && 'is-lit', data.dim && 'is-dim'].filter(Boolean).join(' ');
  return (
    <g className={cls} style={data.color ? ({ ['--rel' as string]: data.color } as React.CSSProperties) : undefined}>
      <title>{data.title}</title>
      <BaseEdge id={id} path={`M ${pa.x} ${pa.y} L ${pb.x} ${pb.y}`} className="bundle-hit" interactionWidth={width + 16} />
      <path d={arrowShape(pa, pb, width, head, ba > 0, ab > 0)} className="bundle-arrow" />
      <EdgeLabelRenderer>
        {ab > 0 && (
          <div className={`bundle-count ${data.dim ? 'is-dim' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${qa.x}px, ${qa.y}px) scale(${1 / zoom})` }}>
            {ab}
          </div>
        )}
        {ba > 0 && (
          <div className={`bundle-count ${data.dim ? 'is-dim' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${qb.x}px, ${qb.y}px) scale(${1 / zoom})` }}>
            {ba}
          </div>
        )}
      </EdgeLabelRenderer>
    </g>
  );
});
