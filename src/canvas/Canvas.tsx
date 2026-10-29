import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  useStore as useFlowStore,
  useStoreApi,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type ReactFlowState,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adjacency, hopDistances } from '../analysis/graph';
import { CARD_W, cardHeight, type Detail } from '../layout/geometry';
import { forceLayoutPositions, orbitPositions, starRadius } from '../layout/constellation';
import { regionFrame, routeSchema } from '../layout/routing';
import { uid } from '../model/ids';
import type { Schema } from '../model/types';
import { canonicalType, isSerial } from '../sql/pg';
import { useDiff, useHidden, useIssues, useLens, usePath } from '../store/derived';
import { Lock, LockOpen, Map as MapIcon, X } from 'lucide-react';
import { useStore } from '../store/store';
import { useIsPhone } from '../util/phone';
import { ArcEdge, BundleEdge, NoteLinkEdge, RelationEdge } from './edges/RelationEdge';
import { NoteNode } from './nodes/NoteNode';
import { RegionNode } from './nodes/RegionNode';
import { RingsNode, StarNode } from './nodes/StarNode';
import { TableNode } from './nodes/TableNode';

const nodeTypes = { table: TableNode, region: RegionNode, note: NoteNode, star: StarNode, rings: RingsNode };
const edgeTypes = { relation: RelationEdge, arc: ArcEdge, notelink: NoteLinkEdge, bundle: BundleEdge };

const detailSelector = (s: ReactFlowState): Detail => (s.transform[2] < 0.42 ? 'compact' : s.transform[2] < 0.75 ? 'keys' : 'full');
/** Below this zoom, Atlas shows groups instead of tables. */
const OVERVIEW_ZOOM = 0.2;
const overviewSelector = (s: ReactFlowState) => s.transform[2] < OVERVIEW_ZOOM;

type Pos = { x: number; y: number };

