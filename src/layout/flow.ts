// "Flow" arrangement: tables in columns by dependency depth (a table sits one
// column after the deepest table it references), groups as bands across the
// columns. Every line then runs the same way, from referenced to referencing.

import type { Schema } from '../model/types';
import { CARD_W, cardHeight, rowCenterY } from './geometry';

type Pos = { x: number; y: number };

/** Longest-path depth in a dependency graph (`parents` of each node); cycles are broken at the edge closing them. */
export function longestPathDepth(ids: string[], parents: Map<string, string[]>): Map<string, number> {
  const depth = new Map<string, number>();
  const onStack = new Set<string>();
  const visit = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    onStack.add(id);
    let d = 0;
    for (const p of parents.get(id) ?? []) if (!onStack.has(p)) d = Math.max(d, visit(p) + 1);
    onStack.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const id of ids) visit(id);
  return depth;
}

/** Depth of each table: 0 when it references nothing, else 1 + the depth of the deepest table it references. */
export function dependencyDepth(schema: Schema, hidden: Set<string> = new Set()): Map<string, number> {
  const parents = new Map<string, string[]>(schema.tables.map((t) => [t.id, []]));
  for (const r of schema.relations) {
    if (hidden.has(r.id) || r.from.table === r.to.table) continue;
    parents.get(r.from.table)?.push(r.to.table);
  }
  return longestPathDepth(schema.tables.map((t) => t.id), parents);
}

const GAP_LAYER = 170; // between depth columns: room for the line lanes
const GAP_STACK = 44; // between tables in one cell
const BAND_GAP = 110; // between group bands
const PAD = { top: 72, side: 36, bottom: 36 }; // group frame around a band's tables

/**
 * What a flow drawing is made of: each table's column, the order of the group bands, and the
 * order of tables inside each (band, column) cell. Positions follow from it (`placeFlow`).
 */
export interface FlowPlan {
  depth: Map<string, number>;
  bands: string[];
  cells: Map<string, string[]>; // `${band}|${depth}` → table ids, top to bottom (left to right when DOWN)
  bandOf: Map<string, string>;
  maxDepth: number;
}

/** Referenced tables (`up`) and referencing tables (`down`) of each table, self-links and hidden lines left out. */
export function flowLinks(schema: Schema, hidden: Set<string> = new Set()) {
  const up = new Map<string, string[]>(schema.tables.map((t) => [t.id, []]));
  const down = new Map<string, string[]>(schema.tables.map((t) => [t.id, []]));
  for (const r of schema.relations) {
    if (hidden.has(r.id) || r.from.table === r.to.table) continue;
    up.get(r.from.table)?.push(r.to.table);
    down.get(r.to.table)?.push(r.from.table);
  }
  return { up, down };
}

export const cellKey = (band: string, depth: number) => `${band}|${depth}`;

/** Columns a table may move to while every line still runs forward (cycles aside). */
export function depthRange(id: string, depth: Map<string, number>, links: ReturnType<typeof flowLinks>, maxDepth: number): [number, number] {
  const d = depth.get(id)!;
  let lo = 0;
  let hi = maxDepth;
  for (const p of links.up.get(id)!) if (depth.get(p)! < d) lo = Math.max(lo, depth.get(p)! + 1);
  for (const c of links.down.get(id)!) if (depth.get(c)! > d) hi = Math.min(hi, depth.get(c)! - 1);
  return [lo, hi];
}

