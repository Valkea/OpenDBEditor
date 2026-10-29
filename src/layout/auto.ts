// Auto-layout: ELK "layered" on a compound graph (groups contain tables, ports
// sit on the exact column rows) to minimise crossings, then locked tables are
// honoured by anchoring their group and pushing everything else out of the way.

import type { ElkExtendedEdge, ElkNode, ElkPort } from 'elkjs/lib/elk-api';
import type { Schema } from '../model/types';
import { CARD_W, cardHeight, rowCenterY, type Rect } from './geometry';
import { routedCrossings } from './routing';

export type Direction = 'RIGHT' | 'DOWN';

export interface LayoutOptions {
  direction: Direction;
  /** Relations to leave out (e.g. drawn as portals). */
  hiddenRelations?: Set<string>;
  spacing?: number;
  /** Force one strategy instead of picking the best. */
  only?: Strategy;
}

type Pos = { x: number; y: number };

let elkPromise: Promise<{ layout: (g: ElkNode) => Promise<ElkNode> }> | null = null;
function getElk() {
  elkPromise ??= import('elkjs/lib/elk.bundled.js').then((m) => new m.default());
  return elkPromise;
}

export type Strategy = 'compound' | 'islands-down' | 'islands-right' | 'islands-stress';

export interface LayoutResult {
  pos: Map<string, Pos>;
  strategy: Strategy;
  crossings: number;
}

const TARGET_ASPECT = 1.7;

/** Lower is better: crossings dominate, then an elongated or sprawling drawing. */
function score(schema: Schema, pos: Map<string, Pos>, hidden: Set<string>): { score: number; crossings: number } {
  const probe: Schema = { ...schema, tables: schema.tables.map((t) => ({ ...t, ...pos.get(t.id) })) };
  const crossings = routedCrossings(probe, hidden);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, area = 0;
  for (const t of probe.tables) {
    const h = cardHeight(t, schema);
    x0 = Math.min(x0, t.x);
    y0 = Math.min(y0, t.y);
    x1 = Math.max(x1, t.x + CARD_W);
    y1 = Math.max(y1, t.y + h);
    area += CARD_W * h;
  }
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const aspect = Math.abs(Math.log(w / h / TARGET_ASPECT));
  const sprawl = (w * h) / Math.max(1, area);
  return { score: crossings + aspect * 10 + sprawl * 1.5, crossings };
}

export async function autoLayout(schema: Schema, opts: LayoutOptions): Promise<Map<string, Pos>> {
  return (await autoLayoutDetailed(schema, opts)).pos;
}

/** Try several strategies and keep the cleanest drawing. */
export async function autoLayoutDetailed(schema: Schema, opts: LayoutOptions): Promise<LayoutResult> {
  const hidden = opts.hiddenRelations ?? new Set<string>();
  const strategies: Strategy[] = opts.only ? [opts.only] : schema.groups.length ? ['islands-down', 'islands-right', 'islands-stress', 'compound'] : ['compound'];
  let best: (LayoutResult & { score: number }) | null = null;
  for (const strategy of strategies) {
    const raw = strategy === 'compound' ? await compoundLayout(schema, opts) : await islandsLayout(schema, opts, strategy);
    removeBlockOverlaps(schema, raw, () => false);
    const sc = score(schema, raw, hidden);
    if (!best || sc.score < best.score) best = { pos: raw, strategy, crossings: sc.crossings, score: sc.score };
  }
  const pos = finalize(schema, best!.pos);
  return { pos, strategy: best!.strategy, crossings: best!.crossings };
}

function isLockedFn(schema: Schema) {
  const groupLocked = new Set(schema.groups.filter((g) => g.locked).map((g) => g.id));
  return (t: Schema['tables'][number]) => !!t.locked || (!!t.groupId && groupLocked.has(t.groupId));
}

/** Anchor to locked tables, or keep the drawing where it was so the camera doesn't jump. */
function finalize(schema: Schema, pos: Map<string, Pos>): Map<string, Pos> {
  const isLocked = isLockedFn(schema);
  if (schema.tables.some(isLocked)) return honourLocks(schema, pos, isLocked);
  const minOf = (vals: number[]) => (vals.length ? Math.min(...vals) : 0);
  const dx = minOf(schema.tables.map((t) => t.x)) - minOf([...pos.values()].map((p) => p.x));
  const dy = minOf(schema.tables.map((t) => t.y)) - minOf([...pos.values()].map((p) => p.y));
  for (const p of pos.values()) {
    p.x = Math.round(p.x + dx);
    p.y = Math.round(p.y + dy);
  }
  return pos;
}

