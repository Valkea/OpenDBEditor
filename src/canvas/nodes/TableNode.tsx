import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { KeyRound, Link2, Lock, MessageSquareText, Waypoints } from 'lucide-react';
import { memo } from 'react';
import type { ChangeKind } from '../../analysis/diff';
import type { Schema, Table } from '../../model/types';
import { CARD_W, cardHeight, type Detail, visibleColumns } from '../../layout/geometry';
import { baseTypeName, extensionForType } from '../../sql/pg';

export interface TableNodeData extends Record<string, unknown> {
  table: Table;
  schema: Schema;
  detail: Detail;
  groupColor?: string;
  fkCols: Set<string>;
  /** FK column id → referenced table name, when that relation is drawn as a portal. */
  portals: Map<string, { name: string; id: string }>;
  enumNames: Set<string>;
  faded?: boolean;
  lit?: boolean;
  diff?: ChangeKind;
  colDiff?: Map<string, ChangeKind>;
  removedCols?: number;
  issues?: { errors: number; warnings: number };
  selectedColumn?: string;
  onPortal?: (tableId: string) => void;
}

export type TableNodeType = Node<TableNodeData, 'table'>;

function TypeChip({ type, enumNames }: { type: string; enumNames: Set<string> }) {
  const base = baseTypeName(type);
  if (enumNames.has(base)) return <span className="ttype ttype-enum" title={`enum ${base}`}>{type}</span>;
  const ext = extensionForType(base);
  if (ext) return <span className="ttype ttype-ext" title={`${ext.label} extension type`}>{type}</span>;
  return <span className="ttype">{type}</span>;
}

/** Largest font (px) at which the longest underscore-separated word still fits the block. */
function blockFont(name: string): number {
  const longest = Math.max(...name.split('_').map((w) => w.length + 1));
  return Math.max(20, Math.min(40, Math.floor(400 / longest)));
}

/** Handles for columns that aren't shown as rows, so edges never point at a missing handle mid-transition. */
function GhostHandles({ columns }: { columns: { id: string }[] }) {
  return (
    <>
      {columns.map((c) => (
        <span key={c.id}>
          <Handle type="source" position={Position.Left} id={`${c.id}-L`} className="h h-ghost" isConnectable={false} />
          <Handle type="source" position={Position.Right} id={`${c.id}-R`} className="h h-ghost" isConnectable={false} />
        </span>
      ))}
    </>
  );
}