/** A first plan: tight columns, bands from foundational to dependent, cells ordered by a few barycentre sweeps. */
export function flowPlan(schema: Schema, hidden: Set<string> = new Set()): FlowPlan {
  const links = flowLinks(schema, hidden);
  const depth = dependencyDepth(schema, hidden);
  const maxDepth = Math.max(0, ...depth.values());
  // a table that references nothing moves next to its earliest user, instead of waiting in column 0
  for (const t of [...schema.tables].sort((a, b) => depth.get(b.id)! - depth.get(a.id)!)) {
    if (links.up.get(t.id)!.length || !links.down.get(t.id)!.length) continue;
    depth.set(t.id, depthRange(t.id, depth, links, maxDepth)[1]);
  }

  const groupIds = new Set(schema.groups.map((g) => g.id));
  const bandOf = new Map(schema.tables.map((t) => [t.id, t.groupId && groupIds.has(t.groupId) ? t.groupId : '']));
  const members = new Map<string, string[]>();
  for (const t of schema.tables) {
    const b = bandOf.get(t.id)!;
    if (!members.has(b)) members.set(b, []);
    members.get(b)!.push(t.id);
  }
  const meanDepth = (ids: string[]) => ids.reduce((n, id) => n + depth.get(id)!, 0) / ids.length;
  const bands = [...members.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : meanDepth(members.get(a)!) - meanDepth(members.get(b)!)));

  const name = new Map(schema.tables.map((t) => [t.id, t.name]));
  const cells = new Map<string, string[]>();
  for (const b of bands) for (let d = 0; d <= maxDepth; d++) cells.set(cellKey(b, d), []);
  for (const t of schema.tables) cells.get(cellKey(bandOf.get(t.id)!, depth.get(t.id)!))!.push(t.id);
  for (const cell of cells.values()) cell.sort((a, b) => name.get(a)!.localeCompare(name.get(b)!));

  // global rank = band, then place in cell; sweep down using referenced tables, up using referencing ones
  const plan: FlowPlan = { depth, bands, cells, bandOf, maxDepth };
  const rank = new Map<string, number>();
  const rerank = () => bands.forEach((b, bi) => {
    for (let d = 0; d <= maxDepth; d++) cells.get(cellKey(b, d))!.forEach((id, i) => rank.set(id, bi * 1000 + i));
  });
  rerank();
  for (let sweep = 0; sweep < 4; sweep++) {
    const nbrs = sweep % 2 === 0 ? links.up : links.down;
    const ds = Array.from({ length: maxDepth + 1 }, (_, d) => d);
    for (const d of sweep % 2 === 0 ? ds : ds.reverse())
      for (const b of bands) {
        const cell = cells.get(cellKey(b, d))!;
        const bary = new Map(cell.map((id, i) => {
          const ns = nbrs.get(id)!.map((n) => rank.get(n)!);
          return [id, ns.length ? ns.reduce((x, y) => x + y, 0) / ns.length : rank.get(id)! + i * 1e-3];
        }));
        cell.sort((x, y) => bary.get(x)! - bary.get(y)!);
        cell.forEach((id, i) => rank.set(id, bands.indexOf(b) * 1000 + i));
      }
  }
  return plan;
}

export function clonePlan(p: FlowPlan): FlowPlan {
  return { ...p, depth: new Map(p.depth), bands: [...p.bands], cells: new Map([...p.cells].map(([k, v]) => [k, [...v]])) };
}

