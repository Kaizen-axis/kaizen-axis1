import { useEffect, useRef, useState } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';

const PERIOD_OPTIONS = ['Mês vigente', '30 dias', '60 dias', '90 dias', 'Personalizado'];

export function FilterMenu({
  period,
  onPeriodChange,
}: {
  period: string;
  onPeriodChange: (period: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  const isActive = (option: string) =>
    option === 'Personalizado' ? period.includes('/') : period === option;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="h-9 px-2.5 flex items-center gap-2 rounded-lg border border-surface-200 bg-card-bg text-text-secondary hover:text-gold-700 hover:border-gold-300 shadow-sm transition-all"
        aria-label="Filtrar período"
      >
        <SlidersHorizontal size={16} />
        <span className="hidden sm:inline text-[11px] font-semibold max-w-[150px] truncate">{period}</span>
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 z-20 w-48 bg-card-bg border border-surface-200 rounded-xl shadow-xl overflow-hidden p-2">
          <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-text-secondary">Período</p>
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => { setIsOpen(false); onPeriodChange(option); }}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-colors ${
                isActive(option) ? 'bg-gold-50 text-gold-700' : 'text-text-secondary hover:bg-surface-50'
              }`}
            >
              {option}
              {isActive(option) && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
