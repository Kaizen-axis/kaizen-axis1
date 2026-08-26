import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { SearchableBroker } from '@/lib/reports/rankBrokers';

export type { SearchableBroker };

export function BrokerSearch({
  brokers,
  onSelect,
}: {
  brokers: SearchableBroker[];
  onSelect: (broker: SearchableBroker) => void;
}) {
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const trimmed = query.trim().toLowerCase();
  const results = useMemo(
    () => (trimmed ? brokers.filter((b) => (b.name || '').toLowerCase().includes(trimmed)) : []),
    [brokers, trimmed],
  );

  useEffect(() => {
    if (!trimmed) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setQuery('');
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [trimmed]);

  return (
    <div ref={rootRef} className="relative">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar corretor…"
        className="w-full min-h-11 pl-10 pr-3 rounded-lg bg-card-bg border border-surface-200 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-gold-200 shadow-sm"
      />
      {trimmed && (
        <div className="absolute left-0 right-0 top-full mt-2 z-20 bg-card-bg border border-surface-200 rounded-xl shadow-xl overflow-hidden p-2 space-y-1 max-h-72 overflow-y-auto">
          {results.length === 0 ? (
            <p className="text-xs text-text-secondary py-3 text-center">Nenhum corretor encontrado.</p>
          ) : (
            results.map((broker) => (
              <button
                key={broker.id}
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-transparent hover:border-gold-300 hover:bg-accent-hover transition-colors text-left"
                onClick={() => { setQuery(''); onSelect(broker); }}
              >
                <div>
                  <h4 className="font-bold text-text-primary text-sm">{broker.name}</h4>
                  <p className="text-xs text-text-secondary">
                    {broker.total} cliente{broker.total !== 1 ? 's' : ''} · {broker.vendas} venda{broker.vendas !== 1 ? 's' : ''}
                  </p>
                </div>
                <span className="text-gold-600 font-medium text-sm">Ver Relatório →</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
