import { useMemo } from 'react';
import { User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SectionHeader } from '@/components/ui/PremiumComponents';
import { useApp } from '@/context/AppContext';
import { computeHybridMetrics, ReportClientLike } from '@/lib/reports/computeHybridMetrics';
import { buildBackTarget } from '@/lib/reports/reportNav';
import { ReportBackLink } from './ReportBackLink';
import { PeriodFilters } from './PeriodFilters';
import { HybridMetricCards } from './HybridMetricCards';
import { PipelineByStage } from './PipelineByStage';
import { BrokerClientList } from './BrokerRankingCards';

export function BrokerReportView({
  brokerId,
  brokerName,
  from,
  fromId,
  fromName,
  startDate,
  endDate,
  period,
  onPeriodChange,
}: {
  brokerId: string;
  brokerName: string;
  from?: string | null;
  fromId?: string | null;
  fromName?: string | null;
  startDate: string;
  endDate: string;
  period: string;
  onPeriodChange: (period: string) => void;
}) {
  const navigate = useNavigate();
  const { allProfiles, clients } = useApp();
  const profile = allProfiles.find((p) => p.id === brokerId);
  const title = profile?.name || brokerName || 'Corretor';

  const scopedClients = useMemo(
    () => clients.filter((c) => (c as ReportClientLike).owner_id === brokerId) as ReportClientLike[],
    [clients, brokerId],
  );
  const metrics = useMemo(
    () => computeHybridMetrics(scopedClients, startDate, endDate),
    [scopedClients, startDate, endDate],
  );

  const back = buildBackTarget({
    currentScope: 'corretor',
    from,
    fromId,
    fromName,
    start: startDate,
    end: endDate,
  });

  return (
    <div className="p-6 pb-24 min-h-screen bg-surface-50">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <ReportBackLink href={back.href} label={back.label} />
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gold-100 dark:bg-gold-900/30 flex items-center justify-center">
              <User size={18} className="text-gold-600 dark:text-gold-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-text-primary">{title}</h1>
              <p className="text-xs text-text-secondary">Relatório por Corretor</p>
            </div>
          </div>
        </div>
      </div>

      <PeriodFilters period={period} onPeriodChange={onPeriodChange} />
      <HybridMetricCards metrics={metrics} />
      <PipelineByStage pipeline={metrics.pipeline} totalClientes={metrics.totalClientes} />

      <section>
        <SectionHeader title="Clientes" subtitle="Pipeline atual deste corretor" />
        <BrokerClientList clients={metrics.snapshotClients} onOpen={(id) => navigate(`/clients/${id}`)} />
      </section>
    </div>
  );
}
