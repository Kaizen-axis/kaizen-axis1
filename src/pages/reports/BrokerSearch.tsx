import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { PremiumCard } from '@/components/ui/PremiumComponents';
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
  const trimmed = query.trim().toLowerCase();
  const results = useMemo(
    () => (trimmed ? brokers.filter((b) => (b.name || '').toLowerCase().includes(trimmed)) : []),
    [brokers, trimmed],
  );

  return (
    <section className="mb-6 print:hidden">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar corretor…"
          className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-card-bg border border-surface-200 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-gold-200"
        />
      </div>
      {trimmed && (
        <div className="mt-2 space-y-2">
          {results.length === 0 ? (
            <p className="text-xs text-text-secondary py-3 text-center">Nenhum corretor encontrado.</p>
          ) : (
            results.map((broker) => (
              <PremiumCard
                key={broker.id}
                className="flex items-center justify-between p-3 cursor-pointer hover:border-gold-300 transition-colors"
                onClick={() => onSelect(broker)}
              >
                <div>
                  <h4 className="font-bold text-text-primary text-sm">{broker.name}</h4>
                  <p className="text-xs text-text-secondary">
                    {broker.total} cliente{broker.total !== 1 ? 's' : ''} · {broker.vendas} venda{broker.vendas !== 1 ? 's' : ''}
                  </p>
                </div>
                <span className="text-gold-600 font-medium text-sm">Ver Relatório →</span>
              </PremiumCard>
            ))
          )}
        </div>
      )}
    </section>
  );
}
