// Schema → router input: cards, region frames and one line per drawn relation.

import type { Schema } from '../model/types';
import { CARD_W, cardHeight, rowCenterY, type Detail } from './geometry';
import { countRouteCrossings, routeEdges, type Route, type RouterCard, type RouterEdge, type RouterRegion } from './router';

/** Region frame around a group's tables (same padding as the Atlas region node). */
export function regionFrame(schema: Schema, groupId: string, detail: Detail) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of schema.tables) {
    if (t.groupId !== groupId) continue;
    x0 = Math.min(x0, t.x);
    y0 = Math.min(y0, t.y);
    x1 = Math.max(x1, t.x + CARD_W);
    y1 = Math.max(y1, t.y + cardHeight(t, schema, detail));
  }
  if (x0 === Infinity) return null;
  const pad = 28;
  const top = detail === 'compact' ? 64 : 56;
  return { x: x0 - pad, y: y0 - top, w: x1 - x0 + pad * 2, h: y1 - y0 + top + pad };
}

export function routeSchema(schema: Schema, detail: Detail, hidden: Set<string> = new Set()): Map<string, Route> {
  const groupIds = new Set(schema.groups.map((g) => g.id));
  const cards: RouterCard[] = schema.tables.map((t) => ({
    id: t.id,
    x: t.x,
    y: t.y,
    w: CARD_W,
    h: cardHeight(t, schema, detail),
    region: t.groupId && groupIds.has(t.groupId) ? t.groupId : undefined,
  }));
  const regions: RouterRegion[] = [];
  for (const g of schema.groups) {
    const f = regionFrame(schema, g.id, detail);
    if (f) regions.push({ id: g.id, ...f });
  }
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const edges: RouterEdge[] = [];
  for (const r of schema.relations) {
    if (hidden.has(r.id)) continue;
    const f = byId.get(r.from.table);
    const t = byId.get(r.to.table);
    if (!f || !t) continue;
    edges.push({
      id: r.id,
      net: `${t.id}:${r.to.columns[0]}`,
      src: { card: f.id, y: f.y + rowCenterY(f, r.from.columns[0], schema, detail) },
      dst: { card: t.id, y: t.y + rowCenterY(t, r.to.columns[0], schema, detail) },
    });
  }
  return routeEdges({ cards, regions, edges });
}

/** Line crossings as drawn (after routing) at the given detail level. */
export function routedCrossings(schema: Schema, hidden: Set<string> = new Set(), detail: Detail = 'full'): number {
  return countRouteCrossings(routeSchema(schema, detail, hidden));
}
