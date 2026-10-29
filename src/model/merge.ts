// Merge a freshly parsed schema into the current one so that editing SQL keeps
// everything the canvas owns: ids, positions, groups, colours, locks, notes.

import type { Schema, Table } from './types';

const key = (t: { name: string; schema?: string }) => `${t.schema ?? ''}.${t.name}`;

/** Last known position of every table name seen this session, so a table that
 * briefly disappears while the user is typing comes back where it was. */
const memory = new Map<string, Pick<Table, 'x' | 'y' | 'groupId' | 'color' | 'locked' | 'status' | 'portal' | 'id'>>();

export function rememberLayout(schema: Schema) {
  for (const t of schema.tables) {
    memory.set(key(t), { id: t.id, x: t.x, y: t.y, groupId: t.groupId, color: t.color, locked: t.locked, status: t.status, portal: t.portal });
  }
}

export interface MergeResult {
  schema: Schema;
  /** Ids of tables that had no previous position. */
  fresh: string[];
}

export function mergeParsed(prev: Schema, parsed: Schema): MergeResult {
  rememberLayout(prev);
  const prevByKey = new Map(prev.tables.map((t) => [key(t), t]));
  const idMap = new Map<string, string>(); // parsed table id → final id
  const colMap = new Map<string, string>(); // parsed column id → final id
  const fresh: string[] = [];

  const tables = parsed.tables.map((t) => {
    const old = prevByKey.get(key(t));
    const mem = memory.get(key(t));
    const base = old ?? mem;
    const id = base?.id ?? t.id;
    idMap.set(t.id, id);
    const columns = t.columns.map((c) => {
      const oc = old?.columns.find((x) => x.name === c.name);
      const cid = oc?.id ?? c.id;
      colMap.set(c.id, cid);
      return { ...c, id: cid };
    });
    const indexes = t.indexes.map((i) => ({ ...i, id: old?.indexes.find((x) => x.name === i.name)?.id ?? i.id }));
    if (!base) fresh.push(id);
    return {
      ...t,
      id,
      columns,
      indexes,
      x: base?.x ?? 0,
      y: base?.y ?? 0,
      groupId: base?.groupId,
      color: base?.color,
      locked: base?.locked,
      status: base?.status,
      portal: base?.portal,
    } satisfies Table;
  });

  const relations = parsed.relations.map((r) => {
    const from = { table: idMap.get(r.from.table)!, columns: r.from.columns.map((c) => colMap.get(c)!) };
    const to = { table: idMap.get(r.to.table)!, columns: r.to.columns.map((c) => colMap.get(c)!) };
    const old = prev.relations.find(
      (o) => o.from.table === from.table && o.to.table === to.table && o.from.columns.join() === from.columns.join(),
    );
    return { ...r, id: old?.id ?? r.id, from, to };
  });

  const enums = parsed.enums.map((e) => ({ ...e, id: prev.enums.find((o) => o.name === e.name)?.id ?? e.id }));
  const tableIds = new Set(tables.map((t) => t.id));

  return {
    schema: {
      ...prev,
      extensions: parsed.extensions,
      enums,
      tables,
      relations,
      raw: parsed.raw,
      notes: prev.notes.map((n) => (n.attachedTo && !tableIds.has(n.attachedTo) ? { ...n, attachedTo: undefined } : n)),
    },
    fresh,
  };
}
