// Layout metadata that SQL can't express (positions, groups, notes, colours),
// carried inside downloaded .sql files as a trailing comment block.

import type { Group, Note, Schema, TableStatus, ViewMode } from '../model/types';
import { packJson, unpackJson } from '../share/codec';

interface TableMeta {
  x: number;
  y: number;
  g?: string;
  c?: string;
  l?: 1;
  s?: TableStatus;
  p?: 1;
}

interface LayoutMeta {
  n: string;
  v?: ViewMode;
  g: Group[];
  notes: (Omit<Note, 'attachedTo'> & { a?: string })[];
  t: Record<string, TableMeta>;
}

const key = (name: string, schema?: string) => (schema ? `${schema}.${name}` : name);

export function encodeLayout(schema: Schema): string {
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const meta: LayoutMeta = {
    n: schema.name,
    v: schema.view,
    g: schema.groups,
    notes: schema.notes.map(({ attachedTo, ...n }) => {
      const t = attachedTo ? byId.get(attachedTo) : undefined;
      return t ? { ...n, a: key(t.name, t.schema) } : n;
    }),
    t: {},
  };
  for (const t of schema.tables) {
    const m: TableMeta = { x: Math.round(t.x), y: Math.round(t.y) };
    if (t.groupId) m.g = t.groupId;
    if (t.color) m.c = t.color;
    if (t.locked) m.l = 1;
    if (t.status) m.s = t.status;
    if (t.portal) m.p = 1;
    meta.t[key(t.name, t.schema)] = m;
  }
  return packJson(meta);
}

/** Apply a layout blob onto a freshly parsed schema. Returns true if any table got a position. */
export function applyLayout(schema: Schema, blob: string): boolean {
  let meta: LayoutMeta;
  try {
    meta = unpackJson<LayoutMeta>(blob);
  } catch {
    return false;
  }
  schema.name = meta.n || schema.name;
  schema.view = meta.v;
  schema.groups = meta.g ?? [];
  const groupIds = new Set(schema.groups.map((g) => g.id));
  const byKey = new Map(schema.tables.map((t) => [key(t.name, t.schema), t]));
  let placed = false;
  for (const [k, m] of Object.entries(meta.t ?? {})) {
    const t = byKey.get(k);
    if (!t) continue;
    t.x = m.x;
    t.y = m.y;
    if (m.g && groupIds.has(m.g)) t.groupId = m.g;
    if (m.c) t.color = m.c;
    if (m.l) t.locked = true;
    if (m.s) t.status = m.s;
    if (m.p) t.portal = true;
    placed = true;
  }
  schema.notes = (meta.notes ?? []).map(({ a, ...n }) => ({ ...n, attachedTo: a ? byKey.get(a)?.id : undefined }));
  return placed;
}
