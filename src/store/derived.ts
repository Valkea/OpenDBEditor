// Memoised views over the store that several components share.

import { useMemo } from 'react';
import { diffSchemas } from '../analysis/diff';
import { hopDistances, shortestPath } from '../analysis/graph';
import { lintSchema } from '../analysis/lint';
import { hiddenRelations, useStore } from './store';

export function useIssues() {
  const schema = useStore((s) => s.schema);
  return useMemo(() => lintSchema(schema), [schema]);
}

export function useDiff() {
  const schema = useStore((s) => s.schema);
  const base = useStore((s) => s.diffBase);
  return useMemo(() => (base ? diffSchemas(base.schema, schema) : null), [schema, base]);
}

export function useHidden() {
  const schema = useStore((s) => s.schema);
  const portals = useStore((s) => s.portals);
  const threshold = useStore((s) => s.hubThreshold);
  const view = schema.view ?? 'atlas';
  return useMemo(() => (view === 'atlas' ? hiddenRelations(schema, portals, threshold) : new Set<string>()), [schema, portals, threshold, view]);
}

export function usePath() {
  const schema = useStore((s) => s.schema);
  const { a, b } = useStore((s) => s.path);
  return useMemo(() => {
    if (!a || !b) return null;
    const rels = shortestPath(schema, a, b);
    if (!rels) return { rels: null, tables: new Set<string>(), relIds: new Set<string>() };
    const tables = new Set<string>([a, b]);
    for (const r of rels) {
      tables.add(r.from.table);
      tables.add(r.to.table);
    }
    return { rels, tables, relIds: new Set(rels.map((r) => r.id)) };
  }, [schema, a, b]);
}

/** Tables visible under the focus lens, centred on the selected table or, with none, the hovered one (null = lens off). */
export function useLens(hover: string | null) {
  const schema = useStore((s) => s.schema);
  const focus = useStore((s) => s.focus);
  const sel = useStore((s) => s.selection);
  const center = sel?.kind === 'table' ? sel.id : hover;
  return useMemo(() => {
    if (!focus.enabled || !center) return null;
    const dist = hopDistances(schema, center);
    return new Set([...dist].filter(([, d]) => d <= focus.hops).map(([id]) => id));
  }, [schema, focus, center]);
}
