// PostgreSQL knowledge: builtin types, extension catalog, reserved words and
// identifier quoting rules.

export const BUILTIN_TYPES = [
  'smallint', 'integer', 'bigint', 'smallserial', 'serial', 'bigserial',
  'numeric', 'decimal', 'real', 'double precision', 'money',
  'text', 'varchar', 'char',
  'boolean', 'bytea', 'uuid', 'json', 'jsonb', 'xml',
  'date', 'time', 'timetz', 'timestamp', 'timestamptz', 'interval',
  'inet', 'cidr', 'macaddr', 'macaddr8',
  'point', 'line', 'lseg', 'box', 'path', 'polygon', 'circle',
  'tsvector', 'tsquery', 'bit', 'varbit',
  'int4range', 'int8range', 'numrange', 'tsrange', 'tstzrange', 'daterange',
  'oid', 'regclass', 'jsonpath', 'pg_lsn',
];

const BUILTIN_ALIASES = new Set([
  ...BUILTIN_TYPES,
  'int', 'int2', 'int4', 'int8', 'serial2', 'serial4', 'serial8', 'float4', 'float8',
  'bool', 'character', 'character varying', 'bpchar', 'float',
  'timestamp with time zone', 'timestamp without time zone',
  'time with time zone', 'time without time zone', 'bit varying',
  'int4multirange', 'int8multirange', 'nummultirange', 'tsmultirange', 'tstzmultirange', 'datemultirange',
  'txid_snapshot', 'regtype', 'regproc', 'name',
]);

export interface ExtensionInfo {
  name: string;
  label: string;
  description: string;
  types?: string[];
  functions?: string[];
  opclasses?: string[];
  methods?: string[];
}

export const EXTENSIONS: ExtensionInfo[] = [
  { name: 'ltree', label: 'ltree', description: 'Hierarchical tree-like labels (a.b.c paths) with GiST indexing.', types: ['ltree', 'lquery', 'ltxtquery'], opclasses: ['gist_ltree_ops'] },
  { name: 'vector', label: 'pgvector', description: 'Vector similarity search for embeddings.', types: ['vector', 'halfvec', 'sparsevec'], methods: ['hnsw', 'ivfflat'], opclasses: ['vector_cosine_ops', 'vector_l2_ops', 'vector_ip_ops'] },
  { name: 'postgis', label: 'PostGIS', description: 'Spatial types, indexes and functions.', types: ['geometry', 'geography', 'box2d', 'box3d'] },
  { name: 'citext', label: 'citext', description: 'Case-insensitive text type.', types: ['citext'] },
  { name: 'hstore', label: 'hstore', description: 'Key/value pairs in a single column.', types: ['hstore'] },
  { name: 'uuid-ossp', label: 'uuid-ossp', description: 'UUID generators such as uuid_generate_v4().', functions: ['uuid_generate_v4()', 'uuid_generate_v1()'] },
  { name: 'pgcrypto', label: 'pgcrypto', description: 'Hashing, encryption and gen_random_uuid().', functions: ['gen_random_uuid()', "digest(x, 'sha256')"] },
  { name: 'pg_trgm', label: 'pg_trgm', description: 'Trigram similarity and fast LIKE/ILIKE indexes.', opclasses: ['gin_trgm_ops', 'gist_trgm_ops'] },
  { name: 'btree_gist', label: 'btree_gist', description: 'B-tree equivalent operator classes for GiST (exclusion constraints).' },
  { name: 'btree_gin', label: 'btree_gin', description: 'B-tree equivalent operator classes for GIN.' },
  { name: 'intarray', label: 'intarray', description: 'Functions and operators for integer arrays.', opclasses: ['gist__int_ops', 'gin__int_ops'] },
  { name: 'cube', label: 'cube', description: 'Multi-dimensional cubes.', types: ['cube'] },
  { name: 'isn', label: 'isn', description: 'Product numbering standards (ISBN, EAN13, ISSN…).', types: ['isbn', 'isbn13', 'ean13', 'issn', 'upc'] },
  { name: 'unaccent', label: 'unaccent', description: 'Text search dictionary that removes accents.', functions: ['unaccent(text)'] },
  { name: 'fuzzystrmatch', label: 'fuzzystrmatch', description: 'Levenshtein, soundex and metaphone.', functions: ['levenshtein(a, b)'] },
  { name: 'pg_stat_statements', label: 'pg_stat_statements', description: 'Execution statistics of SQL statements.' },
  { name: 'timescaledb', label: 'TimescaleDB', description: 'Time-series hypertables.' },
];

export function extensionForType(baseType: string): ExtensionInfo | undefined {
  const t = baseType.toLowerCase();
  return EXTENSIONS.find((e) => e.types?.includes(t));
}

/** `varchar(255)[]` → `varchar`; `double precision` stays as is. */
export function baseTypeName(type: string): string {
  return type.replace(/\[\]/g, '').replace(/\s*\(.*\)\s*/, '').trim();
}

export function isBuiltinType(baseType: string): boolean {
  return BUILTIN_ALIASES.has(baseType.toLowerCase());
}

/** Canonical form used to compare FK and referenced column types. */
export function canonicalType(type: string): string {
  const arr = type.endsWith('[]') ? '[]' : '';
  const b = baseTypeName(type).toLowerCase();
  const map: Record<string, string> = {
    smallserial: 'smallint', serial2: 'smallint', int2: 'smallint',
    serial: 'integer', serial4: 'integer', int: 'integer', int4: 'integer',
    bigserial: 'bigint', serial8: 'bigint', int8: 'bigint',
    'character varying': 'varchar', character: 'char', bpchar: 'char',
    bool: 'boolean', float8: 'double precision', float: 'double precision', float4: 'real',
    decimal: 'numeric', 'timestamp with time zone': 'timestamptz', 'timestamp without time zone': 'timestamp',
    'time with time zone': 'timetz', 'time without time zone': 'time',
  };
  return (map[b] ?? b) + arr;
}

export function isSerial(type: string): boolean {
  return /^(small|big)?serial[248]?$/i.test(baseTypeName(type));
}

export const RESERVED = new Set(
  `all analyse analyze and any array as asc asymmetric both case cast check collate column constraint create
  current_catalog current_date current_role current_time current_timestamp current_user default deferrable desc
  distinct do else end except false fetch for foreign from grant group having in initially intersect into lateral
  leading limit localtime localtimestamp not null offset on only or order placing primary references returning
  select session_user some symmetric system_user table then to trailing true union unique user using variadic when
  where window with authorization binary collation concurrently cross current_schema freeze full ilike inner is
  isnull join left like natural notnull outer overlaps right similar tablesample verbose`
    .split(/\s+/)
    .filter(Boolean),
);

export function needsQuote(ident: string): boolean {
  return !/^[a-z_][a-z0-9_$]*$/.test(ident) || RESERVED.has(ident);
}

export function quoteIdent(ident: string): string {
  return needsQuote(ident) ? `"${ident.replace(/"/g, '""')}"` : ident;
}

export function qualified(name: string, schema?: string): string {
  return schema ? `${quoteIdent(schema)}.${quoteIdent(name)}` : quoteIdent(name);
}

export function quoteLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export const FK_ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'] as const;
