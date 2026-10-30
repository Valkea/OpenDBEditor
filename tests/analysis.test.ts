import { existsSync, readFileSync } from 'node:fs';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { diffSchemas, migrationSql } from '../src/analysis/diff';
import { joinSql, shortestPath } from '../src/analysis/graph';
import { lintSchema } from '../src/analysis/lint';
import { generateSql } from '../src/sql/generator';
import { applyLayout } from '../src/sql/layoutMeta';
import { parseSql } from '../src/sql/parser';

// private reference schemas, not in the repo: SCHEMA_DIR=/path/to/dir with schema-v14.sql and schema-v15.sql
const DOCS = process.env.SCHEMA_DIR ?? '.missing';
const has = existsSync(`${DOCS}/schema-v15.sql`) && existsSync(`${DOCS}/schema-v14.sql`);
const load = (v: number) => parseSql(readFileSync(`${DOCS}/schema-v${v}.sql`, 'utf8')).schema;
const byRule = (s: ReturnType<typeof load>) => {
  const m: Record<string, number> = {};
  for (const i of lintSchema(s)) m[i.rule] = (m[i.rule] ?? 0) + 1;
  return m;
};

describe('lint', () => {
  it('flags type problems on a small schema', () => {
    const { schema } = parseSql(`
      CREATE TABLE a (id bigint PRIMARY KEY, path ltree);
      CREATE TABLE b (id serial PRIMARY KEY, a_id integer REFERENCES a, note text);
      CREATE TABLE c (x int);
    `);
    const rules = byRule(schema);
    expect(rules['missing-extension']).toBe(1);
    expect(rules['fk-type-mismatch']).toBe(1);
    expect(rules['fk-missing-index']).toBe(1);
    expect(rules['no-primary-key']).toBe(1);
    expect(rules['orphan-table']).toBe(1);
    const fixed = produce(schema, (d) => lintSchema(schema).forEach((i) => i.fix?.apply(d)));
    expect(fixed.extensions.map((e) => e.name)).toEqual(['ltree']);
    expect(fixed.tables[1].indexes.map((i) => i.columns)).toEqual([['a_id']]);
  });

  it.runIf(has)('finds the known issues in the reference schema and the quick fixes clear them', () => {
    const s = load(15);
    const rules = byRule(s);
    expect(rules['fk-missing-index']).toBe(22);
    expect(rules['redundant-index']).toBe(8);
    expect(rules['double-escaped-comment']).toBe(10);
    expect(rules['fk-type-mismatch']).toBeUndefined();
    const fixed = produce(s, (d) => lintSchema(s).filter((i) => i.rule !== 'mixed-case').forEach((i) => i.fix?.apply(d)));
    const after = byRule(fixed);
    expect(after['fk-missing-index']).toBeUndefined();
    expect(after['redundant-index']).toBeUndefined();
    expect(after['double-escaped-comment']).toBeUndefined();
  });
});

describe.runIf(has)('diff + migration v14 → v15', () => {
  it('reports exactly what changed', () => {
    const v14 = load(14);
    const v15 = load(15);
    const d = diffSchemas(v14, v15);
    expect(d.tables.map((t) => `${t.kind}:${t.name}`)).toEqual(['added:model_licenses', 'changed:models']);
    expect(d.tables[1].columns.map((c) => `${c.kind}:${c.name}`)).toEqual(['added:weights_access', 'added:license_id']);
    expect(d.enums.map((e) => `${e.kind}:${e.name}`)).toEqual(['added:ENUM_WEIGHTS_ACCESS']);
    expect(d.relationsAdded.map((r) => r.sig)).toEqual(['models(license_id) → model_licenses(id)']);
    const sql = migrationSql(v14, v15, d);
    expect(sql).toContain('CREATE TYPE "ENUM_WEIGHTS_ACCESS"');
    expect(sql).toContain('CREATE TABLE model_licenses');
    expect(sql).toContain('ALTER TABLE models ADD COLUMN weights_access "ENUM_WEIGHTS_ACCESS";');
    expect(sql).toContain('ALTER TABLE models ADD FOREIGN KEY (license_id) REFERENCES model_licenses (id);');
    // applying the migration on top of v14 must give v15 back
    const migrated = parseSql(`${readFileSync(`${DOCS}/schema-v14.sql`, 'utf8')}\n${sql}`);
    expect(migrated.diagnostics.filter((x) => x.severity === 'error')).toEqual([]);
    expect(diffSchemas(migrated.schema, v15).count).toBe(0);
  });

  it('is empty when nothing changed', () => {
    const v15 = load(15);
    expect(diffSchemas(v15, load(15)).count).toBe(0);
  });
});

describe.runIf(has)('graph', () => {
  it('builds the join between distant tables', () => {
    const s = load(15);
    const id = (n: string) => s.tables.find((t) => t.name === n)!.id;
    const path = shortestPath(s, id('output_judgements'), id('categories'))!;
    expect(path).toHaveLength(4);
    expect(joinSql(s, id('output_judgements'), path)).toContain('JOIN categories c ON c.id = s.category_id');
  });

  it('keeps layout through a SQL download / re-open', () => {
    const s = load(15);
    s.tables[0].x = 1234;
    s.tables[0].locked = true;
    s.groups = [{ id: 'g1', name: 'Core', color: '#7c9cff' }];
    s.tables[1].groupId = 'g1';
    s.notes = [{ id: 'n1', text: 'hello', x: 1, y: 2, w: 200, h: 100, color: '#fde68a', attachedTo: s.tables[1].id }];
    const back = parseSql(generateSql(s, { embedLayout: true }));
    expect(applyLayout(back.schema, back.layoutBlob!)).toBe(true);
    expect(back.schema.tables[0]).toMatchObject({ x: 1234, locked: true });
    expect(back.schema.tables[1].groupId).toBe('g1');
    expect(back.schema.notes[0].attachedTo).toBe(back.schema.tables[1].id);
  });
});