function useAnimatedPositions(target: Map<string, Pos> | null) {
  const [pos, setPos] = useState<Map<string, Pos> | null>(target);
  const cur = useRef<Map<string, Pos> | null>(target);
  useEffect(() => {
    if (!target) {
      cur.current = null;
      setPos(null);
      return;
    }
    const from = cur.current;
    if (!from) {
      cur.current = target;
      setPos(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 700);
      const e = 1 - Math.pow(1 - k, 3);
      const next = new Map<string, Pos>();
      for (const [id, b] of target) {
        const a = from.get(id) ?? b;
        next.set(id, { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e });
      }
      cur.current = next;
      setPos(next);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return [pos, (id: string, p: Pos) => {
    const next = new Map(cur.current ?? []);
    next.set(id, p);
    cur.current = next;
    setPos(next);
  }] as const;
}

export function Canvas() {
  const schema = useStore((s) => s.schema);
  const selection = useStore((s) => s.selection);
  const theme = useStore((s) => s.theme);
  const starFocus = useStore((s) => s.starFocus);
  const view = schema.view ?? 'atlas';
  const phone = useIsPhone();
  const moveLocked = useStore((s) => s.moveLocked);
  // first time the lock is on in this session: say where to unlock it
  const welcome = useStore((s) => s.welcome);
  const [lockHint, setLockHint] = useState(() => {
    try {
      return sessionStorage.getItem('odbe-lock-hint') !== '1';
    } catch {
      return true;
    }
  });
  const showLockHint = lockHint && moveLocked && !welcome && schema.tables.length > 0 && view !== 'constellation';
  useEffect(() => {
    if (!showLockHint) return;
    try {
      sessionStorage.setItem('odbe-lock-hint', '1');
    } catch {
      /* ignore */
    }
    const t = window.setTimeout(() => setLockHint(false), 9000);
    return () => window.clearTimeout(t);
  }, [showLockHint]);
  const setMoveLocked = (locked: boolean) => {
    useStore.getState().set({ moveLocked: locked });
    useStore.getState().toast(locked ? 'Moving locked: tables and notes stay put' : 'Moving unlocked: drag tables and notes · the lock button locks them again');
    setLockHint(false);
  };
  const [miniOpen, setMiniOpen] = useState(() => {
    try {
      return localStorage.getItem('odbe-minimap') !== 'off';
    } catch {
      return true;
    }
  });
  const toggleMini = () => {
    setMiniOpen(!miniOpen);
    try {
      localStorage.setItem('odbe-minimap', miniOpen ? 'off' : 'on');
    } catch {
      /* ignore */
    }
  };
  // zoom buttons in the corner, the minimap just right of them
  const mini = phone ? { w: 120, h: 90 } : { w: 200, h: 150 };
  const margin = phone ? 8 : 14;
  const CONTROLS_W = 32; // 30px buttons + border
  const zoomDetail = useFlowStore(detailSelector);
  const detail: Detail = view === 'blueprint' ? 'full' : zoomDetail;
  const farZoom = useFlowStore(overviewSelector);
  const overview = view === 'atlas' && farZoom && schema.groups.length > 0;
  const hidden = useHidden();
  const issues = useIssues();
  const diff = useDiff();
  const path = usePath();
  const lens = useLens();
  const rf = useReactFlow();
  const flowStore = useStoreApi();
  if (import.meta.env.DEV) (window as unknown as { __rf: typeof flowStore }).__rf = flowStore;
  const [hover, setHover] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [hoverRegion, setHoverRegion] = useState<string | null>(null);
  const [measured, setMeasured] = useState<Map<string, { width: number; height: number }>>(new Map());

  // ---- constellation positions ----
  const starTarget = useMemo(() => {
    if (view !== 'constellation') return null;
    if (starFocus && schema.tables.some((t) => t.id === starFocus)) return orbitPositions(schema, starFocus).pos;
    return forceLayoutPositions(schema);
    // structure only: card positions don't matter here
  }, [view, starFocus, schema.tables.length, schema.relations.length, schema.groups, schema.tables.map((t) => t.groupId).join()]);
  const [starPos, setStarPos] = useAnimatedPositions(starTarget);
  const orbit = useMemo(() => (view === 'constellation' && starFocus ? orbitPositions(schema, starFocus) : null), [view, starFocus, schema]);

  const issueCount = useMemo(() => {
    const m = new Map<string, { errors: number; warnings: number }>();
    for (const i of issues) {
      if (!i.tableId || i.severity === 'info') continue;
      const c = m.get(i.tableId) ?? { errors: 0, warnings: 0 };
      if (i.severity === 'error') c.errors++;
      else c.warnings++;
      m.set(i.tableId, c);
    }
    return m;
  }, [issues]);

  const flyTo = useCallback(
    (id: string) => {
      const t = useStore.getState().schema.tables.find((x) => x.id === id);
      if (!t) return;
      rf.setCenter(t.x + CARD_W / 2, t.y + cardHeight(t, useStore.getState().schema) / 2, { zoom: 1, duration: 700 });
      useStore.getState().select({ kind: 'table', id });
    },
    [rf],
  );

  // Orthogonal routes for every drawn relation (cards are obstacles, shared corridors become lanes).
  const routes = useMemo(
    () => (view === 'constellation' || overview ? null : routeSchema(schema, detail, hidden)),
    // positions, sizes and links only — selection and the like don't move lines
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, detail, hidden, overview, schema.tables, schema.relations, schema.groups],
  );

  // Overview: one block per group (ungrouped tables stand alone), one line per pair of blocks.
  const bundles = useMemo(() => {
    if (!overview) return null;
    const groupIds = new Set(schema.groups.map((g) => g.id));
    const byId = new Map(schema.tables.map((t) => [t.id, t]));
    const endOf = (tableId: string) => {
      const t = byId.get(tableId);
      return t?.groupId && groupIds.has(t.groupId) ? `region:${t.groupId}` : tableId;
    };
    const pairs = new Map<string, { a: string; b: string; ab: number; ba: number; fks: string[] }>();
    const linksOut = new Map<string, number>();
    for (const r of schema.relations) {
      const a = endOf(r.from.table), b = endOf(r.to.table);
      if (a === b) continue;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const p = pairs.get(key) ?? { a: a < b ? a : b, b: a < b ? b : a, ab: 0, ba: 0, fks: [] };
      if (p.a === a) p.ab++;
      else p.ba++;
      p.fks.push(`${byId.get(r.from.table)?.name} → ${byId.get(r.to.table)?.name}`);
      pairs.set(key, p);
      linksOut.set(a, (linksOut.get(a) ?? 0) + 1);
    }
    return { pairs: [...pairs.values()], linksOut };
  }, [overview, schema.groups, schema.tables, schema.relations]);

  const highlight = useMemo(() => {
    // tables "lit" by hover / selection / path
    const lit = new Set<string>();
    const focusId = hover ?? (selection?.kind === 'table' ? selection.id : null);
    if (focusId) {
      lit.add(focusId);
      for (const r of schema.relations) {
        if (r.from.table === focusId) lit.add(r.to.table);
        if (r.to.table === focusId) lit.add(r.from.table);
      }
    }
    return { lit, focusId };
  }, [hover, selection, schema.relations]);

  const nodes = useMemo<Node[]>(() => {
    const byGroup = new Map(schema.groups.map((g) => [g.id, g]));
    const out: Node[] = [];
    const isFaded = (id: string) => (path?.rels ? !path.tables.has(id) : lens ? !lens.has(id) : false);

    if (view === 'constellation') {
      const adj = adjacency(schema);
      const dist = starFocus ? hopDistances(schema, starFocus) : null;
      if (orbit) {
        const R = (orbit.radii[orbit.radii.length - 1] ?? 0) + 40;
        out.push({ id: '__rings', type: 'rings', position: { x: -R, y: -R }, data: { radii: orbit.radii, unreachable: orbit.unreachable }, draggable: false, selectable: false, zIndex: -1, width: R * 2, height: R * 2 });
      }
      for (const t of schema.tables) {
        const p = starPos?.get(t.id) ?? { x: 0, y: 0 };
        const r = starRadius(t.columns.length, adj.get(t.id)?.length ?? 0);
        const g = t.groupId ? byGroup.get(t.groupId) : undefined;
        out.push({
          id: t.id,
          type: 'star',
          position: { x: p.x - r, y: p.y - r },
          data: {
            table: t,
            r,
            color: t.color ?? g?.color ?? '#a5b4fc',
            faded: isFaded(t.id) || (!!highlight.focusId && (!orbit || !!hover) && !highlight.lit.has(t.id)),
            lit: highlight.lit.has(t.id) && !!highlight.focusId,
            focus: t.id === starFocus,
            ring: dist?.get(t.id),
            diff: diff?.tableStatus.get(t.id),
          },
          selected: selection?.kind === 'table' && selection.id === t.id,
          // no width/height: React Flow only measures handles of nodes it sizes itself
          measured: measured.get(t.id),
        });
      }
      return out;
    }

    // regions (Atlas: tinted islands; Blueprint: dashed frames)
    for (const g of schema.groups) {
      const members = schema.tables.filter((t) => t.groupId === g.id);
      if (!members.length) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const t of members) {
        const h = measured.get(t.id)?.height ?? cardHeight(t, schema, detail);
        x0 = Math.min(x0, t.x);
        y0 = Math.min(y0, t.y);
        x1 = Math.max(x1, t.x + CARD_W);
        y1 = Math.max(y1, t.y + h);
      }
      const pad = 28;
      const top = detail === 'compact' ? 64 : 56;
      out.push({
        id: `region:${g.id}`,
        type: 'region',
        position: { x: x0 - pad, y: y0 - top },
        data: {
          name: g.name,
          color: g.color,
          count: members.length,
          locked: g.locked,
          width: x1 - x0 + pad * 2,
          height: y1 - y0 + top + pad,
          blueprint: view === 'blueprint',
          faded: members.every((m) => isFaded(m.id)),
          overview,
          links: bundles?.linksOut.get(`region:${g.id}`),
          dim: !!hoverRegion && hoverRegion !== `region:${g.id}` && !bundles?.pairs.some((p) => (p.a === hoverRegion && p.b === `region:${g.id}`) || (p.b === hoverRegion && p.a === `region:${g.id}`)),
        },
        zIndex: -1,
        draggable: !g.locked,
        selected: selection?.kind === 'group' && selection.id === g.id,
        // size through style only: React Flow measures handles just for nodes it sizes itself
        style: { width: x1 - x0 + pad * 2, height: y1 - y0 + top + pad },
        measured: measured.get(`region:${g.id}`),
      });
    }

    const fkCols = new Set<string>();
    for (const r of schema.relations) r.from.columns.forEach((c) => fkCols.add(c));
    const enumNames = new Set(schema.enums.map((e) => e.name));
    const portalsByTable = new Map<string, Map<string, { name: string; id: string }>>();
    for (const r of schema.relations) {
      if (!hidden.has(r.id)) continue;
      const target = schema.tables.find((t) => t.id === r.to.table);
      if (!target) continue;
      if (!portalsByTable.has(r.from.table)) portalsByTable.set(r.from.table, new Map());
      portalsByTable.get(r.from.table)!.set(r.from.columns[0], { name: target.name, id: target.id });
    }
    const removedCols = new Map<string, number>();
    if (diff) for (const d of diff.tables) if (d.current) removedCols.set(d.current.id, d.columns.filter((c) => c.kind === 'removed').length);

    for (const t of schema.tables) {
      const g = t.groupId ? byGroup.get(t.groupId) : undefined;
      out.push({
        id: t.id,
        type: 'table',
        position: { x: t.x, y: t.y },
        data: {
          table: t,
          schema,
          detail,
          groupColor: g?.color,
          fkCols,
          portals: portalsByTable.get(t.id) ?? new Map(),
          enumNames,
          faded: isFaded(t.id),
          lit: !!path?.rels && path.tables.has(t.id),
          diff: diff?.tableStatus.get(t.id),
          colDiff: diff?.columnStatus,
          removedCols: removedCols.get(t.id),
          issues: issueCount.get(t.id),
          selectedColumn: selection?.kind === 'table' && selection.id === t.id ? selection.columnId : undefined,
          onPortal: flyTo,
        },
        selected: selection?.kind === 'table' && selection.id === t.id,
        draggable: !t.locked,
        hidden: overview && !!g,
        measured: measured.get(t.id),
      });
    }
    for (const n of schema.notes) {
      out.push({
        id: `note:${n.id}`,
        type: 'note',
        position: { x: n.x, y: n.y },
        data: { text: n.text, color: n.color, faded: !!(path?.rels || lens) && !(n.attachedTo && !isFaded(n.attachedTo)) },
        style: { width: n.w, height: n.h },
        measured: measured.get(`note:${n.id}`),
        selected: selection?.kind === 'note' && selection.id === n.id,
        zIndex: 5,
      });
    }
    return out;
  }, [schema, view, detail, selection, hidden, diff, issueCount, path, lens, measured, flyTo, starPos, starFocus, orbit, highlight, overview, bundles, hoverRegion]);
  // the move lock overrides each node's own draggable flag (which only reflects per-table locks)
  const shownNodes = useMemo(() => (moveLocked && view !== 'constellation' ? nodes.map((n) => (n.draggable === false ? n : { ...n, draggable: false })) : nodes), [nodes, moveLocked, view]);

  const edges = useMemo<Edge[]>(() => {
    const byId = new Map(schema.tables.map((t) => [t.id, t]));
    const byGroup = new Map(schema.groups.map((g) => [g.id, g]));
    const out: Edge[] = [];
    const isFaded = (a: string, b: string) => (path?.rels ? false : lens ? !lens.has(a) || !lens.has(b) : false);

    if (view === 'constellation') {
      const seen = new Set<string>();
      for (const r of schema.relations) {
        if (r.from.table === r.to.table) continue;
        const key = [r.from.table, r.to.table].sort().join('|');
        const onPath = !!path?.relIds.has(r.id);
        if (seen.has(key) && !onPath) continue;
        seen.add(key);
        const from = byId.get(r.from.table);
        const g = from?.groupId ? byGroup.get(from.groupId) : undefined;
        const lit = !!highlight.focusId && (r.from.table === highlight.focusId || r.to.table === highlight.focusId);
        out.push({
          id: r.id,
          source: r.from.table,
          target: r.to.table,
          sourceHandle: 'c',
          targetHandle: 'c',
          type: 'arc',
          data: { lit, faded: (path?.rels ? !onPath : isFaded(r.from.table, r.to.table)) || (!!highlight.focusId && (!starFocus || !!hover) && !lit), color: g?.color, path: onPath },
          selected: selection?.kind === 'relation' && selection.id === r.id,
        });
      }
      return out;
    }

    if (bundles) {
      const frame = (end: string) => {
        if (end.startsWith('region:')) return regionFrame(schema, end.slice(7), 'compact')!;
        const t = byId.get(end)!;
        return { x: t.x, y: t.y, w: CARD_W, h: cardHeight(t, schema, 'compact') };
      };
      const colorOf = (end: string) => (end.startsWith('region:') ? byGroup.get(end.slice(7))?.color : undefined);
      for (const p of bundles.pairs) {
        const lit = !!hoverRegion && (p.a === hoverRegion || p.b === hoverRegion);
        out.push({
          id: `bundle:${p.a}|${p.b}`,
          source: p.a,
          target: p.b,
          sourceHandle: p.a.startsWith('region:') ? 'c' : 'T-R',
          targetHandle: p.b.startsWith('region:') ? 'c' : 'T-L',
          type: 'bundle',
          selectable: false,
          // under the blocks (a line passing behind a group doesn't cut through it) unless highlighted
          zIndex: lit ? 2 : -2,
          data: { a: frame(p.a), b: frame(p.b), ab: p.ab, ba: p.ba, title: p.fks.join('\n'), color: colorOf(p.ab >= p.ba ? p.a : p.b), lit, dim: !!hoverRegion && !lit },
        });
      }
      return out;
    }

    for (const r of schema.relations) {
      if (hidden.has(r.id)) continue;
      const f = byId.get(r.from.table);
      const t = byId.get(r.to.table);
      if (!f || !t) continue;
      const fc = f.columns.find((c) => c.id === r.from.columns[0]);
      const tc = t.columns.find((c) => c.id === r.to.columns[0]);
      if (!fc || !tc) continue;
      const route = routes?.get(r.id);
      const dx = t.x + CARD_W / 2 - (f.x + CARD_W / 2);
      const fs = route?.srcSide ?? (dx >= 0 ? 'R' : 'L');
      const ts = route?.dstSide ?? (dx >= 0 ? 'L' : 'R');
      const compact = detail === 'compact';
      const onPath = !!path?.relIds.has(r.id);
      const isHover = hoverEdge === r.id;
      const lit = isHover || (!!highlight.focusId && (r.from.table === highlight.focusId || r.to.table === highlight.focusId));
      const focused = !!highlight.focusId || !!hoverEdge;
      const g = f.groupId ? byGroup.get(f.groupId) : undefined;
      out.push({
        id: r.id,
        source: f.id,
        target: t.id,
        sourceHandle: compact ? `T-${fs}` : `${fc.id}-${fs}`,
        targetHandle: compact ? `T-${ts}` : `${tc.id}-${ts}`,
        type: 'relation',
        selected: selection?.kind === 'relation' && selection.id === r.id,
        data: {
          label: `${f.name}.${fc.name} → ${t.name}.${tc.name}`,
          onDelete: r.onDelete,
          childUnique: fc.unique || (fc.pk && f.columns.filter((c) => c.pk).length === 1),
          childNullable: r.from.columns.some((id) => f.columns.find((c) => c.id === id)?.nullable),
          faded: path?.rels ? !onPath : isFaded(f.id, t.id),
          dim: focused && !lit && !path?.rels,
          lit: lit && !path?.rels,
          hover: isHover,
          points: route?.points,
          path: onPath,
          diff: diff?.relationStatus.get(r.id) === 'added' ? 'added' : undefined,
          color: view === 'atlas' ? g?.color : undefined,
          blueprint: view === 'blueprint',
        },
        zIndex: onPath || lit ? 2 : 0,
      });
    }
    for (const n of schema.notes) {
      if (!n.attachedTo || !byId.has(n.attachedTo)) continue;
      const t = byId.get(n.attachedTo)!;
      const side = t.x + CARD_W / 2 < n.x ? 'T-R' : 'T-L';
      out.push({ id: `nl:${n.id}`, source: `note:${n.id}`, sourceHandle: 'n', target: n.attachedTo, targetHandle: side, type: 'notelink', selectable: false, focusable: false });
    }
    return out;
  }, [schema, view, hidden, path, lens, selection, detail, diff, highlight, routes, hoverEdge, bundles, hoverRegion]);

  // Handles move without the card changing size (detail level, view, column edits),
  // which React Flow's resize observer can't see — re-measure them explicitly.
  const updateNodeInternals = useUpdateNodeInternals();
  const handleShape = `${view}|${detail}|${overview}|${schema.groups.map((g) => g.id).join(',')}|${schema.tables.map((t) => `${t.id}:${t.columns.map((c) => c.id).join(',')}`).join('|')}`;
  useEffect(() => {
    const ids = [...schema.tables.map((t) => t.id), ...schema.groups.map((g) => `region:${g.id}`)];
    const raf = requestAnimationFrame(() => updateNodeInternals(ids));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleShape, updateNodeInternals]);

  // Constellation positions have nothing in common with card positions: reframe on entry/exit and after orbits settle.
  const isStars = view === 'constellation';
  const firstFrame = useRef(true);
  useEffect(() => {
    if (firstFrame.current) {
      firstFrame.current = false;
      return;
    }
    const t = window.setTimeout(() => rf.fitView({ padding: 0.12, duration: 500 }), starFocus !== undefined && isStars ? 760 : 80);
    return () => window.clearTimeout(t);
  }, [isStars, starFocus, rf]);

  // ---- interactions ----
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const st = useStore.getState();
      const dims = changes.filter((c) => c.type === 'dimensions' && c.dimensions);
      if (dims.length) {
        setMeasured((prev) => {
          const next = new Map(prev);
          for (const c of dims) if (c.type === 'dimensions' && c.dimensions) next.set(c.id, c.dimensions);
          return next;
        });
      }
      const moves = changes.filter((c) => c.type === 'position' && c.position);
      if (moves.length) {
        if (view === 'constellation') {
          for (const c of moves) {
            if (c.type !== 'position' || !c.position) continue;
            const n = nodes.find((x) => x.id === c.id);
            const r = ((n?.data as { r?: number })?.r ?? 0) as number;
            setStarPos(c.id, { x: c.position.x + r, y: c.position.y + r });
          }
          return;
        }
        st.setTransient((d) => {
          for (const c of moves) {
            if (c.type !== 'position' || !c.position) continue;
            if (c.id.startsWith('region:')) {
              const gid = c.id.slice(7);
              const region = nodes.find((n) => n.id === c.id);
              if (!region) continue;
              const dx = c.position.x - region.position.x;
              const dy = c.position.y - region.position.y;
              for (const t of d.tables) if (t.groupId === gid && !t.locked) {
                t.x = Math.round(t.x + dx);
                t.y = Math.round(t.y + dy);
              }
            } else if (c.id.startsWith('note:')) {
              const note = d.notes.find((n) => `note:${n.id}` === c.id);
              if (note) {
                note.x = Math.round(c.position.x);
                note.y = Math.round(c.position.y);
              }
            } else {
              const t = d.tables.find((x) => x.id === c.id);
              if (t) {
                t.x = Math.round(c.position.x);
                t.y = Math.round(c.position.y);
              }
            }
          }
        });
      }
    },
    [nodes, view, setStarPos],
  );

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return;
    const st = useStore.getState();
    const s = st.schema;
    const colId = (h: string) => h.replace(/-[LR]$/, '');
    let from = { table: c.source, col: colId(c.sourceHandle) };
    let to = { table: c.target, col: colId(c.targetHandle) };
    const col = (t: string, id: string) => s.tables.find((x) => x.id === t)?.columns.find((x) => x.id === id);
    const fc = col(from.table, from.col);
    const tc = col(to.table, to.col);
    if (!fc || !tc) return;
    // the referenced side should be the key; flip if the user dragged from the key
    const isKey = (x: typeof fc) => x.pk || x.unique;
    if (isKey(fc) && !isKey(tc)) [from, to] = [to, from];
    if (s.relations.some((r) => r.from.columns[0] === from.col && r.to.columns[0] === to.col)) return;
    st.commit((d: Schema) => {
      d.relations.push({ id: uid(), from: { table: from.table, columns: [from.col] }, to: { table: to.table, columns: [to.col] }, onDelete: 'NO ACTION', onUpdate: 'NO ACTION' });
    });
    const f2 = col(from.table, from.col)!;
    const t2 = col(to.table, to.col)!;
    if (canonicalType(f2.type) !== canonicalType(t2.type) && !isSerial(f2.type)) st.toast(`Linked ${f2.name} → ${t2.name}, but types differ (${f2.type} vs ${t2.type})`, 'warn');
  }, []);

  const bg = view === 'blueprint' ? BackgroundVariant.Lines : BackgroundVariant.Dots;

  return (
    <div className={`canvas view-${view} detail-${detail}`} data-theme-canvas={theme}>
      <ReactFlow
        proOptions={{ hideAttribution: true }} // React Flow (MIT) is credited in the README
        nodes={shownNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={() => useStore.getState().checkpoint()}
        onNodeDragStop={() => useStore.setState((s) => ({ revision: s.revision + 1 }))}
        onNodeClick={(_, n) => {
          const st = useStore.getState();
          if (n.id.startsWith('region:')) st.select({ kind: 'group', id: n.id.slice(7) });
          else if (n.id.startsWith('note:')) st.select({ kind: 'note', id: n.id.slice(5) });
          else if (n.type === 'table' || n.type === 'star') {
            const target = (_.target as HTMLElement).closest('[data-col]') as HTMLElement | null;
            st.select({ kind: 'table', id: n.id, columnId: target?.dataset.col });
          }
        }}
        onNodeDoubleClick={(_, n) => {
          if (n.type === 'star') useStore.getState().set({ starFocus: n.id });
          if (n.type === 'region' && overview) {
            const f = regionFrame(useStore.getState().schema, n.id.slice(7), 'compact');
            if (f) rf.fitBounds({ x: f.x, y: f.y, width: f.w, height: f.h }, { padding: 0.15, duration: 600 });
          }
        }}
        onEdgeClick={(_, e) => !e.id.startsWith('nl:') && useStore.getState().select({ kind: 'relation', id: e.id })}
        onPaneClick={() => useStore.getState().select(null)}
        onNodeMouseEnter={(_, n) => {
          if (n.type === 'table' || n.type === 'star') setHover(n.id);
          else if (n.type === 'region' && overview) setHoverRegion(n.id);
        }}
        onNodeMouseLeave={() => {
          setHover(null);
          setHoverRegion(null);
        }}
        onEdgeMouseEnter={(_, e) => e.type === 'relation' && setHoverEdge(e.id)}
        onEdgeMouseLeave={() => setHoverEdge(null)}
        onConnect={onConnect}
        onDoubleClick={(e) => {
          if (view === 'constellation') return;
          if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return;
          const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          useStore.getState().addTable({ x: p.x - CARD_W / 2, y: p.y - 24 });
        }}
        connectionMode={ConnectionMode.Loose}
        zoomOnDoubleClick={false}
        minZoom={0.08}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesConnectable={view !== 'constellation'}
        elevateEdgesOnSelect
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        onlyRenderVisibleElements={false}
      >
        <Background variant={bg} gap={view === 'blueprint' ? 24 : 22} size={view === 'blueprint' ? 1 : 1.3} className="bg" />
        {view === 'blueprint' && <Background id="major" variant={BackgroundVariant.Lines} gap={120} className="bg-major" />}
        <Controls showInteractive={false} position="bottom-left" className="controls" style={{ margin }}>
          {view !== 'constellation' && (
            <ControlButton
              onClick={() => setMoveLocked(!moveLocked)}
              title={moveLocked ? 'Moving is locked: click to move tables and notes' : 'Moving is unlocked: click to lock tables and notes in place'}
              aria-label={moveLocked ? 'Unlock moving' : 'Lock moving'}
              className={`move-lock ${moveLocked ? 'is-locked' : ''}`}
            >
              {moveLocked ? <Lock size={14} /> : <LockOpen size={14} />}
            </ControlButton>
          )}
          <ControlButton onClick={toggleMini} title={miniOpen ? 'Hide the minimap' : 'Show the minimap'} aria-label={miniOpen ? 'Hide the minimap' : 'Show the minimap'} className={miniOpen ? 'is-on' : ''}>
            <MapIcon size={14} />
          </ControlButton>
        </Controls>
        {miniOpen && (
          <MiniMap
            position="bottom-left"
            style={{ width: mini.w, height: mini.h, margin, marginLeft: CONTROLS_W + margin * 2 }}
            pannable
            zoomable
            nodeColor={(n) => {
              if (n.type === 'region') return (n.data as { overview?: boolean; color?: string }).overview ? (n.data as { color: string }).color : 'transparent';
              if (n.type === 'rings') return 'transparent';
              const d = n.data as { groupColor?: string; color?: string; table?: { color?: string } };
              return d.table?.color ?? d.groupColor ?? d.color ?? '#8892b0';
            }}
            nodeStrokeWidth={0}
            maskColor="var(--minimap-mask)"
          />
        )}
      </ReactFlow>
      {showLockHint && (
        <div className="lock-hint" role="status">
          <Lock size={14} />
          <span>
            Tables are locked in place. Use the <b>lock button</b> at the bottom left to move them.
          </span>
          <button className="icon-btn" title="Got it" onClick={() => setLockHint(false)}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
