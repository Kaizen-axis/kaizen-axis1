import { useMemo, useState } from 'react';
import { Shield, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PremiumCard, SectionHeader } from '@/components/ui/PremiumComponents';
import { useApp, Team } from '@/context/AppContext';
import { logAuditEvent } from '@/services/auditLogger';
import { computeHybridMetrics, parseReportValue, ReportClientLike } from '@/lib/reports/computeHybridMetrics';
import { buildBackTarget, buildReportHref } from '@/lib/reports/reportNav';
import { getTeamMemberIds, isActiveProfile } from '@/lib/reports/teamMembers';
import { rankBrokers, sortBrokersForReport } from '@/lib/reports/rankBrokers';
import { buildInsights, generateDetailedReportPdf } from '@/lib/reports/generateDetailedReportPdf';
import { toPtBrDate } from '@/lib/dateRange';
import { ReportBackLink } from './ReportBackLink';
import { HybridMetricCards } from './HybridMetricCards';
import { PipelineByStage } from './PipelineByStage';
import { ReportToolbar } from './ReportToolbar';
import { ForecastEvolution } from './ForecastEvolution';

export function TeamReportView({
  team, startDate, endDate, period, onPeriodChange,
}: {
  team: Team;
  startDate: string;
  endDate: string;
  period: string;
  onPeriodChange: (period: string) => void;
}) {
  const navigate = useNavigate();
  const { allProfiles, clients, directorates, userName } = useApp();
  const [pdfLoading, setPdfLoading] = useState(false);

  const memberIds = useMemo(() => getTeamMemberIds(team, allProfiles), [team, allProfiles]);
  const directorate = directorates.find((d) => d.id === team.directorate_id);

  const scopedClients = useMemo(
    () => clients.filter((c) => memberIds.includes((c as ReportClientLike).owner_id || '')) as ReportClientLike[],
    [clients, memberIds],
  );
  const metrics = useMemo(
    () => computeHybridMetrics(scopedClients, startDate, endDate),
    [scopedClients, startDate, endDate],
  );

  const teamBrokers = useMemo(
    () => allProfiles.filter((p) => memberIds.includes(p.id) && p.role?.toUpperCase() === 'CORRETOR' && isActiveProfile(p)),
    [allProfiles, memberIds],
  );
  const brokerRanking = useMemo(
    () => rankBrokers(teamBrokers, scopedClients, startDate, endDate),
    [teamBrokers, scopedClients, startDate, endDate],
  );

  const coordinators = useMemo(
    () => allProfiles.filter((p) => {
      if (p.role?.toUpperCase() !== 'COORDENADOR' || !isActiveProfile(p)) return false;
      if (team.manager_id && p.manager_id === team.manager_id) return true;
      return memberIds.includes(p.id);
    }),
    [allProfiles, team.manager_id, memberIds],
  );

  const unassignedBrokers = useMemo(
    () => teamBrokers.filter((p) => !p.coordinator_id),
    [teamBrokers],
  );

  const back = buildBackTarget({
    currentScope: 'equipe',
    directorateId: team.directorate_id,
    directorateName: directorate?.name,
    start: startDate,
    end: endDate,
  });

  const openBroker = (broker: { id: string; name: string }) => {
    navigate(buildReportHref({
      scope: 'corretor',
      id: broker.id,
      name: broker.name,
      from: 'equipe',
      fromId: team.id,
      fromName: team.name,
      start: startDate,
      end: endDate,
    }));
  };

  const periodLabel = `${toPtBrDate(startDate)} a ${toPtBrDate(endDate)}`;

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      const teamsForPdf = coordinators.map((coord) => {
        const coordBrokerIds = allProfiles
          .filter((p) => p.role?.toUpperCase() === 'CORRETOR' && p.coordinator_id === coord.id && isActiveProfile(p))
          .map((p) => p.id);
        const coordMemberIds = [coord.id, ...coordBrokerIds];
        const coordClients = scopedClients.filter((c) => coordMemberIds.includes(c.owner_id || ''));
        const coordMetrics = computeHybridMetrics(coordClients, startDate, endDate);
        return {
          name: coord.name,
          clientes: coordMetrics.totalClientes,
          vendas: coordMetrics.vendas,
          aprovados: coordMetrics.aprovados,
          vgv: coordMetrics.vgv,
          membros: coordMemberIds.length,
        };
      });

      const brokersForPdf = sortBrokersForReport(brokerRanking).map((b) => ({
        name: b.name,
        clientes: b.total,
        vendas: b.vendas,
        aprovados: b.aprovados,
        vgv: b.vgv,
      }));

      const clientsForPdf = metrics.createdInPeriod.map((c) => ({
        name: c.name || 'Sem nome',
        stage: c.stage,
        value: parseReportValue(c.intendedValue ?? ''),
        updatedAt: toPtBrDate(c.createdAt),
      }));

      const pdfBytes = await generateDetailedReportPdf({
        title: 'Relatorio por Equipe',
        subtitle: team.name,
        periodLabel,
        generatedBy: userName,
        kpis: {
          totalClientes: metrics.totalClientes,
          createdInPeriod: metrics.createdInPeriodCount,
          vendas: metrics.vendas,
          aprovados: metrics.aprovados,
          taxaConversao: metrics.taxaConversao,
          vgv: metrics.vgv,
        },
        pipeline: metrics.pipeline,
        stageDistribution: metrics.pipeline.map((p) => ({ name: p.stage, value: p.count })),
        teams: teamsForPdf,
        brokers: brokersForPdf,
        clients: clientsForPdf,
        insights: buildInsights(
          {
            totalClientes: metrics.totalClientes,
            createdInPeriod: metrics.createdInPeriodCount,
            vendas: metrics.vendas,
            aprovados: metrics.aprovados,
            taxaConversao: metrics.taxaConversao,
            vgv: metrics.vgv,
          },
          metrics.pipeline,
        ),
      });

      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio-equipe-${team.name.replace(/\s+/g, '-')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      logAuditEvent({ action: 'document_downloaded', entity: 'report', entityId: `relatorio-equipe-${team.name}`, metadata: { type: 'relatorio_equipe', team: team.name } });
    } catch (err: any) {
      alert(`Erro ao gerar PDF: ${err.message}`);
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="p-6 pb-24 min-h-screen bg-surface-50">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <ReportBackLink href={back.href} label={back.label} />
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gold-100 dark:bg-gold-900/30 flex items-center justify-center">
              <Shield size={18} className="text-gold-600 dark:text-gold-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-text-primary">{team.name}</h1>
              <p className="text-xs text-text-secondary">Relatório por Equipe</p>
            </div>
          </div>
        </div>
      </div>

      <ReportToolbar
        brokers={brokerRanking}
        onSelectBroker={openBroker}
        period={period}
        onPeriodChange={onPeriodChange}
        onDownloadPdf={handleDownloadPdf}
        pdfLabel="PDF da Equipe"
        pdfLoading={pdfLoading}
      />

      <HybridMetricCards metrics={metrics} />
      <PipelineByStage pipeline={metrics.pipeline} totalClientes={metrics.totalClientes} />

      <ForecastEvolution clients={scopedClients} />

      <section className="mb-6">
        <SectionHeader title="Visão por Coordenação" subtitle="Métricas e corretores de cada coordenação da equipe" />
        {coordinators.length === 0 && unassignedBrokers.length === 0 ? (
          <PremiumCard className="text-center py-8">
            <p className="text-text-secondary text-sm">Nenhuma coordenação vinculada a esta equipe.</p>
          </PremiumCard>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {coordinators.map((coord) => {
              const coordBrokerIds = allProfiles
                .filter((p) => p.role?.toUpperCase() === 'CORRETOR' && p.coordinator_id === coord.id && isActiveProfile(p))
                .map((p) => p.id);
              const coordMemberIds = [coord.id, ...coordBrokerIds];
              const coordClients = scopedClients.filter((c) => coordMemberIds.includes(c.owner_id || ''));
              const coordMetrics = computeHybridMetrics(coordClients, startDate, endDate);
              return (
                <PremiumCard
                  key={coord.id}
                  className="flex items-center justify-between p-4 cursor-pointer hover:border-purple-300 transition-colors"
                  onClick={() => navigate(buildReportHref({
                    scope: 'coordenacao',
                    id: coord.id,
                    name: coord.name,
                    from: 'equipe',
                    fromId: team.id,
                    fromName: team.name,
                    start: startDate,
                    end: endDate,
                  }))}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                      <Users size={20} className="text-purple-500" />
                    </div>
                    <div>
                      <h4 className="font-bold text-text-primary">{coord.name}</h4>
                      <p className="text-xs text-text-secondary">{coordBrokerIds.length} corretor{coordBrokerIds.length !== 1 ? 'es' : ''}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-text-secondary">{coordMetrics.totalClientes} clientes</p>
                    <p className="text-xs font-bold text-green-600">{coordMetrics.vendas} vendas</p>
                  </div>
                </PremiumCard>
              );
            })}
            {unassignedBrokers.length > 0 && (
              <PremiumCard className="p-4">
                <h4 className="font-bold text-text-primary mb-2">Sem coordenação</h4>
                <p className="text-xs text-text-secondary mb-3">{unassignedBrokers.length} corretor{unassignedBrokers.length !== 1 ? 'es' : ''} sem coordenador</p>
                <div className="space-y-2">
                  {rankBrokers(unassignedBrokers, scopedClients, startDate, endDate).map((broker) => (
                    <button
                      key={broker.id}
                      onClick={() => openBroker(broker)}
                      className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg border border-surface-200 hover:border-gold-300 transition-colors"
                    >
                      <span className="text-sm font-medium text-text-primary">{broker.name}</span>
                      <span className="text-xs text-text-secondary">{broker.total} clientes · {broker.vendas} vendas</span>
                    </button>
                  ))}
                </div>
              </PremiumCard>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
