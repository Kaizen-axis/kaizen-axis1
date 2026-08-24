import { useMemo, useState } from 'react';
import { Building2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SectionHeader, PremiumCard } from '@/components/ui/PremiumComponents';
import { useApp } from '@/context/AppContext';
import { logAuditEvent } from '@/services/auditLogger';
import { toPtBrDate } from '@/lib/dateRange';
import { computeHybridMetrics, parseReportValue, ReportClientLike } from '@/lib/reports/computeHybridMetrics';
import { buildBackTarget, buildReportHref } from '@/lib/reports/reportNav';
import { getTeamMemberIds, isActiveProfile } from '@/lib/reports/teamMembers';
import { rankBrokers, sortBrokersForReport } from '@/lib/reports/rankBrokers';
import { buildInsights, generateDetailedReportPdf } from '@/lib/reports/generateDetailedReportPdf';
import { ReportBackLink } from './ReportBackLink';
import { HybridMetricCards } from './HybridMetricCards';
import { PipelineByStage } from './PipelineByStage';
import { ReportToolbar } from './ReportToolbar';
import { ForecastEvolution } from './ForecastEvolution';
import { TeamCardGrid } from './TeamCardGrid';

export function DiretoriaReportView({
  dirId, dirName, startDate, endDate, period, onPeriodChange,
}: {
  dirId: string;
  dirName: string;
  startDate: string;
  endDate: string;
  period: string;
  onPeriodChange: (period: string) => void;
}) {
  const navigate = useNavigate();
  const { clients, teams, allProfiles, userName } = useApp();
  const [pdfLoading, setPdfLoading] = useState(false);

  const dirTeams = useMemo(() => teams.filter((t) => t.directorate_id === dirId), [teams, dirId]);
  const dirTeamIds = useMemo(() => new Set(dirTeams.map((t) => t.id)), [dirTeams]);

  const dirScopedClients = useMemo(
    () => clients.filter((c) => (c as ReportClientLike).directorate_id === dirId) as ReportClientLike[],
    [clients, dirId],
  );
  const metrics = useMemo(
    () => computeHybridMetrics(dirScopedClients, startDate, endDate),
    [dirScopedClients, startDate, endDate],
  );

  const dirBrokers = useMemo(
    () => allProfiles.filter((p) => {
      if (p.role?.toUpperCase() !== 'CORRETOR' || !isActiveProfile(p)) return false;
      if (p.directorate_id === dirId) return true;
      return !!(p.team_id && dirTeamIds.has(p.team_id));
    }),
    [allProfiles, dirId, dirTeamIds],
  );
  const brokerRanking = useMemo(
    () => rankBrokers(dirBrokers, dirScopedClients, startDate, endDate),
    [dirBrokers, dirScopedClients, startDate, endDate],
  );

  const back = buildBackTarget({ currentScope: 'diretoria', start: startDate, end: endDate });

  const openBroker = (broker: { id: string; name: string }) => {
    navigate(buildReportHref({
      scope: 'corretor',
      id: broker.id,
      name: broker.name,
      from: 'diretoria',
      fromId: dirId,
      fromName: dirName,
      start: startDate,
      end: endDate,
    }));
  };

  const periodLabel = `${toPtBrDate(startDate)} a ${toPtBrDate(endDate)}`;

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      const teamsForPdf = dirTeams.map((team) => {
        const memberIds = getTeamMemberIds(team, allProfiles);
        const teamClients = dirScopedClients.filter((c) => memberIds.includes(c.owner_id || ''));
        const teamMetrics = computeHybridMetrics(teamClients, startDate, endDate);
        return {
          name: team.name,
          clientes: teamMetrics.totalClientes,
          vendas: teamMetrics.vendas,
          aprovados: teamMetrics.aprovados,
          vgv: teamMetrics.vgv,
          membros: memberIds.length,
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
        title: 'Relatorio por Diretoria',
        subtitle: dirName,
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
      a.download = `relatorio-diretoria-${dirName.replace(/\s+/g, '-')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      logAuditEvent({ action: 'document_downloaded', entity: 'report', entityId: `relatorio-diretoria-${dirName}`, metadata: { type: 'relatorio_diretoria', diretoria: dirName } });
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
              <Building2 size={18} className="text-gold-600 dark:text-gold-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-text-primary">{dirName}</h1>
              <p className="text-xs text-text-secondary">Relatório por Diretoria</p>
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
        pdfLabel="PDF da Diretoria"
        pdfLoading={pdfLoading}
      />

      <HybridMetricCards metrics={metrics} />
      <PipelineByStage pipeline={metrics.pipeline} totalClientes={metrics.totalClientes} />

      <ForecastEvolution clients={dirScopedClients} />

      <section>
        <SectionHeader title="Relatório por Equipe" subtitle="Análise segmentada por equipe da diretoria" />
        {dirTeams.length === 0 ? (
          <PremiumCard className="text-center py-8">
            <p className="text-text-secondary text-sm">Nenhuma equipe vinculada a esta diretoria.</p>
          </PremiumCard>
        ) : (
          <TeamCardGrid
            teams={dirTeams}
            clients={dirScopedClients}
            startDate={startDate}
            endDate={endDate}
            from="diretoria"
            fromId={dirId}
            fromName={dirName}
          />
        )}
      </section>
    </div>
  );
}
