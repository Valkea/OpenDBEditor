// Schema health checks. Each issue can carry a quick fix that mutates an immer draft.

import { uid } from '../model/ids';
import type { Schema, Table } from '../model/types';
import { baseTypeName, canonicalType, extensionForType, isBuiltinType, RESERVED } from '../sql/pg';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  id: string;
  rule: string;
  severity: Severity;
  message: string;
  tableId?: string;
  columnId?: string;
  fix?: { label: string; apply: (draft: Schema) => void };
}

export const RULE_LABELS: Record<string, string> = {
  'no-columns': 'Empty tables',
  'duplicate-name': 'Duplicate names',
  'unknown-type': 'Unknown types',
  'missing-extension': 'Missing extensions',
  'fk-target-not-unique': 'FK targets not unique',
  'fk-type-mismatch': 'FK type mismatches',
  'fk-set-null-not-null': 'SET NULL on NOT NULL',
  'no-primary-key': 'Tables without primary key',
  'fk-missing-index': 'FK columns without index',
  'redundant-index': 'Redundant indexes',
  'unknown-index-column': 'Index on unknown column',
  'duplicate-enum-value': 'Duplicate enum values',
  'double-escaped-comment': 'Double-escaped comments',
  'mixed-case': 'Mixed-case identifiers',
  'reserved-word': 'Reserved words',
  'unused-enum': 'Unused enums',
  'orphan-table': 'Unconnected tables',
};

const pkCols = (t: Table) => t.columns.filter((c) => c.pk).map((c) => c.name);

/** Leading-column sets that an index-like structure provides. */
function indexPrefixes(t: Table): { cols: string[]; unique: boolean; name: string; plain: boolean }[] {
  const out: { cols: string[]; unique: boolean; name: string; plain: boolean }[] = [];
  const pk = pkCols(t);
  if (pk.length) out.push({ cols: pk, unique: true, name: 'PRIMARY KEY', plain: true });
  for (const c of t.columns) if (c.unique && !(c.pk && pk.length === 1)) out.push({ cols: [c.name], unique: true, name: `UNIQUE(${c.name})`, plain: true });
  for (const k of t.constraints) if (k.kind === 'unique' && k.columns) out.push({ cols: k.columns, unique: true, name: k.name ?? `UNIQUE(${k.columns.join(', ')})`, plain: true });
  for (const i of t.indexes) out.push({ cols: i.columns, unique: i.unique, name: i.name, plain: !i.where && (!i.method || i.method === 'btree') });
  return out;
}

function covers(prefix: string[], fk: string[]): boolean {
  if (prefix.length < fk.length) return false;
  const lead = new Set(prefix.slice(0, fk.length));
  return fk.every((c) => lead.has(c));
}

