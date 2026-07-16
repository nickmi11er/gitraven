import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface DropdownItem {
  value: string;
  label: string;
}

export interface DropdownGroup {
  label?: string;
  items: DropdownItem[];
}

interface Props {
  /** Chip prefix, e.g. "Branch" — omitted for bare value chips. */
  label?: string;
  /** Selected value (single mode). */
  value?: string;
  /** Selected values (multi mode). */
  values?: string[];
  /** Multi-select: item clicks toggle and keep the menu open; an item with
   *  value '' acts as "All" — it resets the selection and closes. */
  multi?: boolean;
  /** Value the chip renders as neutral (the filter's default state); '' if omitted. */
  defaultValue?: string;
  /** Chip text override; defaults to the selected item's label. */
  display?: string;
  groups: DropdownGroup[];
  onSelect: (value: string) => void;
  className?: string;
}

/** Native <select> renders an OS-styled popup that ignores the VS Code theme,
 *  so filters use this themed chip + menu instead. */
export function Dropdown({ label, value, values, multi, defaultValue, display, groups, onSelect, className }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const flat = groups.flatMap((g) => g.items);
  const isSelected = (v: string) => (multi ? (values ?? []).includes(v) : v === value);
  const hasValue = multi ? (values ?? []).length > 0 : (value ?? '') !== (defaultValue ?? '');
  const chipText = display ?? flat.find((i) => i.value === value)?.label ?? value ?? '';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const close = () => setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    // Capture-phase: scroll events from nested scroll containers don't bubble,
    // and a fixed-position menu would detach from its chip when they scroll.
    // Scrolling the menu's own list must not close it, though.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // The menu is position:fixed so overflow:auto ancestors (e.g. the rebase
  // dialog list) can't clip it; place it against the chip, flip upward when
  // the space below is too small, and clamp to the viewport.
  useLayoutEffect(() => {
    const chip = rootRef.current;
    const menu = menuRef.current;
    if (!open || !chip || !menu) return;
    const rect = chip.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const openUp = below < Math.min(menu.offsetHeight, 120) && above > below;
    const maxHeight = Math.max(64, openUp ? above : below);
    menu.style.maxHeight = `${maxHeight}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = openUp
      ? `${Math.max(8, rect.top - menu.offsetHeight - 4)}px`
      : `${rect.bottom + 4}px`;
  }, [open]);

  useLayoutEffect(() => {
    if (open) menuRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const toggle = () => {
    setActive(flat.findIndex((i) => isSelected(i.value)));
    setOpen((v) => !v);
  };

  const pick = (v: string) => {
    onSelect(v);
    if (!multi || v === '') setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        toggle();
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      setActive((a) => Math.min(flat.length - 1, a + 1));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setActive((a) => Math.max(0, a - 1));
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      const item = flat[active];
      if (item) pick(item.value);
      else setOpen(false);
      e.preventDefault();
    }
  };

  const offsets: number[] = [];
  {
    let acc = 0;
    for (const g of groups) {
      offsets.push(acc);
      acc += g.items.length;
    }
  }

  return (
    <div className={`dropdown${className ? ` ${className}` : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`dropdown-chip${open ? ' open' : ''}${hasValue ? ' has-value' : ''}`}
        onClick={toggle}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {label && <span className="dropdown-chip-label">{label}:</span>}
        <span className="dropdown-chip-value">{chipText}</span>
        <span className="codicon codicon-chevron-down" aria-hidden />
      </button>
      {open && (
        <div className="dropdown-menu" role="listbox" aria-multiselectable={multi || undefined} ref={menuRef}>
          {groups.map((g, gi) => (
            <div key={gi} className="dropdown-group">
              {g.label && <div className="dropdown-group-label">{g.label}</div>}
              {g.items.map((item, ii) => {
                const index = offsets[gi] + ii;
                const selected = isSelected(item.value);
                return (
                  <div
                    key={`${gi}-${item.value}`}
                    role="option"
                    aria-selected={selected}
                    className={`dropdown-item${index === active ? ' active' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(item.value)}
                  >
                    <span className={`codicon codicon-check${selected ? '' : ' codicon-hidden'}`} aria-hidden />
                    <span className="dropdown-item-label">{item.label}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
