// The in-memory schema model. Everything the app knows lives here; it is what
// gets serialized into the URL hash and what the SQL parser/generator map to.

export type FkAction = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';

export interface Column {
  id: string;
  name: string;
  /** Type as written, normalised to lower case for builtins (e.g. `varchar(255)`, `ltree`, `text[]`). Enum names keep their case. */
  type: string;
  nullable: boolean;
  pk: boolean;
  unique: boolean;
  default?: string;
  check?: string;
  comment?: string;
  identity?: 'ALWAYS' | 'BY DEFAULT';
  /** Expression of a `GENERATED ALWAYS AS (…) STORED` column. */
  generated?: string;
}

export interface Index {
  id: string;
  name: string;
  /** Column names or raw expressions. */
  columns: string[];
  unique: boolean;
  method?: string;
  where?: string;
}

export interface TableConstraint {
  id: string;
  name?: string;
  kind: 'unique' | 'check' | 'raw';
  columns?: string[];
  /** check: the boolean expression; raw: the full constraint text (EXCLUDE…). */
  expr?: string;
}

export type TableStatus = 'draft' | 'deprecated';

export interface Table {
  id: string;
  name: string;
  schema?: string;
  comment?: string;
  columns: Column[];
  indexes: Index[];
  constraints: TableConstraint[];
  pkName?: string;
  x: number;
  y: number;
  groupId?: string;
  color?: string;
  locked?: boolean;
  status?: TableStatus;
  /** Draw inbound relations as portal chips instead of lines (Atlas view): true always, false never, unset when busy enough and portals are on. */
  portal?: boolean;
}

export interface RelationEnd {
  table: string; // table id
  columns: string[]; // column ids
}

export interface Relation {
  id: string;
  name?: string;
  from: RelationEnd; // referencing (child, holds the FK)
  to: RelationEnd; // referenced (parent)
  onDelete: FkAction;
  onUpdate: FkAction;
}

export interface EnumType {
  id: string;
  name: string;
  schema?: string;
  values: string[];
  comment?: string;
}

export interface Extension {
  name: string;
  schema?: string;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  locked?: boolean;
}

export interface Note {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  attachedTo?: string; // table id
}

export type ViewMode = 'atlas' | 'blueprint' | 'constellation';

export interface Schema {
  v: 1;
  name: string;
  extensions: Extension[];
  enums: EnumType[];
  tables: Table[];
  relations: Relation[];
  groups: Group[];
  notes: Note[];
  /** Statements the parser keeps verbatim (views, functions, triggers…). */
  raw: string[];
  view?: ViewMode;
}

export const emptySchema = (): Schema => ({
  v: 1,
  name: 'Untitled schema',
  extensions: [],
  enums: [],
  tables: [],
  relations: [],
  groups: [],
  notes: [],
  raw: [],
});
