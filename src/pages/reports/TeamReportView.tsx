import { useMemo, useState } from 'react';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { FileText, Loader2, MoreHorizontal, Shield, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PremiumCard, SectionHeader } from '@/components/ui/PremiumComponents';
import { useApp, Team } from '@/context/AppContext';
import { logAuditEvent } from '@/services/auditLogger';
import { loadKaizenLogo, drawReportHeader, addStandardFooters } from '@/lib/pdf/reportKit';
import { computeHybridMetrics, ReportClientLike } from '@/lib/reports/computeHybridMetrics';
import { buildBackTarget, buildReportHref } from '@/lib/reports/reportNav';
import { getTeamMemberIds } from '@/lib/reports/teamMembers';
import { rankBrokers } from '@/lib/reports/rankBrokers';
import { ReportBackLink } from './ReportBackLink';
import { PeriodFilters } from './PeriodFilters';
import { HybridMetricCards } from './HybridMetricCards';
import { PipelineByStage } from './PipelineByStage';
import { BrokerSearch, SearchableBroker } from './BrokerSearch';

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
  const { allProfiles, clients, directorates } = useApp();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);

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
    () => allProfiles.filter((p) => memberIds.includes(p.id) && p.role?.toUpperCase() === 'CORRETOR'),
    [allProfiles, memberIds],
  );
  const brokerRanking = useMemo(
    () => rankBrokers(teamBrokers, scopedClients, startDate, endDate),
    [teamBrokers, scopedClients, startDate, endDate],
  );

  const coordinators = useMemo(
    () => allProfiles.filter((p) => {
      if (p.role?.toUpperCase() !== 'COORDENADOR') return false;
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

  const openBroker = (broker: SearchableBroker) => {
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

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      const pdfDoc = await PDFDocument.create();
      const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const logoImg = await loadKaizenLogo(pdfDoc);
      const PAGE_W = 595, PAGE_H = 842, MARGIN = 36;
      const COL_W = PAGE_W - MARGIN * 2;
      const ROW_H = 18;
      const HDR_H = 20;
      const gold = rgb(0.145, 0.388, 0.922);
      const dark = rgb(0.10, 0.10, 0.10);
      const gray = rgb(0.45, 0.45, 0.45);
      const light = rgb(0.96, 0.96, 0.96);
      const white = rgb(1, 1, 1);
      const brlFmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

      let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      let y = PAGE_H - MARGIN;

      const addContinuationPage = (label: string) => {
        page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
        page.drawText(label, { x: MARGIN, y, size: 8, font: regular, color: gray });
        y -= 14;
      };
      const ensureSpace = (needed: number, continuationLabel = 'Relatorio por Equipe (continuacao)') => {
        if (y < MARGIN + needed) addContinuationPage(continuationLabel);
      };

      y = drawReportHeader(page, { regular, bold }, logoImg, { title: 'Relatório por Equipe', subtitle: `Equipe: ${team.name}` });
      page.drawText('RESUMO DA EQUIPE', { x: MARGIN, y, size: 10, font: bold, color: gold });
      y -= 18;
      for (const [label, value] of [
        ['Total de Clientes (pipeline)', String(metrics.totalClientes)],
        ['Vendas Concluidas', String(metrics.vendas)],
        ['Aprovados', String(metrics.aprovados)],
        ['Taxa de Conversao', `${metrics.taxaConversao}%`],
        ['VGV Concluido', brlFmt(metrics.vgv)],
      ] as [string, string][]) {
        page.drawText(`${label}:`, { x: MARGIN, y, size: 9, font: bold, color: dark });
        page.drawText(value, { x: MARGIN + 190, y, size: 9, font: regular, color: dark });
        y -= 14;
      }

      addStandardFooters(pdfDoc, { regular, bold });
      const pdfBytes = await pdfDoc.save();
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

      <PeriodFilters period={period} onPeriodChange={onPeriodChange} />

      <div className="print:hidden flex justify-end mb-4 relative">
        <button
          onClick={() => setIsActionsMenuOpen((v) => !v)}
          className="h-9 w-9 flex items-center justify-center rounded-lg border border-surface-200 bg-card-bg text-text-secondary hover:text-gold-700 hover:border-gold-300 shadow-sm transition-all"
        >
          <MoreHorizontal size={18} />
        </button>
        {isActionsMenuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setIsActionsMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-2 z-20 w-56 bg-card-bg border border-surface-200 rounded-xl shadow-xl overflow-hidden p-2">
              <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-text-secondary">Exportar relatório</p>
              <button
                onClick={() => { setIsActionsMenuOpen(false); handleDownloadPdf(); }}
                disabled={pdfLoading}
                className="w-full flex items-center gap-2 px-2.5 py-2 border border-surface-200 rounded-lg text-text-secondary text-[11px] font-semibold hover:text-gold-700 hover:bg-gold-50 transition-colors disabled:opacity-50"
              >
                {pdfLoading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} PDF da Equipe
              </button>
            </div>
          </>
        )}
      </div>

      <HybridMetricCards metrics={metrics} />
      <PipelineByStage pipeline={metrics.pipeline} totalClientes={metrics.totalClientes} />
      <BrokerSearch brokers={brokerRanking} onSelect={openBroker} />

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
                .filter((p) => p.role?.toUpperCase() === 'CORRETOR' && p.coordinator_id === coord.id)
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
