// A small PostgreSQL lexer: enough to split statements safely (strings,
// dollar-quoted bodies, comments) and to drive the DDL parser.

export type TokType = 'id' | 'qid' | 'str' | 'num' | 'op';

export interface Tok {
  t: TokType;
  /** id: lower-cased; qid: unescaped (case kept); str: unescaped; others: raw. */
  v: string;
  start: number;
  end: number;
  line: number;
  /** `--` / block comments immediately preceding this token. */
  lead?: string[];
}

export interface LexResult {
  tokens: Tok[];
  trailing: string[];
  errors: { start: number; end: number; line: number; message: string }[];
}

const isIdStart = (c: string) => /[A-Za-z_\u0080-￿]/.test(c);
const isIdPart = (c: string) => /[A-Za-z0-9_$\u0080-￿]/.test(c);

export function lex(src: string): LexResult {
  const tokens: Tok[] = [];
  const errors: LexResult['errors'] = [];
  let i = 0;
  let line = 1;
  let pending: string[] = [];
  const n = src.length;

  const push = (t: TokType, v: string, start: number, startLine: number) => {
    const tok: Tok = { t, v, start, end: i, line: startLine };
    if (pending.length) {
      tok.lead = pending;
      pending = [];
    }
    tokens.push(tok);
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') {
      i++;
      continue;
    }
    // line comment
    if (c === '-' && src[i + 1] === '-') {
      const s = i + 2;
      while (i < n && src[i] !== '\n') i++;
      pending.push(src.slice(s, i).replace(/^ ?/, ''));
      continue;
    }
    // block comment (nestable in PG)
    if (c === '/' && src[i + 1] === '*') {
      const s = i;
      let depth = 0;
      while (i < n) {
        if (src[i] === '/' && src[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (src[i] === '*' && src[i + 1] === '/') {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else {
          if (src[i] === '\n') line++;
          i++;
        }
      }
      pending.push(src.slice(s + 2, Math.max(s + 2, i - 2)).trim());
      continue;
    }
    const start = i;
    const startLine = line;
    // strings: '...', E'...', N'...'
    if (c === "'" || ((c === 'E' || c === 'e' || c === 'N' || c === 'n') && src[i + 1] === "'")) {
      const escapes = c === 'E' || c === 'e';
      if (c !== "'") i++;
      i++;
      let v = '';
      let closed = false;
      while (i < n) {
        const ch = src[i];
        if (ch === "'") {
          if (src[i + 1] === "'") {
            v += "'";
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        if (escapes && ch === '\\' && i + 1 < n) {
          const nx = src[i + 1];
          v += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx;
          i += 2;
          continue;
        }
        if (ch === '\n') line++;
        v += ch;
        i++;
      }
      if (!closed) errors.push({ start, end: i, line: startLine, message: 'Unterminated string literal' });
      push('str', v, start, startLine);
      continue;
    }
    // dollar quoting: $$...$$ or $tag$...$tag$
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const bodyStart = i + tag.length;
        const close = src.indexOf(tag, bodyStart);
        const end = close < 0 ? n : close + tag.length;
        const body = src.slice(bodyStart, close < 0 ? n : close);
        line += (src.slice(i, end).match(/\n/g) ?? []).length;
        i = end;
        if (close < 0) errors.push({ start, end, line: startLine, message: 'Unterminated dollar-quoted string' });
        push('str', body, start, startLine);
        continue;
      }
    }
    // quoted identifier
    if (c === '"') {
      i++;
      let v = '';
      let closed = false;
      while (i < n) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            v += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        if (src[i] === '\n') line++;
        v += src[i++];
      }
      if (!closed) errors.push({ start, end: i, line: startLine, message: 'Unterminated quoted identifier' });
      push('qid', v, start, startLine);
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      while (i < n && /[0-9.eE]/.test(src[i])) {
        if ((src[i] === 'e' || src[i] === 'E') && (src[i + 1] === '-' || src[i + 1] === '+')) i++;
        i++;
      }
      push('num', src.slice(start, i), start, startLine);
      continue;
    }
    if (isIdStart(c)) {
      while (i < n && isIdPart(src[i])) i++;
      push('id', src.slice(start, i).toLowerCase(), start, startLine);
      continue;
    }
    // operators / punctuation
    const two = src.slice(i, i + 2);
    if (['::', '<=', '>=', '<>', '!=', '||', '->', '~~', '@>', '<@', '&&'].includes(two)) {
      i += 2;
      if (two === '->' && src[i] === '>') i++;
      push('op', src.slice(start, i), start, startLine);
      continue;
    }
    i++;
    push('op', c, start, startLine);
  }
  return { tokens, trailing: pending, errors };
}

/** Split a token stream into statements on top-level semicolons. */
export function splitStatements(tokens: Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let cur: Tok[] = [];
  for (const t of tokens) {
    if (t.t === 'op' && t.v === ';') {
      if (cur.length) out.push(cur);
      cur = [];
      continue;
    }
    cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}
