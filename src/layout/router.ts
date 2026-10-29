// Orthogonal connector routing for relation lines.
//
// Every line is routed on a sparse grid made of the interesting coordinates
// (card borders + clearance, port rows, port stubs, region borders) with A*:
// cost = length + bends + running along another line + crossing it + cutting
// through a foreign region. Cards are hard obstacles. Afterwards `nudge` spreads
// lines that share a corridor into parallel lanes (see nudge.ts).

import { nudge } from './nudge';

export type Side = 'L' | 'R';
export type Pt = { x: number; y: number };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RouterCard extends Box {
  id: string;
  region?: string;
}

export interface RouterRegion extends Box {
  id: string;
}

export interface RouterEdge {
  id: string;
  /** Lines with the same net (same referenced column) may share a trunk. */
  net: string;
  src: { card: string; y: number };
  dst: { card: string; y: number };
}

export interface Route {
  points: Pt[];
  srcSide: Side;
  dstSide: Side;
}

export interface RouterInput {
  cards: RouterCard[];
  regions?: RouterRegion[];
  edges: RouterEdge[];
}

/** Clearance between a line and a card. */
export const CLEARANCE = 14;
/** Straight run out of a card before the first bend (room for the crow's foot). */
export const STUB = 30;
const BEND = 40;
const OVERLAP = 0.8; // extra cost per px when running along another net
const CROSS = 22;
const FOREIGN = 0.9; // extra cost per px inside a region neither end belongs to
const REGION_GAP = 22;

const E = 0, W = 1, S = 2, N = 3;
const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];
const REVERSE = [W, E, N, S];

function uniqSorted(vals: number[]): number[] {
  const s = [...new Set(vals.map((v) => Math.round(v * 2) / 2))].sort((a, b) => a - b);
  return s;
}