export function lintSchema(schema: Schema): Issue[] {
  const issues: Issue[] = [];
  const add = (i: Omit<Issue, 'id'>) => issues.push({ ...i, id: `${i.rule}:${i.tableId ?? ''}:${i.columnId ?? ''}:${issues.length}` });
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const enumNames = new Set(schema.enums.map((e) => e.name));
  const extNames = new Set(schema.extensions.map((e) => e.name));
  const usedEnums = new Set<string>();
  const connected = new Set<string>();
  for (const r of schema.relations) {
    connected.add(r.from.table);
    connected.add(r.to.table);
  }

  const seenTables = new Map<string, string>();
  for (const t of schema.tables) {
    const k = `${t.schema ?? ''}.${t.name}`;
    if (seenTables.has(k)) add({ rule: 'duplicate-name', severity: 'error', message: `Table name "${t.name}" is used twice`, tableId: t.id });
    seenTables.set(k, t.id);

    if (!t.columns.length) add({ rule: 'no-columns', severity: 'error', message: `${t.name} has no columns`, tableId: t.id });
    else if (!t.columns.some((c) => c.pk))
      add({ rule: 'no-primary-key', severity: 'warning', message: `${t.name} has no primary key`, tableId: t.id });

    const seenCols = new Set<string>();
    for (const c of t.columns) {
      if (seenCols.has(c.name)) add({ rule: 'duplicate-name', severity: 'error', message: `${t.name}.${c.name} is defined twice`, tableId: t.id, columnId: c.id });
      seenCols.add(c.name);
      const base = baseTypeName(c.type);
      if (enumNames.has(base)) usedEnums.add(base);
      else if (!isBuiltinType(base)) {
        const ext = extensionForType(base);
        if (ext && !extNames.has(ext.name)) {
          add({
            rule: 'missing-extension',
            severity: 'error',
            message: `${t.name}.${c.name} uses ${base}, which needs the ${ext.label} extension`,
            tableId: t.id,
            columnId: c.id,
            fix: { label: `Enable ${ext.label}`, apply: (d) => void (d.extensions.some((e) => e.name === ext.name) || d.extensions.push({ name: ext.name })) },
          });
        } else if (!ext) {
          add({ rule: 'unknown-type', severity: 'warning', message: `${t.name}.${c.name}: unknown type "${base}"`, tableId: t.id, columnId: c.id });
        }
      }
      if (c.comment?.includes("''")) {
        add({
          rule: 'double-escaped-comment',
          severity: 'info',
          message: `${t.name}.${c.name} comment contains '' — probably escaped twice by an export`,
          tableId: t.id,
          columnId: c.id,
          fix: {
            label: "Replace '' with '",
            apply: (d) => {
              const col = d.tables.find((x) => x.id === t.id)?.columns.find((x) => x.id === c.id);
              if (col?.comment) col.comment = col.comment.replace(/''/g, "'");
            },
          },
        });
      }
      if (/[A-Z]/.test(c.name)) {
        add({
          rule: 'mixed-case',
          severity: 'info',
          message: `${t.name}.${c.name} has upper-case letters, so it must always be double-quoted`,
          tableId: t.id,
          columnId: c.id,
          fix: {
            label: `Rename to ${c.name.toLowerCase()}`,
            apply: (d) => {
              const tt = d.tables.find((x) => x.id === t.id);
              const col = tt?.columns.find((x) => x.id === c.id);
              if (!tt || !col) return;
              const old = col.name;
              col.name = old.toLowerCase();
              for (const i of tt.indexes) i.columns = i.columns.map((x) => (x === old ? col.name : x));
              for (const k of tt.constraints) if (k.columns) k.columns = k.columns.map((x) => (x === old ? col.name : x));
            },
          },
        });
      }
      if (RESERVED.has(c.name.toLowerCase()))
        add({ rule: 'reserved-word', severity: 'info', message: `${t.name}.${c.name} is a reserved word in PostgreSQL`, tableId: t.id, columnId: c.id });
    }
    if (RESERVED.has(t.name.toLowerCase())) add({ rule: 'reserved-word', severity: 'info', message: `Table name ${t.name} is a reserved word`, tableId: t.id });
    if (t.comment?.includes("''")) {
      add({
        rule: 'double-escaped-comment',
        severity: 'info',
        message: `${t.name} comment contains '' — probably escaped twice by an export`,
        tableId: t.id,
        fix: {
          label: "Replace '' with '",
          apply: (d) => {
            const tt = d.tables.find((x) => x.id === t.id);
            if (tt?.comment) tt.comment = tt.comment.replace(/''/g, "'");
          },
        },
      });
    }

    // indexes
    const prefixes = indexPrefixes(t);
    const colNames = new Set(t.columns.map((c) => c.name));
    for (const i of t.indexes) {
      for (const ic of i.columns) {
        if (/^[A-Za-z_][\w$]*$/.test(ic) && !colNames.has(ic))
          add({ rule: 'unknown-index-column', severity: 'error', message: `Index ${i.name} references unknown column ${ic}`, tableId: t.id });
      }
      if (i.unique || i.where || (i.method && i.method !== 'btree')) continue;
      const better = prefixes.find((p) => p.name !== i.name && p.plain && covers(p.cols, i.columns) && (p.cols.length > i.columns.length || p.unique));
      if (better) {
        add({
          rule: 'redundant-index',
          severity: 'info',
          message: `${i.name} on ${t.name}(${i.columns.join(', ')}) is already covered by ${better.name}`,
          tableId: t.id,
          fix: {
            label: `Drop ${i.name}`,
            apply: (d) => {
              const tt = d.tables.find((x) => x.id === t.id);
              if (tt) tt.indexes = tt.indexes.filter((x) => x.id !== i.id);
            },
          },
        });
      }
    }

    if (!connected.has(t.id) && schema.tables.length > 1)
      add({ rule: 'orphan-table', severity: 'info', message: `${t.name} has no relationships`, tableId: t.id });
  }

  for (const r of schema.relations) {
    const from = byId.get(r.from.table);
    const to = byId.get(r.to.table);
    if (!from || !to) continue;
    const fcols = r.from.columns.map((id) => from.columns.find((c) => c.id === id)!).filter(Boolean);
    const tcols = r.to.columns.map((id) => to.columns.find((c) => c.id === id)!).filter(Boolean);
    const label = `${from.name}(${fcols.map((c) => c.name).join(', ')}) → ${to.name}`;

    const tnames = tcols.map((c) => c.name);
    const targetUnique = indexPrefixes(to).some((p) => p.unique && p.plain && p.cols.length === tnames.length && covers(p.cols, tnames));
    if (!targetUnique)
      add({ rule: 'fk-target-not-unique', severity: 'error', message: `${label}: referenced column(s) must be a primary key or unique`, tableId: from.id });

    fcols.forEach((fc, i) => {
      const tc = tcols[i];
      if (!tc) return;
      if (canonicalType(fc.type) !== canonicalType(tc.type)) {
        add({
          rule: 'fk-type-mismatch',
          severity: 'warning',
          message: `${from.name}.${fc.name} is ${fc.type} but ${to.name}.${tc.name} is ${tc.type}`,
          tableId: from.id,
          columnId: fc.id,
        });
      }
    });
    if (r.onDelete === 'SET NULL' && fcols.some((c) => !c.nullable))
      add({ rule: 'fk-set-null-not-null', severity: 'error', message: `${label}: ON DELETE SET NULL on a NOT NULL column`, tableId: from.id });

    const fnames = fcols.map((c) => c.name);
    if (fnames.length && !indexPrefixes(from).some((p) => p.plain && covers(p.cols, fnames))) {
      add({
        rule: 'fk-missing-index',
        severity: 'warning',
        message: `${label}: no index starts with ${fnames.join(', ')} — joins and ON DELETE checks scan the table`,
        tableId: from.id,
        columnId: fcols[0].id,
        fix: {
          label: 'Create index',
          apply: (d) => {
            const tt = d.tables.find((x) => x.id === from.id);
            if (!tt) return;
            const name = `idx_${tt.name}_${fnames.join('_')}`.toLowerCase();
            if (!tt.indexes.some((x) => x.name === name)) tt.indexes.push({ id: uid(), name, columns: [...fnames], unique: false });
          },
        },
      });
    }
  }

  for (const e of schema.enums) {
    if (new Set(e.values).size !== e.values.length) add({ rule: 'duplicate-enum-value', severity: 'error', message: `Enum ${e.name} has duplicate values` });
    if (/[A-Z]/.test(e.name)) {
      add({
        rule: 'mixed-case',
        severity: 'info',
        message: `Enum ${e.name} has upper-case letters, so every reference must be double-quoted`,
        fix: {
          label: `Rename to ${e.name.toLowerCase()}`,
          apply: (d) => {
            const en = d.enums.find((x) => x.id === e.id);
            if (!en) return;
            const old = en.name;
            en.name = old.toLowerCase();
            for (const t of d.tables) for (const c of t.columns) if (baseTypeName(c.type) === old) c.type = c.type.replace(old, en.name);
          },
        },
      });
    }
    if (!usedEnums.has(e.name)) {
      add({
        rule: 'unused-enum',
        severity: 'info',
        message: `Enum ${e.name} is not used by any column`,
        fix: { label: 'Delete enum', apply: (d) => void (d.enums = d.enums.filter((x) => x.id !== e.id)) },
      });
    }
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
