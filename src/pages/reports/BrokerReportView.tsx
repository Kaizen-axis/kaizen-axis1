import { useMemo, useState } from 'react';
import { User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SectionHeader } from '@/components/ui/PremiumComponents';
import { useApp } from '@/context/AppContext';
import { logAuditEvent } from '@/services/auditLogger';
import { computeHybridMetrics, parseReportValue, ReportClientLike } from '@/lib/reports/computeHybridMetrics';
import { buildBackTarget } from '@/lib/reports/reportNav';
import { buildInsights, generateDetailedReportPdf } from '@/lib/reports/generateDetailedReportPdf';
import { toPtBrDate } from '@/lib/dateRange';
import { ReportBackLink } from './ReportBackLink';
import { HybridMetricCards } from './HybridMetricCards';
import { PipelineByStage } from './PipelineByStage';
import { ReportToolbar } from './ReportToolbar';
import { ForecastEvolution } from './ForecastEvolution';
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
  const { allProfiles, clients, userName } = useApp();
  const [pdfLoading, setPdfLoading] = useState(false);
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

  const periodLabel = `${toPtBrDate(startDate)} a ${toPtBrDate(endDate)}`;

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      const clientsForPdf = metrics.createdInPeriod.map((c) => ({
        name: c.name || 'Sem nome',
        stage: c.stage,
        value: parseReportValue(c.intendedValue ?? ''),
        updatedAt: toPtBrDate(c.createdAt),
      }));

      const pdfBytes = await generateDetailedReportPdf({
        title: 'Relatorio por Corretor',
        subtitle: title,
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
      a.download = `relatorio-corretor-${title.replace(/\s+/g, '-')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      logAuditEvent({ action: 'document_downloaded', entity: 'report', entityId: `relatorio-corretor-${brokerId}`, metadata: { type: 'relatorio_corretor', corretor: title } });
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
              <User size={18} className="text-gold-600 dark:text-gold-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-text-primary">{title}</h1>
              <p className="text-xs text-text-secondary">Relatório por Corretor</p>
            </div>
          </div>
        </div>
      </div>

      <ReportToolbar
        period={period}
        onPeriodChange={onPeriodChange}
        onDownloadPdf={handleDownloadPdf}
        pdfLabel="PDF do Corretor"
        pdfLoading={pdfLoading}
      />

      <HybridMetricCards metrics={metrics} />
      <PipelineByStage pipeline={metrics.pipeline} totalClientes={metrics.totalClientes} />

      <ForecastEvolution clients={scopedClients} />

      <section>
        <SectionHeader title="Clientes" subtitle="Clientes criados no período" />
        <BrokerClientList clients={metrics.createdInPeriod} onOpen={(id) => navigate(`/clients/${id}`)} />
      </section>
    </div>
  );
}
