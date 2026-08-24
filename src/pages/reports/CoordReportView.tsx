import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { computeHybridMetrics, ReportClientLike } from '@/lib/reports/computeHybridMetrics';
import { buildBackTarget, buildReportHref } from '@/lib/reports/reportNav';
import { rankBrokers } from '@/lib/reports/rankBrokers';
import { ReportBackLink } from './ReportBackLink';
import { PeriodFilters } from './PeriodFilters';
import { HybridMetricCards } from './HybridMetricCards';
import { PipelineByStage } from './PipelineByStage';
import { BrokerSearch, SearchableBroker } from './BrokerSearch';
import { BrokerRankingCards } from './BrokerRankingCards';

export function CoordReportView({
  coordId, coordName, from, fromId, fromName, startDate, endDate, period, onPeriodChange,
}: {
  coordId: string;
  coordName: string;
  from?: string | null;
  fromId?: string | null;
  fromName?: string | null;
  startDate: string;
  endDate: string;
  period: string;
  onPeriodChange: (period: string) => void;
}) {
  const navigate = useNavigate();
  const { allProfiles, clients, teams } = useApp();

  const brokerProfiles = useMemo(
    () => allProfiles.filter((p) => p.role?.toUpperCase() === 'CORRETOR' && p.coordinator_id === coordId),
    [allProfiles, coordId],
  );
  const memberIds = useMemo(
    () => Array.from(new Set([coordId, ...brokerProfiles.map((p) => p.id)])),
    [coordId, brokerProfiles],
  );

  const scopedClients = useMemo(
    () => clients.filter((c) => memberIds.includes((c as ReportClientLike).owner_id || '')) as ReportClientLike[],
    [clients, memberIds],
  );
  const metrics = useMemo(
    () => computeHybridMetrics(scopedClients, startDate, endDate),
    [scopedClients, startDate, endDate],
  );
  const brokerRanking = useMemo(
    () => rankBrokers(brokerProfiles, scopedClients, startDate, endDate),
    [brokerProfiles, scopedClients, startDate, endDate],
  );

  const coordProfile = allProfiles.find((p) => p.id === coordId);
  const inferredTeam = teams.find((t) => t.manager_id && t.manager_id === coordProfile?.manager_id);

  const back = buildBackTarget({
    currentScope: 'coordenacao',
    from: from || (inferredTeam ? 'equipe' : undefined),
    fromId: fromId || inferredTeam?.id,
    fromName: fromName || inferredTeam?.name,
    start: startDate,
    end: endDate,
  });

  const openBroker = (broker: SearchableBroker) => {
    navigate(buildReportHref({
      scope: 'corretor',
      id: broker.id,
      name: broker.name,
      from: 'coordenacao',
      fromId: coordId,
      fromName: coordName,
      start: startDate,
      end: endDate,
    }));
  };

  return (
    <div className="p-6 pb-24 min-h-screen bg-surface-50">
      <div className="flex items-start justify-between mb-6 gap-3">
        <div>
          <ReportBackLink href={back.href} label={back.label} />
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <Users size={18} className="text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-text-primary">{coordName}</h1>
              <p className="text-xs text-text-secondary">Relatório por Coordenação</p>
            </div>
          </div>
        </div>
      </div>

      <PeriodFilters period={period} onPeriodChange={onPeriodChange} />
      <HybridMetricCards metrics={metrics} />
      <PipelineByStage pipeline={metrics.pipeline} totalClientes={metrics.totalClientes} />
      <BrokerSearch brokers={brokerRanking} onSelect={openBroker} />
      <BrokerRankingCards brokers={brokerRanking} onSelect={openBroker} />
    </div>
  );
}
