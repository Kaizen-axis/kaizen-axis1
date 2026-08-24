import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { logAuditEvent } from '@/services/auditLogger';
import { computeHybridMetrics, parseReportValue, ReportClientLike } from '@/lib/reports/computeHybridMetrics';
import { buildBackTarget, buildReportHref } from '@/lib/reports/reportNav';
import { isActiveProfile } from '@/lib/reports/teamMembers';
import { rankBrokers } from '@/lib/reports/rankBrokers';
import { buildInsights, generateDetailedReportPdf } from '@/lib/reports/generateDetailedReportPdf';
import { toPtBrDate } from '@/lib/dateRange';
import { ReportBackLink } from './ReportBackLink';
import { HybridMetricCards } from './HybridMetricCards';
import { PipelineByStage } from './PipelineByStage';
import { ReportToolbar } from './ReportToolbar';
import { ForecastEvolution } from './ForecastEvolution';
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
  const { allProfiles, clients, teams, userName } = useApp();
  const [pdfLoading, setPdfLoading] = useState(false);

  const brokerProfiles = useMemo(
    () => allProfiles.filter((p) => p.role?.toUpperCase() === 'CORRETOR' && p.coordinator_id === coordId && isActiveProfile(p)),
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

  const openBroker = (broker: { id: string; name: string }) => {
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

  const periodLabel = `${toPtBrDate(startDate)} a ${toPtBrDate(endDate)}`;

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      const brokersForPdf = brokerRanking.map((b) => ({
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
        title: 'Relatorio por Coordenacao',
        subtitle: coordName,
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
      a.download = `relatorio-coordenacao-${coordName.replace(/\s+/g, '-')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      logAuditEvent({ action: 'document_downloaded', entity: 'report', entityId: `relatorio-coordenacao-${coordId}`, metadata: { type: 'relatorio_coordenacao', coordenacao: coordName } });
    } catch (err: any) {
      alert(`Erro ao gerar PDF: ${err.message}`);
    } finally {
      setPdfLoading(false);
    }
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

      <ReportToolbar
        brokers={brokerRanking}
        onSelectBroker={openBroker}
        period={period}
        onPeriodChange={onPeriodChange}
        onDownloadPdf={handleDownloadPdf}
        pdfLabel="PDF da Coordenação"
        pdfLoading={pdfLoading}
      />

      <HybridMetricCards metrics={metrics} />
      <PipelineByStage pipeline={metrics.pipeline} totalClientes={metrics.totalClientes} />

      <ForecastEvolution clients={scopedClients} />

      <BrokerRankingCards brokers={brokerRanking} onSelect={openBroker} />
    </div>
  );
}