function TableNodeImpl({ data, selected }: NodeProps<TableNodeType>) {
  const { table, schema, detail, groupColor, fkCols, portals, enumNames, faded, lit, diff, colDiff, issues, selectedColumn, removedCols } = data;
  const cols = visibleColumns(table, schema, detail);
  const hidden = table.columns.length - cols.length;
  const accent = table.color ?? groupColor ?? 'var(--accent)';
  const cls = ['tcard', `tcard-${detail}`, selected && 'is-selected', faded && 'is-faded', lit && 'is-lit', diff && `diff-${diff}`, table.status && `status-${table.status}`]
    .filter(Boolean)
    .join(' ');

  if (detail === 'compact') {
    return (
      <div className={cls} style={{ width: CARD_W, height: cardHeight(table, schema, 'full'), ['--card-accent' as string]: accent }}>
        <Handle type="source" position={Position.Left} id="T-L" className="h h-table" isConnectable={false} />
        <Handle type="source" position={Position.Right} id="T-R" className="h h-table" isConnectable={false} />
        <GhostHandles columns={table.columns} />
        <div className="tblock">
          <span className="tblock-name" style={{ fontSize: blockFont(table.name) }}>
            {table.name.replace(/_/g, '_\u200b')}
          </span>
          <span className="tblock-meta">
            {table.columns.length} col{table.columns.length === 1 ? '' : 's'}
            {issues && issues.errors + issues.warnings > 0 && <span className={issues.errors ? 'tblock-err' : 'tblock-warn'}> · {issues.errors + issues.warnings} issue{issues.errors + issues.warnings > 1 ? 's' : ''}</span>}
            {diff && <span className={`tblock-diff diff-${diff}`}> · {diff === 'added' ? 'new' : 'changed'}</span>}
          </span>
          {table.locked && <Lock size={28} className="tblock-lock" />}
        </div>
      </div>
    );
  }

  return (
    <div className={cls} style={{ width: CARD_W, ['--card-accent' as string]: accent }}>
      <Handle type="source" position={Position.Left} id="T-L" className="h h-table" isConnectable={false} />
      <Handle type="source" position={Position.Right} id="T-R" className="h h-table" isConnectable={false} />
      {hidden > 0 && <GhostHandles columns={table.columns.filter((c) => !cols.includes(c))} />}
      <header className="tcard-head" title={table.comment ?? undefined}>
        <span className="tcard-bar" />
        <span className="tcard-name">
          {table.schema && table.schema !== 'public' && <span className="tcard-schema">{table.schema}.</span>}
          {table.name}
        </span>
        <span className="tcard-badges">
          {diff && <span className={`badge badge-${diff}`}>{diff === 'added' ? 'new' : 'changed'}</span>}
          {!!removedCols && <span className="badge badge-removed">−{removedCols} col</span>}
          {table.status && <span className={`badge badge-${table.status}`}>{table.status}</span>}
          {issues && issues.errors > 0 && <span className="badge badge-err" title="Schema errors">{issues.errors}</span>}
          {issues && !issues.errors && issues.warnings > 0 && <span className="badge badge-warn" title="Schema warnings">{issues.warnings}</span>}
          {table.portal && <Waypoints size={12} className="muted" aria-label="portal" />}
          {table.locked && <Lock size={12} className="muted" aria-label="locked" />}
        </span>
      </header>
      {detail === 'full' && table.comment && <div className="tcard-comment">{table.comment}</div>}
      <div className="tcard-rows">
          {cols.map((c) => {
            const isFk = fkCols.has(c.id);
            const portal = portals.get(c.id);
            const cd = colDiff?.get(c.id);
            const tip = [
              `${c.name} ${c.type}`,
              c.pk ? 'PRIMARY KEY' : !c.nullable ? 'NOT NULL' : 'NULL',
              c.unique ? 'UNIQUE' : '',
              c.default ? `DEFAULT ${c.default}` : '',
              c.check ? `CHECK (${c.check})` : '',
              c.comment ? `\n${c.comment}` : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div key={c.id} className={['trow', selectedColumn === c.id && 'is-col-selected', cd && `diff-${cd}`].filter(Boolean).join(' ')} data-col={c.id} title={tip}>
                <Handle type="source" position={Position.Left} id={`${c.id}-L`} className="h" />
                <span className={`ticon ${c.pk ? 'ticon-pk' : isFk ? 'ticon-fk' : c.nullable ? 'ticon-null' : 'ticon-nn'}`}>
                  {c.pk ? <KeyRound size={12} /> : isFk ? <Link2 size={12} /> : <i />}
                </span>
                <span className={`tname ${c.nullable ? '' : 'is-nn'}`}>{c.name}</span>
                {c.comment && <MessageSquareText size={11} className="tcomment-ico" />}
                {portal && (
                  <button
                    className="portal-chip nodrag"
                    title={`References ${portal.name} — click to fly there`}
                    onClick={(e) => {
                      e.stopPropagation();
                      data.onPortal?.(portal.id);
                    }}
                  >
                    ↗ {portal.name}
                  </button>
                )}
                <span className="tflags">
                  {c.unique && !c.pk && <span title="UNIQUE">U</span>}
                  {c.default !== undefined && <span title={`DEFAULT ${c.default}`}>D</span>}
                  {(c.check || c.generated) && <span title={c.check ? `CHECK (${c.check})` : `GENERATED (${c.generated})`}>{c.check ? 'C' : 'G'}</span>}
                </span>
                <TypeChip type={c.type} enumNames={enumNames} />
                <Handle type="source" position={Position.Right} id={`${c.id}-R`} className="h" />
              </div>
            );
          })}
          {hidden > 0 && <div className="trow trow-more">+ {hidden} more column{hidden > 1 ? 's' : ''}</div>}
      </div>
      {lit && <span className="tcard-glow" />}
    </div>
  );
}

export const TableNode = memo(TableNodeImpl);
