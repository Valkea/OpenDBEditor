// URL-safe compression of the schema: JSON → deflate → base64url.
// The result goes in the URL *hash*, which browsers never send to a server.

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { Schema } from '../model/types';

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function packJson(value: unknown): string {
  return toBase64Url(deflateSync(strToU8(JSON.stringify(value)), { level: 9 }));
}

export function unpackJson<T>(packed: string): T {
  return JSON.parse(strFromU8(inflateSync(fromBase64Url(packed)))) as T;
}

/** Drop undefined/false/empty fields so the payload stays small. */
function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || v === false || v === '' || (Array.isArray(v) && v.length === 0 && k !== 'columns' && k !== 'values')) continue;
      out[k] = typeof v === 'number' ? Math.round(v) : prune(v);
    }
    return out;
  }
  return value;
}

export function encodeSchema(schema: Schema): string {
  return packJson(prune(schema));
}

export function decodeSchema(packed: string): Schema {
  const s = unpackJson<Partial<Schema>>(packed);
  if (s.v !== 1) throw new Error('Unsupported schema link version');
  const schema: Schema = {
    v: 1,
    name: s.name ?? 'Untitled schema',
    extensions: s.extensions ?? [],
    enums: (s.enums ?? []).map((e) => ({ ...e, values: e.values ?? [] })),
    tables: (s.tables ?? []).map((t) => ({
      ...t,
      x: t.x ?? 0,
      y: t.y ?? 0,
      indexes: (t.indexes ?? []).map((i) => ({ ...i, unique: !!i.unique, columns: i.columns ?? [] })),
      constraints: t.constraints ?? [],
      columns: (t.columns ?? []).map((c) => ({ ...c, nullable: !!c.nullable, pk: !!c.pk, unique: !!c.unique })),
    })),
    relations: (s.relations ?? []).map((r) => ({ ...r, onDelete: r.onDelete ?? 'NO ACTION', onUpdate: r.onUpdate ?? 'NO ACTION' })),
    groups: s.groups ?? [],
    notes: (s.notes ?? []).map((n) => ({ ...n, x: n.x ?? 0, y: n.y ?? 0 })),
    raw: s.raw ?? [],
    view: s.view,
  };
  return schema;
}

export const HASH_KEY = 's';

export function readHash(): string | null {
  const m = /[#&]s=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  return m ? m[1] : null;
}

export function shareUrl(packed: string): string {
  return `${window.location.origin}${window.location.pathname}#${HASH_KEY}=${packed}`;
}
