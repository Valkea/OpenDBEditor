// Card geometry shared by the renderer (CSS) and the layout engine. Cards have
// a fixed width and fixed row heights so layout never depends on DOM measuring.

import type { Schema, Table } from '../model/types';

export const CARD_W = 288;
export const HEADER_H = 48;
export const COMMENT_H = 30;
export const ROW_H = 26;
export const FOOT_H = 8;

export type Detail = 'full' | 'keys' | 'compact';

export function keyColumnIds(table: Table, schema: Schema): Set<string> {
  const ids = new Set<string>();
  for (const c of table.columns) if (c.pk || c.unique) ids.add(c.id);
  for (const r of schema.relations) {
    if (r.from.table === table.id) r.from.columns.forEach((c) => ids.add(c));
    if (r.to.table === table.id) r.to.columns.forEach((c) => ids.add(c));
  }
  return ids;
}

export function visibleColumns(table: Table, schema: Schema, detail: Detail) {
  if (detail === 'compact') return [];
  if (detail === 'full') return table.columns;
  const keys = keyColumnIds(table, schema);
  return table.columns.filter((c) => keys.has(c.id));
}

export function cardHeight(table: Table, schema: Schema, detail: Detail = 'full'): number {
  // the far-zoom "map" block keeps the full footprint so islands stay dense
  if (detail === 'compact') return cardHeight(table, schema, 'full');
  const rows = visibleColumns(table, schema, detail).length;
  const hidden = table.columns.length - rows;
  return HEADER_H + (table.comment && detail === 'full' ? COMMENT_H : 0) + rows * ROW_H + (hidden ? ROW_H : 0) + FOOT_H;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function tableRect(t: Table, schema: Schema, detail: Detail = 'full'): Rect {
  return { x: t.x, y: t.y, w: CARD_W, h: cardHeight(t, schema, detail) };
}

/** y offset (relative to card top) of the centre of a column row. */
export function rowCenterY(table: Table, colId: string, schema: Schema, detail: Detail = 'full'): number {
  if (detail === 'compact') return cardHeight(table, schema, 'full') / 2;
  const cols = visibleColumns(table, schema, detail);
  const i = cols.findIndex((c) => c.id === colId);
  const top = HEADER_H + (table.comment && detail === 'full' ? COMMENT_H : 0);
  return i < 0 ? HEADER_H / 2 : top + i * ROW_H + ROW_H / 2;
}

function segmentsCross(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  const [x1, y1, x2, y2] = a;
  const [x3, y3, x4, y4] = b;
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (d === 0) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}

/** Approximate number of edge crossings (straight segments between FK rows). */
export function countCrossings(schema: Schema, hidden: Set<string> = new Set()): number {
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const segs: { s: [number, number, number, number]; a: string; b: string }[] = [];
  for (const r of schema.relations) {
    if (hidden.has(r.id) || r.from.table === r.to.table) continue;
    const f = byId.get(r.from.table);
    const t = byId.get(r.to.table);
    if (!f || !t) continue;
    const fRight = f.x + CARD_W / 2 < t.x + CARD_W / 2;
    const fx = fRight ? f.x + CARD_W : f.x;
    const tx = fRight ? t.x : t.x + CARD_W;
    segs.push({ s: [fx, f.y + rowCenterY(f, r.from.columns[0], schema), tx, t.y + rowCenterY(t, r.to.columns[0], schema)], a: f.id, b: t.id });
  }
  let n = 0;
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i];
      const B = segs[j];
      if (A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b) continue;
      if (segmentsCross(A.s, B.s)) n++;
    }
  return n;
}