function lowerBound(arr: number[], v: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  peekKey() {
    return this.k[0];
  }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop()!;
    const lv = v.pop()!;
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

interface Port {
  side: Side;
  /** point on the card border */
  p: Pt;
  /** stub end: first grid node */
  node: number;
  /** direction travelled from the card into the stub (source) */
  dir: number;
}

export function routeEdges(input: RouterInput): Map<string, Route> {
  const { cards, edges } = input;
  const regions = input.regions ?? [];
  const out = new Map<string, Route>();
  if (!edges.length) return out;
  const byId = new Map(cards.map((c) => [c.id, c]));

  // ---- grid coordinates ----
  const xv: number[] = [];
  const yv: number[] = [];
  for (const c of cards) {
    xv.push(c.x - CLEARANCE, c.x + c.w + CLEARANCE, c.x - STUB, c.x + c.w + STUB);
    yv.push(c.y - CLEARANCE, c.y + c.h + CLEARANCE);
  }
  for (const r of regions) {
    xv.push(r.x - REGION_GAP, r.x + r.w + REGION_GAP);
    yv.push(r.y - REGION_GAP, r.y + r.h + REGION_GAP);
  }
  for (const e of edges) yv.push(e.src.y, e.dst.y);
  const xs = uniqSorted(xv);
  const ys = uniqSorted(yv);
  const nx = xs.length;
  const ny = ys.length;
  const nodes = nx * ny;
  const at = (i: number, j: number) => j * nx + i;

  // ---- obstacles: node blocked / grid edge blocked (edge k = from node k to its E or S neighbour) ----
  const nodeBlk = new Uint8Array(nodes);
  const hBlk = new Uint8Array(nodes);
  const vBlk = new Uint8Array(nodes);
  for (const c of cards) {
    const x0 = c.x - CLEARANCE + 0.25, x1 = c.x + c.w + CLEARANCE - 0.25;
    const y0 = c.y - CLEARANCE + 0.25, y1 = c.y + c.h + CLEARANCE - 0.25;
    const i0 = lowerBound(xs, x0), i1 = lowerBound(xs, x1); // xs[i0..i1-1] strictly inside
    const j0 = lowerBound(ys, y0), j1 = lowerBound(ys, y1);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) nodeBlk[at(i, j)] = 1;
    // horizontal edges strictly inside in y, spanning inside in x (one node outside on each end included)
    for (let j = j0; j < j1; j++) for (let i = Math.max(0, i0 - 1); i < i1; i++) hBlk[at(i, j)] = 1;
    for (let i = i0; i < i1; i++) for (let j = Math.max(0, j0 - 1); j < j1; j++) vBlk[at(i, j)] = 1;
  }

  // ---- soft regions: which region a grid edge's midpoint falls in ----
  const hReg = new Int16Array(nodes);
  const vReg = new Int16Array(nodes);
  const regionIdx = new Map(regions.map((r, k) => [r.id, k + 1]));
  regions.forEach((r, k) => {
    const i0 = lowerBound(xs, r.x), i1 = lowerBound(xs, r.x + r.w + 0.01);
    const j0 = lowerBound(ys, r.y), j1 = lowerBound(ys, r.y + r.h + 0.01);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1 - 1; i++) hReg[at(i, j)] = k + 1;
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1 - 1; j++) vReg[at(i, j)] = k + 1;
  });

  // ---- usage by already routed lines: 0 = free, n+1 = only net n, -1 = several ----
  const hUse = new Int32Array(nodes);
  const vUse = new Int32Array(nodes);
  const hPass = new Int32Array(nodes);
  const vPass = new Int32Array(nodes);
  const mark = (arr: Int32Array, k: number, net: number) => {
    const v = arr[k];
    if (v === 0) arr[k] = net + 1;
    else if (v !== net + 1) arr[k] = -1;
  };
  const other = (v: number, net: number) => v !== 0 && v !== net + 1;

  const portsOf = (cardId: string, y: number, asSource: boolean): Port[] => {
    const c = byId.get(cardId);
    if (!c) return [];
    const j = lowerBound(ys, Math.round(y * 2) / 2);
    const res: Port[] = [];
    for (const side of ['R', 'L'] as Side[]) {
      const sx = side === 'R' ? c.x + c.w + STUB : c.x - STUB;
      const i = lowerBound(xs, sx);
      if (i >= nx || xs[i] !== sx || j >= ny) continue;
      const node = at(i, j);
      if (nodeBlk[node]) continue;
      const outDir = side === 'R' ? E : W;
      res.push({ side, p: { x: side === 'R' ? c.x + c.w : c.x, y: ys[j] }, node, dir: asSource ? outDir : REVERSE[outDir] });
    }
    return res;
  };

  // ---- A* scratch ----
  const states = nodes * 4;
  const g = new Float64Array(states);
  const seen = new Int32Array(states);
  const prev = new Int32Array(states);
  let stamp = 0;

  const nets = new Map<string, number>();
  const netOf = (n: string) => {
    if (!nets.has(n)) nets.set(n, nets.size);
    return nets.get(n)!;
  };

  const order = [...edges].sort((a, b) => span(a) - span(b));
  function span(e: RouterEdge) {
    const a = byId.get(e.src.card), b = byId.get(e.dst.card);
    if (!a || !b) return 0;
    return Math.abs(a.x - b.x) + Math.abs(e.src.y - e.dst.y);
  }

  for (const e of order) {
    const srcs = portsOf(e.src.card, e.src.y, true);
    const dsts = portsOf(e.dst.card, e.dst.y, false);
    if (!srcs.length || !dsts.length) {
      out.set(e.id, fallback(e));
      continue;
    }
    const net = netOf(e.net);
    const srcCard = byId.get(e.src.card)!, dstCard = byId.get(e.dst.card)!;
    const okRegions = new Set([regionIdx.get(srcCard.region ?? ''), regionIdx.get(dstCard.region ?? '')]);
    const tx = dsts.map((d) => xs[d.node % nx]);
    const ty = ys[Math.floor(dsts[0].node / nx)];
    const h = (node: number) => {
      const x = xs[node % nx], y = ys[Math.floor(node / nx)];
      let best = Infinity;
      for (const t of tx) best = Math.min(best, Math.abs(x - t));
      return best + Math.abs(y - ty);
    };

    stamp++;
    const heap = new Heap();
    for (const s of srcs) {
      const st = s.node * 4 + s.dir;
      seen[st] = stamp;
      g[st] = STUB;
      prev[st] = -1;
      heap.push(STUB + h(s.node), st);
    }
    let best = Infinity;
    let bestState = -1;
    let bestDst: Port | null = null;
    while (heap.size) {
      if (heap.peekKey() >= best) break;
      const st = heap.pop();
      const node = st >> 2;
      const d = st & 3;
      const gc = g[st];
      for (const t of dsts) {
        if (t.node !== node || d === REVERSE[t.dir]) continue;
        const total = gc + STUB + (d === t.dir ? 0 : BEND);
        if (total < best) {
          best = total;
          bestState = st;
          bestDst = t;
        }
      }
      const i = node % nx;
      const j = (node - i) / nx;
      for (let nd = 0; nd < 4; nd++) {
        if (nd === REVERSE[d]) continue;
        const ni = i + DX[nd], nj = j + DY[nd];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
        const nn = at(ni, nj);
        if (nodeBlk[nn]) continue;
        const horiz = nd < 2;
        const ek = horiz ? at(Math.min(i, ni), j) : at(i, Math.min(j, nj));
        if (horiz ? hBlk[ek] : vBlk[ek]) continue;
        const len = horiz ? Math.abs(xs[ni] - xs[i]) : Math.abs(ys[nj] - ys[j]);
        let cost = len;
        const reg = horiz ? hReg[ek] : vReg[ek];
        if (reg && !okRegions.has(reg)) cost += len * FOREIGN;
        if (other(horiz ? hUse[ek] : vUse[ek], net)) cost += len * OVERLAP;
        if (other(horiz ? vPass[nn] : hPass[nn], net)) cost += CROSS;
        if (nd !== d) cost += BEND;
        const ns = nn * 4 + nd;
        const ng = gc + cost;
        if (seen[ns] === stamp && g[ns] <= ng) continue;
        seen[ns] = stamp;
        g[ns] = ng;
        prev[ns] = st;
        heap.push(ng + h(nn), ns);
      }
    }
    if (bestState < 0 || !bestDst) {
      out.set(e.id, fallback(e));
      continue;
    }

    // ---- rebuild path, record usage ----
    const chain: number[] = [];
    for (let s = bestState; s >= 0; s = prev[s]) chain.push(s);
    chain.reverse();
    const first = srcs.find((s) => s.node === chain[0] >> 2 && s.dir === (chain[0] & 3))!;
    const pts: Pt[] = [first.p];
    for (let k = 0; k < chain.length; k++) {
      const node = chain[k] >> 2;
      const i = node % nx, j = (node - i) / nx;
      pts.push({ x: xs[i], y: ys[j] });
      if (k) {
        const pn = chain[k - 1] >> 2;
        const pi = pn % nx, pj = (pn - pi) / nx;
        if (pj === j) {
          mark(hUse, at(Math.min(pi, i), j), net);
          mark(hPass, pn, net);
          mark(hPass, node, net);
        } else {
          mark(vUse, at(i, Math.min(pj, j)), net);
          mark(vPass, pn, net);
          mark(vPass, node, net);
        }
      }
    }
    pts.push(bestDst.p);
    out.set(e.id, { points: simplify(pts), srcSide: first.side, dstSide: bestDst.side });
  }

  function fallback(e: RouterEdge): Route {
    const a = byId.get(e.src.card), b = byId.get(e.dst.card);
    if (!a || !b) return { points: [], srcSide: 'R', dstSide: 'L' };
    const right = a.x + a.w / 2 < b.x + b.w / 2;
    const p0 = { x: right ? a.x + a.w : a.x, y: e.src.y };
    const p1 = { x: right ? b.x : b.x + b.w, y: e.dst.y };
    const mx = (p0.x + p1.x) / 2;
    return { points: simplify([p0, { x: mx, y: p0.y }, { x: mx, y: p1.y }, p1]), srcSide: right ? 'R' : 'L', dstSide: right ? 'L' : 'R' };
  }

  nudge(out, cards, edges, regions);
  return out;
}

