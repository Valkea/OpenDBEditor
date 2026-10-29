// Structural diff between a base schema (e.g. v14) and the current one (v15),
// plus the ALTER script that migrates base → current.

import type { Column, EnumType, Index, Relation, Schema, Table } from '../model/types';
import { enumDDL, formatType, indexDDL, tableDDL } from '../sql/generator';
import { qualified, quoteIdent, quoteLiteral } from '../sql/pg';

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface ColumnChange {
  name: string;
  kind: ChangeKind;
  details: string[];
  current?: Column;
  base?: Column;
}

export interface TableDiff {
  name: string;
  kind: ChangeKind;
  current?: Table;
  base?: Table;
  columns: ColumnChange[];
  indexesAdded: Index[];
  indexesRemoved: Index[];
  commentChanged: boolean;
}

export interface SchemaDiff {
  tables: TableDiff[];
  enums: { name: string; kind: ChangeKind; added: string[]; removed: string[]; current?: EnumType; base?: EnumType }[];
  extensionsAdded: string[];
  extensionsRemoved: string[];
  relationsAdded: { sig: string; rel: Relation }[];
  relationsRemoved: { sig: string; rel: Relation }[];
  /** current table id → kind (for canvas overlay). */
  tableStatus: Map<string, ChangeKind>;
  /** current column id → kind. */
  columnStatus: Map<string, ChangeKind>;
  /** current relation id → added. */
  relationStatus: Map<string, ChangeKind>;
  count: number;
}

const tkey = (t: Table) => `${t.schema ?? ''}.${t.name}`;

export function relSignature(s: Schema, r: Relation): string {
  const f = s.tables.find((t) => t.id === r.from.table);
  const t = s.tables.find((x) => x.id === r.to.table);
  const cn = (tb: Table | undefined, ids: string[]) => ids.map((id) => tb?.columns.find((c) => c.id === id)?.name ?? '?').join(',');
  return `${f?.name}(${cn(f, r.from.columns)}) → ${t?.name}(${cn(t, r.to.columns)})`;
}

function columnDetails(a: Column, b: Column): string[] {
  const d: string[] = [];
  if (a.type !== b.type) d.push(`type ${a.type} → ${b.type}`);
  if (a.nullable !== b.nullable) d.push(b.nullable ? 'now nullable' : 'now NOT NULL');
  if ((a.default ?? '') !== (b.default ?? '')) d.push(`default ${a.default ?? '∅'} → ${b.default ?? '∅'}`);
  if (a.unique !== b.unique) d.push(b.unique ? 'now UNIQUE' : 'no longer UNIQUE');
  if (a.pk !== b.pk) d.push(b.pk ? 'joined PK' : 'left PK');
  if ((a.check ?? '') !== (b.check ?? '')) d.push('CHECK changed');
  if ((a.comment ?? '') !== (b.comment ?? '')) d.push('comment changed');
  return d;
}

const idxSig = (i: Index) => `${i.unique}|${i.method ?? ''}|${i.columns.join(',')}|${i.where ?? ''}`;