async function compoundLayout(schema: Schema, opts: LayoutOptions): Promise<Map<string, Pos>> {
  const elk = await getElk();
  const spacing = opts.spacing ?? 1;
  const horizontal = opts.direction === 'RIGHT';
  const hidden = opts.hiddenRelations ?? new Set<string>();
  const rels = schema.relations.filter((r) => !hidden.has(r.id) && r.from.table !== r.to.table);

  const usedCols = new Set<string>();
  for (const r of rels) {
    usedCols.add(r.from.columns[0]);
    usedCols.add(r.to.columns[0]);
  }

  const tableNode = (t: Schema['tables'][number]): ElkNode => portsFor(schema, t, usedCols, horizontal);

  const groupIds = new Set(schema.groups.map((g) => g.id));
  const children: ElkNode[] = [];
  for (const g of schema.groups) {
    const members = schema.tables.filter((t) => t.groupId === g.id);
    if (!members.length) continue;
    children.push({
      id: `g:${g.id}`,
      children: members.map(tableNode),
      layoutOptions: { 'elk.padding': '[top=72,left=36,bottom=36,right=36]' },
    });
  }
  for (const t of schema.tables) if (!t.groupId || !groupIds.has(t.groupId)) children.push(tableNode(t));

  const edges: ElkExtendedEdge[] = rels.map((r) => ({
    id: r.id,
    sources: [horizontal ? `${r.to.columns[0]}:E` : r.to.table],
    targets: [horizontal ? `${r.from.columns[0]}:W` : r.from.table],
  }));

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': opts.direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.round(110 * spacing)),
      'elk.spacing.nodeNode': String(Math.round(48 * spacing)),
      'elk.spacing.edgeNode': '24',
      'elk.spacing.componentComponent': String(Math.round(120 * spacing)),
      'elk.padding': '[top=40,left=40,bottom=40,right=40]',
    },
    children,
    edges,
  };

  const res = await elk.layout(graph);
  const pos = new Map<string, Pos>();
  const walk = (n: ElkNode, ox: number, oy: number) => {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      if (c.id.startsWith('g:')) walk(c, x, y);
      else pos.set(c.id, { x, y });
    }
  };
  walk(res, 0, 0);

  return pos;
}

function portsFor(schema: Schema, t: Schema['tables'][number], usedCols: Set<string>, horizontal: boolean): ElkNode {
  const ports: ElkPort[] = [];
  if (horizontal) {
    for (const c of t.columns) {
      if (!usedCols.has(c.id)) continue;
      const y = rowCenterY(t, c.id, schema) - 1;
      ports.push({ id: `${c.id}:E`, x: CARD_W, y, width: 1, height: 1, layoutOptions: { 'elk.port.side': 'EAST' } });
      ports.push({ id: `${c.id}:W`, x: -1, y, width: 1, height: 1, layoutOptions: { 'elk.port.side': 'WEST' } });
    }
  }
  return { id: t.id, width: CARD_W, height: cardHeight(t, schema), ports, layoutOptions: horizontal ? { 'elk.portConstraints': 'FIXED_POS' } : {} };
}

const GROUP_PAD = { top: 72, side: 36, bottom: 36 };

