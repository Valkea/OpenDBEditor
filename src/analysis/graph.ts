// FK graph helpers: neighbourhoods, hop distances, shortest join paths.

import type { Relation, Schema, Table } from '../model/types';
import { quoteIdent, qualified } from '../sql/pg';

export interface Link {
  rel: Relation;
  other: string;
}

export function adjacency(schema: Schema): Map<string, Link[]> {
  const adj = new Map<string, Link[]>(schema.tables.map((t) => [t.id, []]));
  for (const r of schema.relations) {
    adj.get(r.from.table)?.push({ rel: r, other: r.to.table });
    if (r.from.table !== r.to.table) adj.get(r.to.table)?.push({ rel: r, other: r.from.table });
  }
  return adj;
}

export function hopDistances(schema: Schema, start: string): Map<string, number> {
  const adj = adjacency(schema);
  const dist = new Map<string, number>([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const l of adj.get(cur) ?? []) {
      if (!dist.has(l.other)) {
        dist.set(l.other, dist.get(cur)! + 1);
        queue.push(l.other);
      }
    }
  }
  return dist;
}

/** Shortest FK path between two tables (BFS, undirected). */
export function shortestPath(schema: Schema, a: string, b: string): Relation[] | null {
  if (a === b) return [];
  const adj = adjacency(schema);
  const prev = new Map<string, Link & { from: string }>();
  const seen = new Set([a]);
  const queue = [a];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const l of adj.get(cur) ?? []) {
      if (seen.has(l.other)) continue;
      seen.add(l.other);
      prev.set(l.other, { ...l, from: cur });
      if (l.other === b) {
        const path: Relation[] = [];
        let n = b;
        while (n !== a) {
          const p = prev.get(n)!;
          path.unshift(p.rel);
          n = p.from;
        }
        return path;
      }
      queue.push(l.other);
    }
  }
  return null;
}

/** Inbound FK count per table (how many relations point at it). */
export function inDegree(schema: Schema): Map<string, number> {
  const deg = new Map<string, number>();
  for (const r of schema.relations) deg.set(r.to.table, (deg.get(r.to.table) ?? 0) + 1);
  return deg;
}

function alias(name: string, used: Set<string>): string {
  const base = name.split('_').map((p) => p[0]).join('') || name[0];
  let a = base;
  let i = 2;
  while (used.has(a)) a = `${base}${i++}`;
  used.add(a);
  return a;
}

/** Build `SELECT … FROM a JOIN … ` following a relation path starting at table `start`. */
export function joinSql(schema: Schema, start: string, path: Relation[]): string {
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const used = new Set<string>();
  const aliases = new Map<string, string>();
  const al = (t: Table) => {
    if (!aliases.has(t.id)) aliases.set(t.id, alias(t.name, used));
    return aliases.get(t.id)!;
  };
  const first = byId.get(start)!;
  const lines = [`SELECT ${al(first)}.*`, `FROM ${qualified(first.name, first.schema)} ${al(first)}`];
  let cur = start;
  for (const r of path) {
    const next = r.from.table === cur ? r.to.table : r.from.table;
    const nt = byId.get(next)!;
    const ft = byId.get(r.from.table)!;
    const tt = byId.get(r.to.table)!;
    const nAlias = al(nt);
    const conds = r.from.columns.map((fc, i) => {
      const fcol = ft.columns.find((c) => c.id === fc)!;
      const tcol = tt.columns.find((c) => c.id === r.to.columns[i])!;
      return `${al(tt)}.${quoteIdent(tcol.name)} = ${al(ft)}.${quoteIdent(fcol.name)}`;
    });
    const nullable = r.from.columns.some((fc) => ft.columns.find((c) => c.id === fc)?.nullable);
    const kind = nullable && next === r.to.table ? 'LEFT JOIN' : 'JOIN';
    lines.push(`${kind} ${qualified(nt.name, nt.schema)} ${nAlias} ON ${conds.join(' AND ')}`);
    cur = next;
  }
  return lines.join('\n') + ';';
}
