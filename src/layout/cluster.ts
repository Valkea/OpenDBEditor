// Suggest domain groups from the FK graph with Louvain community detection.

import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { uid } from '../model/ids';
import { paletteColor } from '../model/palette';
import type { Group, Schema } from '../model/types';

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const pretty = (name: string) => name.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

export interface Suggestion {
  groups: Group[];
  assignment: Map<string, string>; // table id → group id
}

export function suggestGroups(schema: Schema, resolution = 1): Suggestion {
  const g = new Graph({ type: 'undirected', multi: false });
  for (const t of schema.tables) g.addNode(t.id);
  for (const r of schema.relations) {
    if (r.from.table === r.to.table) continue;
    if (g.hasEdge(r.from.table, r.to.table)) g.updateEdgeAttribute(r.from.table, r.to.table, 'weight', (w: number) => w + 1);
    else g.addEdge(r.from.table, r.to.table, { weight: 1 });
  }
  const communities = g.size ? louvain(g, { getEdgeWeight: 'weight', resolution, rng: seeded(42) }) : {};
  const members = new Map<number, string[]>();
  for (const [node, c] of Object.entries(communities)) {
    if (!members.has(c)) members.set(c, []);
    members.get(c)!.push(node);
  }
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const groups: Group[] = [];
  const assignment = new Map<string, string>();
  const sorted = [...members.values()].filter((m) => m.length > 1).sort((a, b) => b.length - a.length);
  sorted.forEach((ids, i) => {
    // name the group after its most connected member
    const anchor = ids.reduce((best, id) => (g.degree(id) > g.degree(best) ? id : best), ids[0]);
    const group: Group = { id: uid(), name: pretty(byId.get(anchor)!.name), color: paletteColor(i) };
    groups.push(group);
    for (const id of ids) assignment.set(id, group.id);
  });
  return { groups, assignment };
}
