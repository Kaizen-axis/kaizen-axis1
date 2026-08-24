import { Target, TrendingUp, Users } from 'lucide-react';
import { PremiumCard } from '@/components/ui/PremiumComponents';
import { brl, HybridMetrics } from '@/lib/reports/computeHybridMetrics';

export function HybridMetricCards({ metrics }: { metrics: HybridMetrics }) {
  const convColor = metrics.taxaConversao >= 60
    ? 'text-green-500'
    : metrics.taxaConversao >= 30
      ? 'text-amber-400'
      : 'text-red-500';

  return (
    <section className="grid grid-cols-2 gap-3 mb-6">
      <PremiumCard className="flex flex-col gap-1">
        <p className="text-[10px] text-text-secondary uppercase tracking-wide">Total Clientes</p>
        <div className="flex items-end gap-2 mt-1">
          <Users size={18} className="text-gold-500 mb-0.5" />
          <h3 className="font-ui text-2xl font-bold text-text-primary">{metrics.totalClientes}</h3>
        </div>
        <p className="text-[10px] text-text-secondary">pipeline atual</p>
      </PremiumCard>

      <PremiumCard className="flex flex-col gap-1">
        <p className="text-[10px] text-text-secondary uppercase tracking-wide">Vendas Concluídas</p>
        <div className="flex items-end gap-2 mt-1">
          <TrendingUp size={18} className="text-green-500 mb-0.5" />
          <h3 className="font-ui text-2xl font-bold text-text-primary">{metrics.vendas}</h3>
        </div>
        <p className="text-[10px] text-text-secondary">no período</p>
      </PremiumCard>

      <PremiumCard className="flex flex-col gap-1">
        <p className="text-[10px] text-text-secondary uppercase tracking-wide">Aprovados</p>
        <div className="flex items-end gap-2 mt-1">
          <TrendingUp size={18} className="text-blue-500 mb-0.5" />
          <h3 className="font-ui text-2xl font-bold text-green-600">{metrics.aprovados}</h3>
        </div>
        <p className="text-[10px] text-text-secondary">no período</p>
      </PremiumCard>

      <PremiumCard className="flex flex-col gap-1">
        <p className="text-[10px] text-text-secondary uppercase tracking-wide">Taxa de Conversão</p>
        <div className="flex items-end gap-2 mt-1">
          <Target size={18} className="text-blue-500 mb-0.5" />
          <h3 className={`font-ui text-2xl font-bold ${convColor}`}>{metrics.taxaConversao}%</h3>
        </div>
        <p className="text-[10px] text-text-secondary">no período</p>
      </PremiumCard>

      <PremiumCard highlight className="col-span-2 flex flex-col gap-1">
        <p className="text-[10px] text-gold-700 dark:text-gold-400 uppercase tracking-wide">VGV Concluído</p>
        <h3 className="font-ui text-2xl font-bold text-text-primary mt-1">{brl(metrics.vgv)}</h3>
        <p className="text-[10px] text-text-secondary">no período</p>
      </PremiumCard>
    </section>
  );
}
