import { useEffect, useRef, useState } from 'react';

export interface MenuItem {
  label?: string;
  action?: () => void;
  danger?: boolean;
  divider?: boolean;
  disabled?: boolean;
  /** Renders the item as a toggle with a leading check mark. */
  checked?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const [active, setActive] = useState(-1);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const close = () => onClose();
    const move = (dir: 1 | -1) =>
      setActive((a) => {
        let i = a;
        for (let step = 0; step < items.length; step++) {
          i = (i + dir + items.length) % items.length;
          if (!items[i].divider && !items[i].disabled) return i;
        }
        return a;
      });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        move(1);
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        move(-1);
        e.preventDefault();
      } else if (e.key === 'Enter') {
        const item = items[activeRef.current];
        if (item && !item.disabled) {
          item.action?.();
          onClose();
        }
        e.preventDefault();
      }
    };
    // Attach on the next tick so the same contextmenu/mousedown event that
    // opened the menu doesn't immediately close it.
    const id = setTimeout(() => {
      window.addEventListener('mousedown', close);
      window.addEventListener('contextmenu', close);
      window.addEventListener('resize', close);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('mousedown', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, items]);

  return (
    <div
      className="context-menu"
      role="menu"
      style={{ left: x, top: y }}
      // Stop mousedown so the window listener above doesn't close the menu
      // before an item's onClick (mousedown fires before click).
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="context-menu-divider" role="separator" />
        ) : (
          <div
            key={i}
            role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={item.checked}
            aria-disabled={item.disabled || undefined}
            className={`context-menu-item${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}${i === active ? ' active' : ''}`}
            onMouseEnter={() => {
              if (!item.disabled) setActive(i);
            }}
            onClick={() => {
              if (item.disabled) return;
              item.action?.();
              onClose();
            }}
          >
            {item.checked !== undefined && (
              <span className={`codicon codicon-check menu-check${item.checked ? '' : ' off'}`} aria-hidden />
            )}
            {item.label}
          </div>
        ),
      )}
    </div>
  );
}
