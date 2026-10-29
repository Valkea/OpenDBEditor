import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TypeGroup {
  label: string;
  types: string[];
}

/**
 * Type field with a list that shows every type on focus (a datalist only shows
 * the ones matching what's already typed), filters as you type, and picks with
 * the arrow keys and Enter. Free text is kept as is: `varchar(80)`, `text[]`…
 */
export function TypePicker({
  value,
  groups,
  onChange,
  className,
  autoFocus,
  onDone,
}: {
  value: string;
  groups: TypeGroup[];
  onChange: (v: string) => void;
  className?: string;
  autoFocus?: boolean;
  /** Enter with the list closed, e.g. to move on to the next column */
  onDone?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const justFocused = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null); // null: nothing typed since opening, show everything
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const shown = useMemo(() => {
    const q = query?.trim().toLowerCase();
    const seen = new Set<string>();
    const out: TypeGroup[] = [];
    for (const g of groups) {
      const types = g.types.filter((t) => !seen.has(t) && (!q || t.toLowerCase().includes(q)));
      types.forEach((t) => seen.add(t));
      if (types.length) out.push({ label: g.label, types });
    }
    // prefix matches first
    if (q) for (const g of out) g.types.sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)));
    return out;
  }, [groups, query]);
  const flat = useMemo(() => shown.flatMap((g) => g.types), [shown]);

  const show = () => {
    setQuery(null);
    setActive(Math.max(0, flat.indexOf(value)));
    setRect(input.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };

  useEffect(() => {
    if (!autoFocus) return;
    input.current?.focus();
    input.current?.select();
    show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  useLayoutEffect(() => {
    if (open) listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [open, active, shown]);

  const pick = (t: string) => {
    onChange(t);
    setOpen(false);
  };

  return (
    <>
      <input
        ref={input}
        className={className}
        value={value}
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        onFocus={(e) => {
          // select the whole type so typing replaces it; the click's mouseup would undo that, hence the flag
          e.currentTarget.select();
          justFocused.current = true;
          show();
        }}
        onMouseUp={(e) => {
          if (justFocused.current) e.preventDefault();
          justFocused.current = false;
        }}
        onClick={() => !open && show()}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setQuery(e.target.value);
          setActive(0);
          if (!open) show();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) return show();
            const n = flat.length;
            if (n) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && flat[active]) pick(flat[active]);
            else {
              setOpen(false);
              onDone?.();
            }
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === 'Tab') setOpen(false);
        }}
      />
      {open &&
        rect &&
        flat.length > 0 &&
        createPortal(
          <div
            ref={listRef}
            className="type-pop"
            style={{ left: rect.left, top: rect.bottom + 4, minWidth: Math.max(rect.width, 180) }}
            onMouseDown={(e) => e.preventDefault() /* keep focus in the input */}
          >
            {shown.map((g) => (
              <div key={g.label}>
                <div className="type-pop-group">{g.label}</div>
                {g.types.map((t) => {
                  const i = flat.indexOf(t);
                  return (
                    <button key={t} className={`type-pop-item ${i === active ? 'is-active' : ''} ${t === value ? 'is-current' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => pick(t)}>
                      {t}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