/** Drop repeated and collinear points. */
export function simplify(pts: Pt[]): Pt[] {
  const res: Pt[] = [];
  for (const p of pts) {
    const a = res[res.length - 1];
    if (a && a.x === p.x && a.y === p.y) continue;
    const b = res[res.length - 2];
    if (a && b && ((b.x === a.x && a.x === p.x) || (b.y === a.y && a.y === p.y))) res[res.length - 1] = p;
    else res.push(p);
  }
  return res;
}

/** Crossings between routed lines of different nets (shared trunks of one net don't count). */
export function countRouteCrossings(routes: Map<string, Route>, netOf: (id: string) => string = (id) => id): number {
  const hs: { y: number; x0: number; x1: number; net: string }[] = [];
  const vs: { x: number; y0: number; y1: number; net: string }[] = [];
  for (const [id, r] of routes) {
    const net = netOf(id);
    for (let k = 1; k < r.points.length; k++) {
      const a = r.points[k - 1], b = r.points[k];
      if (a.y === b.y) hs.push({ y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), net });
      else if (a.x === b.x) vs.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y), net });
    }
  }
  let n = 0;
  for (const h of hs) for (const v of vs) if (h.net !== v.net && v.x > h.x0 && v.x < h.x1 && h.y > v.y0 && h.y < v.y1) n++;
  return n;
}
