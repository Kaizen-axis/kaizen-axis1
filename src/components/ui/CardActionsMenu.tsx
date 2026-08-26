import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

export interface CardActionItem {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}

const MENU_WIDTH = 192;
const MENU_GAP = 6;

export function CardActionsMenu({
  items,
  className,
}: {
  items: CardActionItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const updatePosition = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const panelH = panelRef.current?.offsetHeight ?? 88;
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
    const openUp = spaceBelow < panelH && rect.top > panelH + MENU_GAP;
    const top = openUp ? rect.top - panelH - MENU_GAP : rect.bottom + MENU_GAP;
    const left = Math.min(
      Math.max(8, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - 8,
    );
    setCoords({ top, left });
  };

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    updatePosition();
    const onReposition = () => updatePosition();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`relative ${className ?? ''}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label="Ações"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="min-h-11 min-w-11 flex items-center justify-center rounded-lg border border-surface-200 bg-card-bg text-text-secondary hover:text-gold-700 hover:border-gold-300 shadow-sm transition-all"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          role="menu"
          style={{
            position: 'fixed',
            top: coords?.top ?? -9999,
            left: coords?.left ?? -9999,
            width: MENU_WIDTH,
          }}
          className="z-[80] bg-card-bg border border-surface-200 rounded-xl shadow-xl overflow-hidden p-1.5"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onClick?.();
              }}
              className={`w-full min-h-11 flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-colors ${
                item.disabled
                  ? 'text-text-secondary/40 cursor-not-allowed'
                  : item.danger
                    ? 'text-red-500 hover:bg-danger-subtle'
                    : 'text-text-secondary hover:bg-surface-100'
              }`}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