/** Least-squares non-decreasing fit (pool adjacent violators). */
function isotonic(values: number[], weights: number[]): number[] {
  const blocks: { v: number; w: number; n: number }[] = [];
  values.forEach((v, i) => {
    blocks.push({ v, w: weights[i], n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v) {
      const b = blocks.pop()!;
      const a = blocks[blocks.length - 1];
      a.v = (a.v * a.w + b.v * b.w) / (a.w + b.w);
      a.w += b.w;
      a.n += b.n;
    }
  });
  return blocks.flatMap((b) => Array<number>(b.n).fill(b.v));
}

/**
 * Where each card of a band goes along its cell (y when RIGHT, x when DOWN), relative to the band.
 * Each card aims at the spot that makes its lines to the band's other cards straight; a cell keeps
 * its order and gaps and gets as close as it can to those aims (left → right, back, and again).
 */
function alignBand(
  plan: FlowPlan,
  band: string,
  size: (id: string) => number,
  links: Map<string, { other: string; mine: number; theirs: number }[]>,
  start: number,
): Map<string, number> {
  const at = new Map<string, number>();
  const cols = Array.from({ length: plan.maxDepth + 1 }, (_, d) => d);
  for (const [pass, order] of [cols, [...cols].reverse(), cols].entries())
    for (const d of order) {
      const cell = plan.cells.get(cellKey(band, d))!;
      if (!cell.length) continue;
      const offset: number[] = [];
      let acc = 0;
      for (const id of cell) {
        offset.push(acc);
        acc += size(id) + GAP_STACK;
      }
      const want: number[] = [];
      const weight: number[] = [];
      cell.forEach((id, i) => {
        const aims = (links.get(id) ?? []).filter((l) => at.has(l.other) && plan.depth.get(l.other) !== d && (pass > 0 || plan.depth.get(l.other)! < d));
        if (aims.length) {
          want.push(aims.reduce((n, l) => n + at.get(l.other)! + l.theirs - l.mine, 0) / aims.length - offset[i]);
          weight.push(aims.length);
        } else {
          want.push(start); // nothing to line up with: stay packed
          weight.push(0.01);
        }
      });
      isotonic(want, weight).forEach((z, i) => at.set(cell[i], Math.max(z, start) + offset[i]));
    }
  return at;
}

export function placeFlow(schema: Schema, plan: FlowPlan, direction: 'RIGHT' | 'DOWN', hidden: Set<string> = new Set()): Map<string, Pos> {
  const { bands, cells, maxDepth } = plan;
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const h = (id: string) => cardHeight(byId.get(id)!, schema);
  // lines inside a band: where they leave each card (row centre when RIGHT, card centre when DOWN)
  const links = new Map<string, { other: string; mine: number; theirs: number }[]>();
  for (const r of schema.relations) {
    if (hidden.has(r.id) || r.from.table === r.to.table || plan.bandOf.get(r.from.table) !== plan.bandOf.get(r.to.table)) continue;
    const f = byId.get(r.from.table)!;
    const t = byId.get(r.to.table)!;
    const fr = direction === 'RIGHT' ? rowCenterY(f, r.from.columns[0], schema) : 0;
    const tr = direction === 'RIGHT' ? rowCenterY(t, r.to.columns[0], schema) : 0;
    for (const [a, b, ar, br] of [[f.id, t.id, fr, tr], [t.id, f.id, tr, fr]] as const) {
      if (!links.has(a)) links.set(a, []);
      links.get(a)!.push({ other: b, mine: ar, theirs: br });
    }
  }
  const pos = new Map<string, Pos>();
  if (direction === 'RIGHT') {
    let y = 0;
    for (const b of bands) {
      const framed = b !== '';
      const at = alignBand(plan, b, h, links, framed ? PAD.top : 0);
      if (!at.size) continue;
      let bandH = 0;
      for (let d = 0; d <= maxDepth; d++)
        for (const id of cells.get(cellKey(b, d))!) {
          pos.set(id, { x: d * (CARD_W + GAP_LAYER), y: y + at.get(id)! });
          bandH = Math.max(bandH, at.get(id)! + h(id));
        }
      y += bandH + (framed ? PAD.bottom : 0) + BAND_GAP;
    }
  } else {
    // depth runs down; bands sit side by side; a cell's tables sit in a row
    const rowH = Array.from({ length: maxDepth + 1 }, (_, d) => Math.max(0, ...bands.flatMap((b) => cells.get(cellKey(b, d))!.map(h))));
    const rowY: number[] = [];
    let acc = 0;
    for (let d = 0; d <= maxDepth; d++) {
      rowY.push(acc);
      acc += rowH[d] + GAP_LAYER;
    }
    let x = 0;
    for (const b of bands) {
      const framed = b !== '';
      const at = alignBand(plan, b, () => CARD_W, links, framed ? PAD.side : 0);
      if (!at.size) continue;
      let bandW = 0;
      for (let d = 0; d <= maxDepth; d++)
        for (const id of cells.get(cellKey(b, d))!) {
          pos.set(id, { x: x + at.get(id)!, y: rowY[d] + (framed ? PAD.top : 0) });
          bandW = Math.max(bandW, at.get(id)! + CARD_W);
        }
      x += bandW + (framed ? PAD.side : 0) + BAND_GAP;
    }
  }
  return pos;
}

export function flowLayout(schema: Schema, direction: 'RIGHT' | 'DOWN', hidden: Set<string> = new Set()): Map<string, Pos> {
  return placeFlow(schema, flowPlan(schema, hidden), direction, hidden);
}