export function diffSchemas(base: Schema, current: Schema): SchemaDiff {
  const out: SchemaDiff = {
    tables: [],
    enums: [],
    extensionsAdded: current.extensions.filter((e) => !base.extensions.some((b) => b.name === e.name)).map((e) => e.name),
    extensionsRemoved: base.extensions.filter((e) => !current.extensions.some((b) => b.name === e.name)).map((e) => e.name),
    relationsAdded: [],
    relationsRemoved: [],
    tableStatus: new Map(),
    columnStatus: new Map(),
    relationStatus: new Map(),
    count: 0,
  };
  const baseTables = new Map(base.tables.map((t) => [tkey(t), t]));
  const curTables = new Map(current.tables.map((t) => [tkey(t), t]));

  for (const t of current.tables) {
    const b = baseTables.get(tkey(t));
    if (!b) {
      out.tables.push({ name: t.name, kind: 'added', current: t, columns: [], indexesAdded: [], indexesRemoved: [], commentChanged: false });
      out.tableStatus.set(t.id, 'added');
      continue;
    }
    const columns: ColumnChange[] = [];
    for (const c of t.columns) {
      const bc = b.columns.find((x) => x.name === c.name);
      if (!bc) {
        columns.push({ name: c.name, kind: 'added', details: [], current: c });
        out.columnStatus.set(c.id, 'added');
      } else {
        const details = columnDetails(bc, c);
        if (details.length) {
          columns.push({ name: c.name, kind: 'changed', details, current: c, base: bc });
          out.columnStatus.set(c.id, 'changed');
        }
      }
    }
    for (const bc of b.columns) if (!t.columns.some((c) => c.name === bc.name)) columns.push({ name: bc.name, kind: 'removed', details: [], base: bc });
    const bIdx = new Map(b.indexes.map((i) => [i.name, i]));
    const cIdx = new Map(t.indexes.map((i) => [i.name, i]));
    const indexesAdded = t.indexes.filter((i) => !bIdx.has(i.name) || idxSig(bIdx.get(i.name)!) !== idxSig(i));
    const indexesRemoved = b.indexes.filter((i) => !cIdx.has(i.name) || idxSig(cIdx.get(i.name)!) !== idxSig(i));
    const commentChanged = (t.comment ?? '') !== (b.comment ?? '');
    if (columns.length || indexesAdded.length || indexesRemoved.length || commentChanged) {
      out.tables.push({ name: t.name, kind: 'changed', current: t, base: b, columns, indexesAdded, indexesRemoved, commentChanged });
      out.tableStatus.set(t.id, 'changed');
    }
  }
  for (const b of base.tables) {
    if (!curTables.has(tkey(b))) out.tables.push({ name: b.name, kind: 'removed', base: b, columns: [], indexesAdded: [], indexesRemoved: [], commentChanged: false });
  }

  for (const e of current.enums) {
    const b = base.enums.find((x) => x.name === e.name);
    if (!b) out.enums.push({ name: e.name, kind: 'added', added: e.values, removed: [], current: e });
    else {
      const added = e.values.filter((v) => !b.values.includes(v));
      const removed = b.values.filter((v) => !e.values.includes(v));
      if (added.length || removed.length) out.enums.push({ name: e.name, kind: 'changed', added, removed, current: e, base: b });
    }
  }
  for (const b of base.enums) if (!current.enums.some((e) => e.name === b.name)) out.enums.push({ name: b.name, kind: 'removed', added: [], removed: b.values, base: b });

  const baseRels = new Map(base.relations.map((r) => [relSignature(base, r), r]));
  const curRels = new Map(current.relations.map((r) => [relSignature(current, r), r]));
  for (const [sig, rel] of curRels) {
    if (!baseRels.has(sig)) {
      out.relationsAdded.push({ sig, rel });
      out.relationStatus.set(rel.id, 'added');
    }
  }
  for (const [sig, rel] of baseRels) if (!curRels.has(sig)) out.relationsRemoved.push({ sig, rel });

  out.count =
    out.tables.length + out.enums.length + out.extensionsAdded.length + out.extensionsRemoved.length + out.relationsAdded.length + out.relationsRemoved.length;
  return out;
}

function fkName(s: Schema, r: Relation): string {
  if (r.name) return r.name;
  const t = s.tables.find((x) => x.id === r.from.table)!;
  const cols = r.from.columns.map((id) => t.columns.find((c) => c.id === id)?.name).join('_');
  return `${t.name}_${cols}_fkey`; // PostgreSQL's default constraint name
}

