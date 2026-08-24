import { useMemo, useState } from 'react';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Building2, FileText, Loader2, MoreHorizontal, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PremiumCard, SectionHeader } from '@/components/ui/PremiumComponents';
import { useApp } from '@/context/AppContext';
import { logAuditEvent } from '@/services/auditLogger';
import { loadKaizenLogo, drawReportHeader, addStandardFooters } from '@/lib/pdf/reportKit';
import { STAGE_WEIGHTS } from '@/types/reports';
import { toPtBrDate } from '@/lib/dateRange';
import { brl, computeHybridMetrics, parseReportValue, ReportClientLike } from '@/lib/reports/computeHybridMetrics';
import { buildBackTarget, buildReportHref } from '@/lib/reports/reportNav';
import { getTeamMemberIds } from '@/lib/reports/teamMembers';
import { rankBrokers } from '@/lib/reports/rankBrokers';
import { ReportBackLink } from './ReportBackLink';
import { PeriodFilters } from './PeriodFilters';
import { HybridMetricCards } from './HybridMetricCards';
import { PipelineByStage } from './PipelineByStage';
import { BrokerSearch, SearchableBroker } from './BrokerSearch';

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
  const { clients, teams, allProfiles } = useApp();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);

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
      if (p.role?.toUpperCase() !== 'CORRETOR') return false;
      if (p.directorate_id === dirId) return true;
      return !!(p.team_id && dirTeamIds.has(p.team_id));
    }),
    [allProfiles, dirId, dirTeamIds],
  );
  const brokerRanking = useMemo(
    () => rankBrokers(dirBrokers, dirScopedClients, startDate, endDate),
    [dirBrokers, dirScopedClients, startDate, endDate],
  );

  const { weightedPipeline, forecastTotal } = useMemo(() => {
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    let totalWeightedBRL = 0;
    const pipeline = months.map((m, i) => {
      const mc = dirScopedClients.filter((c) => new Date(c.createdAt).getMonth() === i);
      const weighted = mc.reduce((acc, c) => acc + parseReportValue(c.intendedValue ?? '') * (STAGE_WEIGHTS[c.stage] ?? 0), 0);
      const confirmed = dirScopedClients
        .filter((c) => {
          if (c.stage !== 'Concluído' || !c.closed_at) return false;
          return new Date(c.closed_at).getMonth() === i;
        })
        .reduce((acc, c) => acc + parseReportValue(c.intendedValue ?? ''), 0);
      totalWeightedBRL += weighted;
      return { month: m, weighted: weighted / 1000, confirmed: confirmed / 1000 };
    });
    return { weightedPipeline: pipeline, forecastTotal: totalWeightedBRL };
  }, [dirScopedClients]);

  const back = buildBackTarget({ currentScope: 'diretoria', start: startDate, end: endDate });

  const openBroker = (broker: SearchableBroker) => {
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

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      const pdfDoc = await PDFDocument.create();
      const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const logoImg = await loadKaizenLogo(pdfDoc);
      const PAGE_W = 595, PAGE_H = 842, MARGIN = 36;
      const TABLE_W = PAGE_W - MARGIN * 2;
      const ROW_H = 18;
      const HDR_H = 20;
      const gold = rgb(0.145, 0.388, 0.922);
      const dark = rgb(0.1, 0.1, 0.1);
      const gray = rgb(0.45, 0.45, 0.45);
      const light = rgb(0.96, 0.96, 0.96);
      const white = rgb(1, 1, 1);

      let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      let y = PAGE_H - MARGIN;
      const addContinuationPage = (label: string) => {
        page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
        page.drawText(label, { x: MARGIN, y, size: 8, font: regular, color: gray });
        y -= 14;
      };
      const ensureSpace = (needed: number) => {
        if (y < MARGIN + needed) addContinuationPage('Relatorio por Diretoria (continuacao)');
      };

      const rows = dirTeams.map((team) => {
        const memberIds = getTeamMemberIds(team, allProfiles);
        const teamClients = dirScopedClients.filter((c) => memberIds.includes(c.owner_id || ''));
        const teamMetrics = computeHybridMetrics(teamClients, startDate, endDate);
        return {
          equipe: team.name,
          clientes: teamMetrics.totalClientes,
          vendas: teamMetrics.vendas,
          conversao: teamMetrics.taxaConversao,
          receita: teamMetrics.vgv,
        };
      }).sort((a, b) => b.vendas - a.vendas || b.receita - a.receita);

      y = drawReportHeader(page, { regular, bold }, logoImg, {
        title: 'Relatório por Diretoria',
        subtitle: `Diretoria: ${dirName} · Período: ${toPtBrDate(startDate)} a ${toPtBrDate(endDate)}`,
      });
      page.drawText('RESUMO', { x: MARGIN, y, size: 10, font: bold, color: gold });
      y -= 18;
      for (const [label, value] of [
        ['Total de Clientes (pipeline)', String(metrics.totalClientes)],
        ['Vendas Concluidas', String(metrics.vendas)],
        ['Aprovados', String(metrics.aprovados)],
        ['Taxa de Conversao', `${metrics.taxaConversao}%`],
        ['VGV Concluido', brl(metrics.vgv)],
        ['Receita Ponderada (Pipeline)', brl(forecastTotal)],
      ] as [string, string][]) {
        page.drawText(`${label}:`, { x: MARGIN, y, size: 9, font: bold, color: dark });
        page.drawText(value, { x: MARGIN + 190, y, size: 9, font: regular, color: dark });
        y -= 14;
      }
      y -= 8;
      page.drawRectangle({ x: MARGIN, y, width: TABLE_W, height: 0.5, color: rgb(0.85, 0.85, 0.85) });
      y -= 16;

      const columns = [
        { header: 'Equipe', width: 220 },
        { header: 'Clientes', width: 75 },
        { header: 'Vendas', width: 70 },
        { header: 'Conv.%', width: 65 },
        { header: 'Receita', width: 125 },
      ];
      const drawTableHeader = () => {
        page.drawRectangle({ x: MARGIN, y: y - HDR_H, width: TABLE_W, height: HDR_H, color: gold });
        let cx = MARGIN + 4;
        columns.forEach((col) => {
          page.drawText(col.header, { x: cx, y: y - HDR_H + 6, size: 7, font: bold, color: white });
          cx += col.width;
        });
        y -= HDR_H;
      };
      page.drawText('DESEMPENHO POR EQUIPE', { x: MARGIN, y, size: 10, font: bold, color: gold });
      y -= 16;
      drawTableHeader();
      rows.forEach((row, i) => {
        ensureSpace(ROW_H + 10);
        const cells = [row.equipe, String(row.clientes), String(row.vendas), `${row.conversao}%`, brl(row.receita)];
        page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: TABLE_W, height: ROW_H, color: i % 2 === 0 ? white : light });
        let cx = MARGIN + 4;
        cells.forEach((cell, idx) => {
          const maxChars = Math.max(8, Math.floor(columns[idx].width / 4.5));
          const text = cell.length > maxChars ? `${cell.slice(0, maxChars - 1)}.` : cell;
          page.drawText(text, { x: cx, y: y - ROW_H + 6, size: 7, font: regular, color: dark });
          cx += columns[idx].width;
        });
        y -= ROW_H;
      });

      addStandardFooters(pdfDoc, { regular, bold });
      const pdfBytes = await pdfDoc.save();
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
                {pdfLoading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} PDF da Diretoria
              </button>
            </div>
          </>
        )}
      </div>

      <HybridMetricCards metrics={metrics} />
      <PipelineByStage pipeline={metrics.pipeline} totalClientes={metrics.totalClientes} />
      <BrokerSearch brokers={brokerRanking} onSelect={openBroker} />

      <section className="mb-8">
        <SectionHeader title="Forecast Comercial" subtitle="Pipeline Ponderado por Probabilidade de Estágio" />
        <PremiumCard className="p-4 h-80">
          <div className="flex justify-between items-center mb-4">
            <div>
              <p className="text-xs text-text-secondary uppercase">Receita Ponderada (Pipeline)</p>
              <h3 className="font-ui text-xl font-bold text-text-primary">R$ {(forecastTotal / 1000000).toFixed(2)}M</h3>
            </div>
          </div>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weightedPipeline}>
                <defs>
                  <linearGradient id="colorWeightedDir" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e2636" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8b94a3' }} dy={10} />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #2b3547', backgroundColor: '#0d111a', color: '#f4f6fb', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}
                  itemStyle={{ color: '#f4f6fb' }}
                  labelStyle={{ color: '#8b94a3' }}
                  formatter={(val: number, name: string) => [`R$ ${val.toFixed(0)}k`, name === 'weighted' ? 'Pipeline Ponderado' : 'Confirmado']}
                />
                <Area type="monotone" dataKey="weighted" stroke="#2563eb" strokeWidth={3} fillOpacity={1} fill="url(#colorWeightedDir)" />
                <Area type="monotone" dataKey="confirmed" stroke="#22c55e" strokeWidth={2} strokeDasharray="5 5" fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-2">
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-primary-500" /><span className="text-[10px] text-text-secondary">Pipeline Ponderado</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-green-500" /><span className="text-[10px] text-text-secondary">Confirmado</span></div>
          </div>
        </PremiumCard>
      </section>

      <section>
        <SectionHeader title="Relatório por Equipe" subtitle="Análise segmentada por equipe da diretoria" />
        {dirTeams.length === 0 ? (
          <PremiumCard className="text-center py-8">
            <p className="text-text-secondary text-sm">Nenhuma equipe vinculada a esta diretoria.</p>
          </PremiumCard>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {dirTeams.map((team) => {
              const memberIds = getTeamMemberIds(team, allProfiles);
              const teamClients = dirScopedClients.filter((c) => memberIds.includes(c.owner_id || ''));
              const teamMetrics = computeHybridMetrics(teamClients, startDate, endDate);
              return (
                <PremiumCard
                  key={team.id}
                  className="flex items-center justify-between p-4 cursor-pointer hover:border-gold-300 transition-colors"
                  onClick={() => navigate(buildReportHref({
                    scope: 'equipe',
                    id: team.id,
                    name: team.name,
                    from: 'diretoria',
                    fromId: dirId,
                    fromName: dirName,
                    start: startDate,
                    end: endDate,
                  }))}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gold-50 dark:bg-gold-900/20 flex items-center justify-center">
                      <Shield size={20} className="text-gold-500" />
                    </div>
                    <div>
                      <h4 className="font-bold text-text-primary">{team.name}</h4>
                      <p className="text-xs text-text-secondary">{memberIds.length} membro{memberIds.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-text-secondary">{teamMetrics.totalClientes} clientes</p>
                      <p className="text-xs font-bold text-green-600">{teamMetrics.vendas} vendas</p>
                    </div>
                    <span className="text-gold-600 font-medium text-sm">Ver Relatório →</span>
                  </div>
                </PremiumCard>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
