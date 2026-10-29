// "Flow" arrangement: tables in columns by dependency depth (a table sits one
// column after the deepest table it references), groups as bands across the
// columns. Every line then runs the same way, from referenced to referencing.

import type { Schema, Table } from '../model/types';
import { CARD_W, cardHeight } from './geometry';

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

export function flowLayout(schema: Schema, direction: 'RIGHT' | 'DOWN', hidden: Set<string> = new Set()): Map<string, Pos> {
  const depth = dependencyDepth(schema, hidden);
  const groupIds = new Set(schema.groups.map((g) => g.id));
  const bandOf = (t: Table) => (t.groupId && groupIds.has(t.groupId) ? t.groupId : '');

  // bands: groups ordered from foundational (low mean depth) to dependent; ungrouped tables last
  const members = new Map<string, Table[]>();
  for (const t of schema.tables) {
    const b = bandOf(t);
    if (!members.has(b)) members.set(b, []);
    members.get(b)!.push(t);
  }
  const meanDepth = (ts: Table[]) => ts.reduce((n, t) => n + depth.get(t.id)!, 0) / ts.length;
  const bands = [...members.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : meanDepth(members.get(a)!) - meanDepth(members.get(b)!)));
  const maxDepth = Math.max(0, ...depth.values());

  // order inside each cell by the mean position of the referenced tables (one sweep, shallow → deep)
  const parents = new Map<string, string[]>(schema.tables.map((t) => [t.id, []]));
  for (const r of schema.relations) if (!hidden.has(r.id) && r.from.table !== r.to.table) parents.get(r.from.table)?.push(r.to.table);
  const rank = new Map<string, number>();
  const cells = new Map<string, Table[]>(); // `${band}|${depth}` → tables
  bands.forEach((b, bi) => {
    for (let d = 0; d <= maxDepth; d++) cells.set(`${b}|${d}`, []);
    for (const t of members.get(b)!) cells.get(`${b}|${depth.get(t.id)}`)!.push(t);
    for (let d = 0; d <= maxDepth; d++) {
      const cell = cells.get(`${b}|${d}`)!;
      const bary = (t: Table) => {
        const ps = parents.get(t.id)!.map((p) => rank.get(p)).filter((v): v is number => v !== undefined);
        return ps.length ? ps.reduce((x, y) => x + y, 0) / ps.length : bi * 1000;
      };
      cell.sort((a, c) => bary(a) - bary(c) || a.name.localeCompare(c.name));
      cell.forEach((t, i) => rank.set(t.id, bi * 1000 + i));
    }
  });

  const pos = new Map<string, Pos>();
  const h = (t: Table) => cardHeight(t, schema);
  if (direction === 'RIGHT') {
    let y = 0;
    for (const b of bands) {
      const framed = b !== '';
      let bandH = 0;
      for (let d = 0; d <= maxDepth; d++) {
        let cy = y + (framed ? PAD.top : 0);
        for (const t of cells.get(`${b}|${d}`)!) {
          pos.set(t.id, { x: d * (CARD_W + GAP_LAYER), y: cy });
          cy += h(t) + GAP_STACK;
        }
        bandH = Math.max(bandH, cy - GAP_STACK - y);
      }
      y += bandH + (framed ? PAD.bottom : 0) + BAND_GAP;
    }
  } else {
    // depth runs down; bands sit side by side; a cell's tables sit in a row
    const rowH = Array.from({ length: maxDepth + 1 }, (_, d) => Math.max(0, ...schema.tables.filter((t) => depth.get(t.id) === d).map(h)));
    const rowY: number[] = [];
    let acc = 0;
    for (let d = 0; d <= maxDepth; d++) {
      rowY.push(acc);
      acc += rowH[d] + GAP_LAYER;
    }
    let x = 0;
    for (const b of bands) {
      const framed = b !== '';
      let bandW = 0;
      for (let d = 0; d <= maxDepth; d++) {
        let cx = x + (framed ? PAD.side : 0);
        for (const t of cells.get(`${b}|${d}`)!) {
          pos.set(t.id, { x: cx, y: rowY[d] + (framed ? PAD.top : 0) });
          cx += CARD_W + GAP_STACK;
        }
        bandW = Math.max(bandW, cx - GAP_STACK - x);
      }
      x += bandW + (framed ? PAD.side : 0) + BAND_GAP;
    }
  }
  return pos;
}