export function migrationSql(base: Schema, current: Schema, diff: SchemaDiff): string {
  const up: string[] = [];
  const note = (s: string) => up.push(`-- ${s}`);

  for (const e of diff.extensionsAdded) up.push(`CREATE EXTENSION IF NOT EXISTS ${quoteIdent(e)};`);

  for (const r of diff.relationsRemoved) {
    const t = base.tables.find((x) => x.id === r.rel.from.table)!;
    if (!diff.tables.some((d) => d.kind === 'removed' && d.base?.id === t.id))
      up.push(`ALTER TABLE ${qualified(t.name, t.schema)} DROP CONSTRAINT IF EXISTS ${quoteIdent(fkName(base, r.rel))};`);
  }

  for (const e of diff.enums) {
    if (e.kind === 'added' && e.current) up.push(enumDDL(e.current));
    if (e.kind === 'changed' && e.current) {
      const q = qualified(e.current.name, e.current.schema);
      for (const v of e.added) {
        const i = e.current.values.indexOf(v);
        const after = e.current.values.slice(0, i).reverse().find((x) => e.base!.values.includes(x));
        up.push(`ALTER TYPE ${q} ADD VALUE IF NOT EXISTS ${quoteLiteral(v)}${after ? ` AFTER ${quoteLiteral(after)}` : ''};`);
      }
      if (e.removed.length) note(`PostgreSQL cannot drop enum values (${e.removed.join(', ')}) — recreate ${e.name} manually.`);
    }
  }

  for (const d of diff.tables) {
    if (d.kind === 'added' && d.current) up.push(tableDDL(d.current, current));
    if (d.kind === 'changed' && d.current && d.base) {
      const tq = qualified(d.current.name, d.current.schema);
      for (const i of d.indexesRemoved) up.push(`DROP INDEX IF EXISTS ${quoteIdent(i.name)};`);
      for (const c of d.columns) {
        const cq = c.name ? quoteIdent(c.name) : '';
        if (c.kind === 'added' && c.current) {
          const col = c.current;
          let s = `ALTER TABLE ${tq} ADD COLUMN ${cq} ${formatType(col.type, current)}`;
          if (!col.nullable) s += ' NOT NULL';
          if (col.default) s += ` DEFAULT ${col.default}`;
          if (col.unique) s += ' UNIQUE';
          if (col.check) s += ` CHECK (${col.check})`;
          up.push(s + ';');
          if (!col.nullable && !col.default) note(`${d.name}.${c.name} is NOT NULL without default: backfill existing rows first.`);
          if (col.comment) up.push(`COMMENT ON COLUMN ${tq}.${cq} IS ${quoteLiteral(col.comment)};`);
        } else if (c.kind === 'removed') {
          up.push(`ALTER TABLE ${tq} DROP COLUMN ${cq};`);
        } else if (c.current && c.base) {
          const a = c.base;
          const b = c.current;
          if (a.type !== b.type) {
            const t = formatType(b.type, current);
            up.push(`ALTER TABLE ${tq} ALTER COLUMN ${cq} TYPE ${t} USING ${cq}::${t};`);
          }
          if (a.nullable !== b.nullable) up.push(`ALTER TABLE ${tq} ALTER COLUMN ${cq} ${b.nullable ? 'DROP' : 'SET'} NOT NULL;`);
          if ((a.default ?? '') !== (b.default ?? ''))
            up.push(b.default ? `ALTER TABLE ${tq} ALTER COLUMN ${cq} SET DEFAULT ${b.default};` : `ALTER TABLE ${tq} ALTER COLUMN ${cq} DROP DEFAULT;`);
          if (a.unique !== b.unique) {
            if (b.unique) up.push(`ALTER TABLE ${tq} ADD UNIQUE (${cq});`);
            else note(`Drop the UNIQUE constraint on ${d.name}.${c.name} (default name ${d.name}_${c.name}_key).`);
          }
          if ((a.comment ?? '') !== (b.comment ?? '')) up.push(`COMMENT ON COLUMN ${tq}.${cq} IS ${b.comment ? quoteLiteral(b.comment) : 'NULL'};`);
          if (a.pk !== b.pk || (a.check ?? '') !== (b.check ?? '')) note(`Primary key / CHECK on ${d.name}.${c.name} changed — review manually.`);
        }
      }
      if (d.commentChanged) up.push(`COMMENT ON TABLE ${tq} IS ${d.current.comment ? quoteLiteral(d.current.comment) : 'NULL'};`);
      for (const i of d.indexesAdded) up.push(indexDDL(d.current, i));
    }
  }

  for (const r of diff.relationsAdded) {
    const f = current.tables.find((x) => x.id === r.rel.from.table)!;
    const t = current.tables.find((x) => x.id === r.rel.to.table)!;
    const fc = r.rel.from.columns.map((id) => quoteIdent(f.columns.find((c) => c.id === id)!.name)).join(', ');
    const tc = r.rel.to.columns.map((id) => quoteIdent(t.columns.find((c) => c.id === id)!.name)).join(', ');
    let s = `ALTER TABLE ${qualified(f.name, f.schema)} ADD ${r.rel.name ? `CONSTRAINT ${quoteIdent(r.rel.name)} ` : ''}FOREIGN KEY (${fc}) REFERENCES ${qualified(t.name, t.schema)} (${tc})`;
    if (r.rel.onDelete !== 'NO ACTION') s += ` ON DELETE ${r.rel.onDelete}`;
    if (r.rel.onUpdate !== 'NO ACTION') s += ` ON UPDATE ${r.rel.onUpdate}`;
    up.push(s + ';');
  }

  for (const d of diff.tables) if (d.kind === 'removed' && d.base) up.push(`DROP TABLE IF EXISTS ${qualified(d.base.name, d.base.schema)};`);
  for (const e of diff.enums) if (e.kind === 'removed' && e.base) up.push(`DROP TYPE IF EXISTS ${qualified(e.base.name, e.base.schema)};`);
  for (const e of diff.extensionsRemoved) note(`Extension ${e} is no longer declared (not dropped automatically).`);

  if (!up.length) return '-- No structural differences.\n';
  return `BEGIN;\n\n${up.join('\n\n')}\n\nCOMMIT;\n`;
}
