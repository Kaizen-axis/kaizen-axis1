import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Check, X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Normaliza para comparação: remove acentos e caixa. Aceita null do banco. */
const norm = (s: string | null | undefined) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  allowClear?: boolean;
  /** Permite digitar/usar um valor que não está na lista (combo). */
  allowCustom?: boolean;
}

/**
 * Seletor com campo de busca — força a escolha de um valor da lista (padroniza
 * os dados, evitando variações de digitação). Usado, por ex., na Região de
 * Interesse da ficha do cliente.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Selecione',
  searchPlaceholder = 'Buscar...',
  className,
  allowClear = true,
  allowCustom = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const safeOptions = useMemo(
    () => options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0),
    [options],
  );

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return safeOptions;
    return safeOptions.filter(o => norm(o).includes(q));
  }, [safeOptions, query]);

  const select = (opt: string) => {
    onChange(opt);
    setOpen(false);
    setQuery('');
  };

  const trimmedQuery = query.trim();
  const hasExactMatch = safeOptions.some(o => norm(o) === norm(trimmedQuery));
  const showAddCustom = allowCustom && trimmedQuery.length > 0 && !hasExactMatch;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-primary-500/40 text-left text-sm transition-all"
      >
        <span className={cn('truncate', value ? 'text-text-primary' : 'text-text-secondary')}>
          {value || placeholder}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {allowClear && value && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              className="p-0.5 rounded-md text-text-secondary hover:text-text-primary"
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={16} className={cn('text-text-secondary transition-transform', open && 'rotate-180')} />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1.5 bg-card-bg border border-surface-200 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-surface-100">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-2 py-2 bg-surface-50 rounded-lg text-sm text-text-primary border-none focus:ring-2 focus:ring-primary-500/40 placeholder:text-text-secondary"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && !showAddCustom ? (
              <p className="px-3 py-3 text-xs text-text-secondary text-center">Nenhum resultado.</p>
            ) : (
              filtered.map(opt => {
                const isSelected = norm(opt) === norm(value);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => select(opt)}
                    className={cn(
                      'w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-100',
                      isSelected ? 'text-primary-400 font-semibold' : 'text-text-primary',
                    )}
                  >
                    <span className="truncate">{opt}</span>
                    {isSelected && <Check size={14} className="text-primary-400 flex-shrink-0" />}
                  </button>
                );
              })
            )}
            {showAddCustom && (
              <button
                type="button"
                onClick={() => select(trimmedQuery)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-primary-400 font-medium hover:bg-surface-100 transition-colors border-t border-surface-100"
              >
                <Plus size={14} className="flex-shrink-0" />
                <span className="truncate">Usar "{trimmedQuery}"</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