/** Phase 1: each group laid out on its own (left → right). Phase 2: the groups, as rigid islands, arranged in 2D. */
async function islandsLayout(schema: Schema, opts: LayoutOptions, strategy: Strategy): Promise<Map<string, Pos>> {
  const elk = await getElk();
  const spacing = opts.spacing ?? 1;
  const hidden = opts.hiddenRelations ?? new Set<string>();
  const rels = schema.relations.filter((r) => !hidden.has(r.id) && r.from.table !== r.to.table);
  const groupIds = new Set(schema.groups.map((g) => g.id));
  const blockOf = (t: Schema['tables'][number]) => (t.groupId && groupIds.has(t.groupId) ? `g:${t.groupId}` : `t:${t.id}`);
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const blocks = new Map<string, Schema['tables']>();
  for (const t of schema.tables) {
    const b = blockOf(t);
    if (!blocks.has(b)) blocks.set(b, []);
    blocks.get(b)!.push(t);
  }

  // phase 1
  const local = new Map<string, Pos>();
  const size = new Map<string, { w: number; h: number }>();
  for (const [bid, members] of blocks) {
    if (members.length === 1) {
      local.set(members[0].id, { x: bid.startsWith('g:') ? GROUP_PAD.side : 0, y: bid.startsWith('g:') ? GROUP_PAD.top : 0 });
      const grouped = bid.startsWith('g:');
      size.set(bid, { w: CARD_W + (grouped ? GROUP_PAD.side * 2 : 0), h: cardHeight(members[0], schema) + (grouped ? GROUP_PAD.top + GROUP_PAD.bottom : 0) });
      continue;
    }
    const ids = new Set(members.map((m) => m.id));
    const inner = rels.filter((r) => ids.has(r.from.table) && ids.has(r.to.table));
    const used = new Set(inner.flatMap((r) => [r.from.columns[0], r.to.columns[0]]));
    const res = await elk.layout({
      id: bid,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.round(100 * spacing)),
        'elk.spacing.nodeNode': String(Math.round(40 * spacing)),
        'elk.spacing.componentComponent': String(Math.round(48 * spacing)),
        'elk.aspectRatio': '1.4',
        'elk.padding': `[top=${GROUP_PAD.top},left=${GROUP_PAD.side},bottom=${GROUP_PAD.bottom},right=${GROUP_PAD.side}]`,
      },
      children: members.map((m) => portsFor(schema, m, used, true)),
      edges: inner.map((r) => ({ id: r.id, sources: [`${r.to.columns[0]}:E`], targets: [`${r.from.columns[0]}:W`] })),
    });
    for (const c of res.children ?? []) local.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
    size.set(bid, { w: res.width ?? 0, h: res.height ?? 0 });
  }

  // phase 2: one edge per inter-island relation (parent island → child island)
  const outer = rels
    .map((r) => ({ id: r.id, s: blockOf(byId.get(r.to.table)!), t: blockOf(byId.get(r.from.table)!) }))
    .filter((e) => e.s !== e.t);
  const algo = strategy === 'islands-stress' ? 'stress' : 'layered';
  const res = await elk.layout({
    id: 'root',
    layoutOptions:
      algo === 'stress'
        ? { 'elk.algorithm': 'stress', 'elk.stress.desiredEdgeLength': String(Math.round(260 * spacing)), 'elk.stress.dimension': 'XY' }
        : {
            'elk.algorithm': 'layered',
            'elk.direction': strategy === 'islands-down' ? 'DOWN' : 'RIGHT',
            'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
            'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
            'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.round(120 * spacing)),
            'elk.spacing.nodeNode': String(Math.round(90 * spacing)),
            'elk.spacing.componentComponent': String(Math.round(120 * spacing)),
            'elk.layered.wrapping.strategy': 'MULTI_EDGE',
            'elk.aspectRatio': String(TARGET_ASPECT),
          },
    children: [...blocks.keys()].map((b) => ({ id: b, width: size.get(b)!.w, height: size.get(b)!.h })),
    edges: outer.map((e) => ({ id: e.id, sources: [e.s], targets: [e.t] })),
  });
  const pos = new Map<string, Pos>();
  for (const c of res.children ?? []) {
    for (const t of blocks.get(c.id) ?? []) {
      const l = local.get(t.id)!;
      // group padding is part of the island; table coordinates are absolute
      pos.set(t.id, { x: (c.x ?? 0) + l.x, y: (c.y ?? 0) + l.y });
    }
  }
  return pos;
}

interface Block {
  ids: string[];
  fixed: boolean;
  rect: Rect;
}

const MARGIN = 48;

function honourLocks(schema: Schema, pos: Map<string, Pos>, isLocked: (t: Schema['tables'][number]) => boolean): Map<string, Pos> {
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  // blocks: one per group, one per ungrouped table
  const blocks = new Map<string, string[]>();
  for (const t of schema.tables) {
    const k = t.groupId ? `g:${t.groupId}` : t.id;
    if (!blocks.has(k)) blocks.set(k, []);
    blocks.get(k)!.push(t.id);
  }
  const out: Block[] = [];
  for (const ids of blocks.values()) {
    const locked = ids.filter((id) => isLocked(byId.get(id)!));
    if (locked.length) {
      // least-squares translation that brings locked tables back home
      let dx = 0;
      let dy = 0;
      for (const id of locked) {
        dx += byId.get(id)!.x - pos.get(id)!.x;
        dy += byId.get(id)!.y - pos.get(id)!.y;
      }
      dx /= locked.length;
      dy /= locked.length;
      for (const id of ids) {
        const p = pos.get(id)!;
        p.x += dx;
        p.y += dy;
      }
      for (const id of locked) pos.set(id, { x: byId.get(id)!.x, y: byId.get(id)!.y });
      separateWithin(ids, schema, pos, new Set(locked));
    }
    out.push({ ids, fixed: locked.length > 0, rect: bounds(ids, schema, pos) });
  }

  separateBlocks(out, pos);
  return pos;
}

