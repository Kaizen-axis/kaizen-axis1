import { ChevronRight } from 'lucide-react';
import { PremiumCard, SectionHeader, StatusBadge } from '@/components/ui/PremiumComponents';
import { CircularScore } from '@/components/reports/CircularScore';
import { ReportClientLike } from '@/lib/reports/computeHybridMetrics';
import { SearchableBroker } from './BrokerSearch';

export function BrokerRankingCards({
  brokers,
  onSelect,
  subtitle = 'Clique para ver o relatório do corretor',
}: {
  brokers: SearchableBroker[];
  onSelect: (broker: SearchableBroker) => void;
  subtitle?: string;
}) {
  return (
    <section>
      <SectionHeader title="Corretores" subtitle={subtitle} />
      {brokers.length === 0 ? (
        <PremiumCard className="text-center py-8">
          <p className="text-text-secondary text-sm">Nenhum corretor neste escopo.</p>
        </PremiumCard>
      ) : (
        <div className="space-y-2">
          {brokers.map((broker, i) => {
            const score = broker.total > 0 ? Math.min(100, Math.round((broker.vendas / broker.total) * 100)) : 0;
            return (
              <PremiumCard
                key={broker.id}
                className="flex items-center justify-between p-4 cursor-pointer hover:border-gold-300 transition-all"
                onClick={() => onSelect(broker)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-gold-100 dark:bg-gold-900/40 flex items-center justify-center text-xs font-bold text-gold-700">
                    {i + 1}
                  </div>
                  <CircularScore score={score} />
                  <div>
                    <h4 className="font-bold text-text-primary text-sm">{broker.name}</h4>
                    <p className="text-xs text-text-secondary">{broker.total} cliente{broker.total !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-bold text-green-600">{broker.vendas} vendas</p>
                    <p className="text-xs text-text-secondary">{score}% conv.</p>
                  </div>
                  <ChevronRight size={16} className="text-text-secondary" />
                </div>
              </PremiumCard>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function BrokerClientList({ clients, onOpen }: {
  clients: ReportClientLike[];
  onOpen: (id: string) => void;
}) {
  if (clients.length === 0) {
    return <p className="text-sm text-text-secondary text-center py-8">Nenhum cliente neste pipeline.</p>;
  }
  return (
    <div className="space-y-2">
      {clients.map((client) => (
        <div
          key={client.id}
          onClick={() => onOpen(client.id)}
          className="flex items-center justify-between bg-card-bg rounded-xl px-3 py-2.5 cursor-pointer hover:bg-accent-hover hover:border-gold-200 border border-surface-100 transition-all"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{client.name}</p>
            <p className="text-xs text-text-secondary truncate">{client.development || 'Sem empreendimento'}</p>
          </div>
          <div className="flex items-center gap-2 ml-2 flex-shrink-0">
            <StatusBadge status={client.stage} />
            <ChevronRight size={14} className="text-text-secondary" />
          </div>
        </div>
      ))}
    </div>
  );
}
