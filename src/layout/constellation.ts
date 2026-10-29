// Constellation view: tables as stars. A force simulation (pulled towards
// their group's anchor) for the overview, and concentric orbits by FK hop
// distance when a table is in focus.

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import { hopDistances, adjacency } from '../analysis/graph';
import type { Schema } from '../model/types';

type Pos = { x: number; y: number };

export function starRadius(columns: number, degree: number): number {
  return 9 + Math.sqrt(columns) * 3 + Math.sqrt(degree) * 4;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  r: number;
  group?: string;
}

export function forceLayoutPositions(schema: Schema): Map<string, Pos> {
  const adj = adjacency(schema);
  const groups = schema.groups.filter((g) => schema.tables.some((t) => t.groupId === g.id));
  const anchors = new Map<string, Pos>();
  const R = 120 + groups.length * 70;
  groups.forEach((g, i) => {
    const a = (i / Math.max(1, groups.length)) * Math.PI * 2 - Math.PI / 2;
    anchors.set(g.id, { x: Math.cos(a) * R, y: Math.sin(a) * R });
  });
  const nodes: SimNode[] = schema.tables.map((t, i) => {
    const anchor = t.groupId ? anchors.get(t.groupId) : undefined;
    const a = (i / schema.tables.length) * Math.PI * 2;
    return {
      id: t.id,
      r: starRadius(t.columns.length, adj.get(t.id)?.length ?? 0),
      group: t.groupId,
      x: (anchor?.x ?? 0) + Math.cos(a) * 60,
      y: (anchor?.y ?? 0) + Math.sin(a) * 60,
    };
  });
  const links = schema.relations
    .filter((r) => r.from.table !== r.to.table)
    .map((r) => ({ source: r.from.table, target: r.to.table, same: schema.tables.find((t) => t.id === r.from.table)?.groupId === schema.tables.find((t) => t.id === r.to.table)?.groupId }));
  const sim = forceSimulation(nodes)
    .force('link', forceLink<SimNode, (typeof links)[number] & { source: string | SimNode; target: string | SimNode }>(links).id((d) => d.id).distance((l) => (l.same ? 90 : 210)).strength((l) => (l.same ? 0.7 : 0.15)))
    .force('charge', forceManyBody().strength(-520))
    .force('collide', forceCollide<SimNode>().radius((d) => d.r + 34))
    .force('x', forceX<SimNode>((d) => (d.group ? anchors.get(d.group)?.x ?? 0 : 0)).strength((d) => (d.group ? 0.12 : 0.03)))
    .force('y', forceY<SimNode>((d) => (d.group ? anchors.get(d.group)?.y ?? 0 : 0)).strength((d) => (d.group ? 0.12 : 0.03)))
    .stop();
  for (let i = 0; i < 500; i++) sim.tick();
  return new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
}

export const ORBIT_GAP = 180;

/** Concentric rings around `focus`; ring k holds tables k FK-hops away. */
export function orbitPositions(schema: Schema, focus: string): { pos: Map<string, Pos>; radii: number[]; unreachable: boolean } {
  const dist = hopDistances(schema, focus);
  const maxD = Math.max(0, ...dist.values());
  const rings: string[][] = Array.from({ length: maxD + 2 }, () => []);
  for (const t of schema.tables) rings[dist.get(t.id) ?? maxD + 1].push(t.id);
  const unreachable = rings[rings.length - 1].length > 0;
  if (!unreachable) rings.pop();
  const radii: number[] = [];
  const adj = adjacency(schema);
  const angle = new Map<string, number>([[focus, 0]]);
  const pos = new Map<string, Pos>([[focus, { x: 0, y: 0 }]]);
  for (let k = 1; k < rings.length; k++) {
    const ring = rings[k];
    // order by the mean angle of already placed neighbours → fewer crossings
    const pref = (id: string) => {
      const as = (adj.get(id) ?? []).map((l) => angle.get(l.other)).filter((a): a is number => a !== undefined);
      return as.length ? Math.atan2(as.reduce((s, a) => s + Math.sin(a), 0), as.reduce((s, a) => s + Math.cos(a), 0)) : 10;
    };
    ring.sort((a, b) => pref(a) - pref(b));
    const r = Math.max((radii[radii.length - 1] ?? 0) + ORBIT_GAP, (ring.length * 64) / (2 * Math.PI));
    radii.push(r);
    const offset = ring.length ? pref(ring[0]) : 0;
    ring.forEach((id, i) => {
      const a = (offset < 9 ? offset : -Math.PI / 2) + (i / ring.length) * Math.PI * 2;
      angle.set(id, a);
      pos.set(id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
    });
  }
  return { pos, radii, unreachable };
}