/** Push blocks (groups / lone tables) apart until nothing overlaps. Fixed blocks never move. */
function separateBlocks(out: Block[], pos: Map<string, Pos>) {
  for (let iter = 0; iter < 400; iter++) {
    let moved = false;
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const A = out[i];
        const B = out[j];
        if (A.fixed && B.fixed) continue;
        const ox = Math.min(A.rect.x + A.rect.w, B.rect.x + B.rect.w) - Math.max(A.rect.x, B.rect.x) + MARGIN;
        const oy = Math.min(A.rect.y + A.rect.h, B.rect.y + B.rect.h) - Math.max(A.rect.y, B.rect.y) + MARGIN;
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const alongX = ox < oy;
        const amount = alongX ? ox : oy;
        const sign = alongX ? Math.sign(B.rect.x + B.rect.w / 2 - (A.rect.x + A.rect.w / 2)) || 1 : Math.sign(B.rect.y + B.rect.h / 2 - (A.rect.y + A.rect.h / 2)) || 1;
        const shareA = A.fixed ? 0 : B.fixed ? 1 : 0.5;
        shift(A, -sign * amount * shareA, alongX, pos);
        shift(B, sign * amount * (1 - shareA), alongX, pos);
      }
    if (!moved) break;
  }
}

export function removeBlockOverlaps(schema: Schema, pos: Map<string, Pos>, isFixed: (ids: string[]) => boolean) {
  const blocks = new Map<string, string[]>();
  for (const t of schema.tables) {
    const k = t.groupId ? `g:${t.groupId}` : t.id;
    if (!blocks.has(k)) blocks.set(k, []);
    blocks.get(k)!.push(t.id);
  }
  const out: Block[] = [...blocks.values()].map((ids) => ({ ids, fixed: isFixed(ids), rect: bounds(ids, schema, pos) }));
  separateBlocks(out, pos);
}

function shift(b: Block, d: number, alongX: boolean, pos: Map<string, Pos>) {
  if (!d) return;
  for (const id of b.ids) {
    const p = pos.get(id)!;
    if (alongX) p.x += d;
    else p.y += d;
  }
  if (alongX) b.rect.x += d;
  else b.rect.y += d;
}

function bounds(ids: string[], schema: Schema, pos: Map<string, Pos>): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const id of ids) {
    const t = schema.tables.find((x) => x.id === id)!;
    const p = pos.get(id)!;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + CARD_W);
    y1 = Math.max(y1, p.y + cardHeight(t, schema));
  }
  // room for the group label above
  return { x: x0 - 36, y: y0 - 72, w: x1 - x0 + 72, h: y1 - y0 + 108 };
}

function separateWithin(ids: string[], schema: Schema, pos: Map<string, Pos>, fixed: Set<string>) {
  const rect = (id: string): Rect => {
    const t = schema.tables.find((x) => x.id === id)!;
    const p = pos.get(id)!;
    return { x: p.x, y: p.y, w: CARD_W, h: cardHeight(t, schema) };
  };
  for (let iter = 0; iter < 200; iter++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        if (fixed.has(a) && fixed.has(b)) continue;
        const A = rect(a);
        const B = rect(b);
        const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) + 32;
        const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) + 32;
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const alongX = ox < oy;
        const amt = alongX ? ox : oy;
        const sign = alongX ? Math.sign(B.x - A.x) || 1 : Math.sign(B.y - A.y) || 1;
        const sa = fixed.has(a) ? 0 : fixed.has(b) ? 1 : 0.5;
        const pa = pos.get(a)!;
        const pb = pos.get(b)!;
        if (alongX) {
          pa.x -= sign * amt * sa;
          pb.x += sign * amt * (1 - sa);
        } else {
          pa.y -= sign * amt * sa;
          pb.y += sign * amt * (1 - sa);
        }
      }
    if (!moved) break;
  }
}
