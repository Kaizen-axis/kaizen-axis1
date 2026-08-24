import { useState, useMemo } from 'react';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { loadKaizenLogo, drawReportHeader, addStandardFooters } from '@/lib/pdf/reportKit';
import { SectionHeader, PageHeader, PremiumCard, RoundedButton, StatusBadge } from '@/components/ui/PremiumComponents';
import { MetricCard } from '@/components/reports/MetricCard';
import { CircularScore } from '@/components/reports/CircularScore';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, Building2, Users, TrendingUp, Target, ArrowLeft, AlertCircle, Timer, Shield, ChevronRight, X, MoreHorizontal, FileText } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp, Team } from '@/context/AppContext';
import { logAuditEvent } from '@/services/auditLogger';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useReportsData } from '@/hooks/useReportsData';
import { STAGE_WEIGHTS } from '@/types/reports';
import { parseDateOnlyLocal, parseDateOnlyLocalEnd, toDateOnlyLocal, toPtBrDate } from '@/lib/dateRange';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const brl = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);

/** Convert period label to ISO start date (end date = today) */
function periodToDates(period: string): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  if (period === 'Mês vigente') {
    start.setDate(1);
  }
  else if (period === '30 dias') start.setDate(end.getDate() - 30);
  else if (period === '60 dias') start.setDate(end.getDate() - 60);
  else if (period === '90 dias') start.setDate(end.getDate() - 90);
  else {
    // Custom: parse 'DD/MM/YYYY - DD/MM/YYYY'
    const parts = period.split(' - ');
    if (parts.length === 2) {
      const [d1, m1, y1] = parts[0].split('/');
      const [d2, m2, y2] = parts[1].split('/');
      return { start: `${y1}-${m1}-${d1}`, end: `${y2}-${m2}-${d2}` };
    }
  }
  return {
    start: toDateOnlyLocal(start),
    end: toDateOnlyLocal(end),
  };
}

function PeriodFilters({
  period,
  onPeriodChange,
}: {
  period: string;
  onPeriodChange: (period: string) => void;
}) {
  return (
    <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar pb-2 print:hidden">
      {['Mês vigente', '30 dias', '60 dias', '90 dias', 'Personalizado'].map((p) => (
        <button
          key={p}
          onClick={() => onPeriodChange(p)}
          className={`px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${period === p || (p === 'Personalizado' && period.includes('/'))
            ? 'bg-primary-600 text-white shadow-md'
            : 'bg-card-bg text-text-secondary border border-surface-200'
            }`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

/** Parse "R$ 200.000,00" → 200000 */
function parseValue(v: string): number {
  if (!v) return 0;
  const clean = v.replace(/[R$\s.]/g, '').replace(',', '.');
  return parseFloat(clean) || 0;
}

const normalizeTeamRef = (value?: string | null) => String(value || '').trim().toLowerCase();

function profileMatchesTeam(profile: { team?: string; team_id?: string | null }, team: Team): boolean {
  if (profile.team_id === team.id || profile.team === team.id) return true;

  // Legacy fallback: some older records store the team name in `profiles.team`
  const profileTeamName = normalizeTeamRef(profile.team);
  const teamName = normalizeTeamRef(team.name);
  return profileTeamName.length > 0 && profileTeamName === teamName;
}

function getTeamMemberIds(team: Team, profiles: Array<{
  id: string;
  role?: string;
  team?: string;
  team_id?: string | null;
  manager_id?: string | null;
  coordinator_id?: string | null;
}>): string[] {
  const directMembers = profiles.filter(p => profileMatchesTeam(p, team)).map(p => p.id);
  const managerId = team.manager_id || null;
  const managerLinked = managerId
    ? profiles.filter(p => p.manager_id === managerId).map(p => p.id)
    : [];

  const coordinatorIds = managerId
    ? profiles
      .filter(p => p.role?.toUpperCase() === 'COORDENADOR' && p.manager_id === managerId)
      .map(p => p.id)
    : [];

  const coordinatorLinkedBrokers = coordinatorIds.length > 0
    ? profiles
      .filter(p => p.role?.toUpperCase() === 'CORRETOR' && p.coordinator_id && coordinatorIds.includes(p.coordinator_id))
      .map(p => p.id)
    : [];

  return Array.from(new Set([
    ...(team.members ?? []),
    ...directMembers,
    ...(managerId ? [managerId] : []),
    ...managerLinked,
    ...coordinatorIds,
    ...coordinatorLinkedBrokers,
  ]));
}

function parseIsoDate(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function isSaleInPeriod(client: any, start: number | null, end: number | null): boolean {
  if (client?.stage !== 'Concluído') return false;
  const saleDate = parseIsoDate(client?.closed_at);
  if (saleDate === null) return false;
  if (start !== null && saleDate < start) return false;
  if (end !== null && saleDate > end) return false;
  return true;
}

// ─── Sub-view: Equipe Report ────────────────────────────────────────────────────

function TeamReportView({
  team, startDate, endDate, period, onPeriodChange,
}: { team: Team; startDate: string; endDate: string; period: string; onPeriodChange: (period: string) => void }) {
  const navigate = useNavigate();
  const { allProfiles, clients, teams } = useApp();
  const [selectedBrokerId, setSelectedBrokerId] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);

  // Members of this team:
  // - team.members[] is the authoritative list (set by the approval flow)
  // - fallback: profile.team can store UUID or legacy team name
  // - always include the team manager themselves
  const memberIds = getTeamMemberIds(team, allProfiles);
  const teamsInDirectorate = team.directorate_id
    ? teams.filter((t) => t.directorate_id === team.directorate_id)
    : [];
  const isSingleTeamDirectorate = teamsInDirectorate.length === 1;
  const teamDirectorateClients = team.directorate_id
    ? clients.filter((c) => (c as any).directorate_id === team.directorate_id)
    : [];

  // Clients belonging to team members, optionally filtered by date range
  const start = startDate ? parseDateOnlyLocal(startDate).getTime() : null;
  const end = endDate ? parseDateOnlyLocalEnd(endDate).getTime() : null;

  const baseClients = isSingleTeamDirectorate ? teamDirectorateClients : clients;

  const teamClients = baseClients.filter(c => {
    const ownerId = (c as any).owner_id;
    if (!isSingleTeamDirectorate && !memberIds.includes(ownerId)) return false;
    if (start && end) {
      const created = c.createdAt ? new Date(c.createdAt).getTime() : 0;
      return created >= start && created <= end;
    }
    return true;
  });

  const teamSales = baseClients.filter(c => {
    const ownerId = (c as any).owner_id;
    if (!isSingleTeamDirectorate && !memberIds.includes(ownerId)) return false;
    return isSaleInPeriod(c, start, end);
  });

  const totalClientes = teamClients.length;
  const vendas = teamSales.length;
  const aprovados = teamClients.filter(c => c.stage === 'Aprovado').length;
  const taxaConversao = totalClientes > 0 ? Math.round((vendas / totalClientes) * 100) : 0;
  const vgv = teamSales.reduce((acc, c) => acc + parseValue(c.intendedValue), 0);

  // Stage breakdown
  const byStage: Record<string, number> = {};
  teamClients.forEach(c => {
    byStage[c.stage] = (byStage[c.stage] ?? 0) + 1;
  });

  // Broker ranking
  const brokerRanking = allProfiles
    .filter(p => memberIds.includes(p.id) && p.role?.toUpperCase() === 'CORRETOR')
    .map(p => {
      const brokerClients = teamClients.filter(c => (c as any).owner_id === p.id);
      const brokerSales = teamSales.filter(c => (c as any).owner_id === p.id);
      return {
        id: p.id,
        name: p.name,
        total: brokerClients.length,
        vendas: brokerSales.length,
      };
    })
    .sort((a, b) => b.vendas - a.vendas || b.total - a.total);

  const convColor = taxaConversao >= 60
    ? 'text-green-500' : taxaConversao >= 30
      ? 'text-amber-400' : 'text-red-500';

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      const pdfDoc = await PDFDocument.create();
      const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const logoImg = await loadKaizenLogo(pdfDoc);
      const PAGE_W = 595, PAGE_H = 842, MARGIN = 36;
      const COL_W  = PAGE_W - MARGIN * 2;
      const ROW_H = 18;
      const HDR_H = 20;
      const gold   = rgb(0.145, 0.388, 0.922);
      const dark   = rgb(0.10, 0.10, 0.10);
      const gray   = rgb(0.45, 0.45, 0.45);
      const light  = rgb(0.96, 0.96, 0.96);
      const white  = rgb(1, 1, 1);
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

      const drawPipelineHeader = () => {
        page.drawRectangle({ x: MARGIN, y: y - HDR_H, width: COL_W, height: HDR_H, color: gold });
        for (const [txt, px] of [['Etapa', MARGIN + 4], ['Clientes', MARGIN + 260], ['%', MARGIN + 360]] as [string, number][]) {
          page.drawText(txt, { x: px, y: y - HDR_H + 6, size: 7, font: bold, color: white });
        }
        y -= HDR_H;
      };

      const drawRankingHeader = () => {
        page.drawRectangle({ x: MARGIN, y: y - HDR_H, width: COL_W, height: HDR_H, color: gold });
        for (const [txt, px] of [['Pos.', MARGIN + 4], ['Nome', MARGIN + 30], ['Clientes', MARGIN + 280], ['Vendas', MARGIN + 350], ['Conv.%', MARGIN + 420]] as [string, number][]) {
          page.drawText(txt, { x: px, y: y - HDR_H + 6, size: 7, font: bold, color: white });
        }
        y -= HDR_H;
      };

      y = drawReportHeader(page, { regular, bold }, logoImg, { title: 'Relatório por Equipe', subtitle: `Equipe: ${team.name}` });

      page.drawText('RESUMO DA EQUIPE', { x: MARGIN, y, size: 10, font: bold, color: gold });
      y -= 18;
      for (const [label, value] of [
        ['Total de Clientes', String(totalClientes)],
        ['Vendas Concluidas', String(vendas)],
        ['Aprovados', String(aprovados)],
        ['Taxa de Conversao', `${taxaConversao}%`],
        ['VGV Concluido', brlFmt(vgv)],
      ] as [string, string][]) {
        page.drawText(`${label}:`, { x: MARGIN, y, size: 9, font: bold, color: dark });
        page.drawText(value, { x: MARGIN + 150, y, size: 9, font: regular, color: dark });
        y -= 14;
      }
      y -= 8;
      page.drawRectangle({ x: MARGIN, y, width: COL_W, height: 0.5, color: rgb(0.85, 0.85, 0.85) });
      y -= 16;

      page.drawText('PIPELINE POR ETAPA', { x: MARGIN, y, size: 10, font: bold, color: gold });
      y -= 16;
      drawPipelineHeader();
      let rowIdx = 0;
      for (const [stage, count] of Object.entries(byStage).sort((a, b) => (b[1] as number) - (a[1] as number))) {
        ensureSpace(ROW_H + 10, 'Relatorio por Equipe (continuacao)');
        if (y > PAGE_H - MARGIN - 20) {
          page.drawText('PIPELINE POR ETAPA (continuacao)', { x: MARGIN, y, size: 10, font: bold, color: gold });
          y -= 16;
          drawPipelineHeader();
        }
        const pct = totalClientes > 0 ? Math.round(((count as number) / totalClientes) * 100) : 0;
        const rc = rowIdx % 2 === 0 ? white : light;
        page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: COL_W, height: ROW_H, color: rc });
        page.drawText(stage, { x: MARGIN + 4, y: y - ROW_H + 6, size: 7, font: regular, color: dark });
        page.drawText(String(count), { x: MARGIN + 260, y: y - ROW_H + 6, size: 7, font: regular, color: dark });
        page.drawText(`${pct}%`, { x: MARGIN + 360, y: y - ROW_H + 6, size: 7, font: regular, color: dark });
        y -= ROW_H;
        rowIdx++;
      }
      y -= 10;
      page.drawRectangle({ x: MARGIN, y, width: COL_W, height: 0.5, color: rgb(0.85, 0.85, 0.85) });
      y -= 16;

      ensureSpace(64, 'Relatorio por Equipe (continuacao)');
      page.drawText('RANKING DE CORRETORES', { x: MARGIN, y, size: 10, font: bold, color: gold });
      y -= 16;
      drawRankingHeader();
      rowIdx = 0;
      for (const [i, broker] of brokerRanking.entries()) {
        ensureSpace(ROW_H + 10, 'Relatorio por Equipe (continuacao)');
        if (y > PAGE_H - MARGIN - 20) {
          page.drawText('RANKING DE CORRETORES (continuacao)', { x: MARGIN, y, size: 10, font: bold, color: gold });
          y -= 16;
          drawRankingHeader();
        }
        const conv = broker.total > 0 ? Math.round((broker.vendas / broker.total) * 100) : 0;
        const rc = rowIdx % 2 === 0 ? white : light;
        page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: COL_W, height: ROW_H, color: rc });
        page.drawText(String(i + 1), { x: MARGIN + 4, y: y - ROW_H + 6, size: 7, font: regular, color: dark });
        page.drawText((broker.name ?? '-').slice(0, 42), { x: MARGIN + 30, y: y - ROW_H + 6, size: 7, font: regular, color: dark });
        page.drawText(String(broker.total), { x: MARGIN + 280, y: y - ROW_H + 6, size: 7, font: regular, color: dark });
        page.drawText(String(broker.vendas), { x: MARGIN + 350, y: y - ROW_H + 6, size: 7, font: regular, color: dark });
        page.drawText(`${conv}%`, { x: MARGIN + 420, y: y - ROW_H + 6, size: 7, font: regular, color: dark });
        y -= ROW_H;
        rowIdx++;
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
      {/* Header */}
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <button
            onClick={() => navigate('/reports')}
            className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-gold-600 font-medium mb-2 transition-colors"
          >
            <ArrowLeft size={13} /> Ver Relatório Global
          </button>
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
          onClick={() => setIsActionsMenuOpen(v => !v)}
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

      {/* Summary cards */}
      <section className="grid grid-cols-2 gap-3 mb-6">
        <PremiumCard className="flex flex-col gap-1">
          <p className="text-[10px] text-text-secondary uppercase tracking-wide">Total Clientes</p>
          <div className="flex items-end gap-2 mt-1">
            <Users size={18} className="text-gold-500 mb-0.5" />
            <h3 className="font-ui text-2xl font-bold text-text-primary">{totalClientes}</h3>
          </div>
        </PremiumCard>

        <PremiumCard className="flex flex-col gap-1">
          <p className="text-[10px] text-text-secondary uppercase tracking-wide">Vendas Concluídas</p>
          <div className="flex items-end gap-2 mt-1">
            <TrendingUp size={18} className="text-green-500 mb-0.5" />
            <h3 className="font-ui text-2xl font-bold text-text-primary">{vendas}</h3>
          </div>
        </PremiumCard>

        <PremiumCard className="flex flex-col gap-1">
          <p className="text-[10px] text-text-secondary uppercase tracking-wide">Aprovados</p>
          <div className="flex items-end gap-2 mt-1">
            <TrendingUp size={18} className="text-blue-500 mb-0.5" />
            <h3 className="font-ui text-2xl font-bold text-green-600">{aprovados}</h3>
          </div>
        </PremiumCard>

        <PremiumCard className="flex flex-col gap-1">
          <p className="text-[10px] text-text-secondary uppercase tracking-wide">Taxa de Conversão</p>
          <div className="flex items-end gap-2 mt-1">
            <Target size={18} className="text-blue-500 mb-0.5" />
            <h3 className={`font-ui text-2xl font-bold ${convColor}`}>{taxaConversao}%</h3>
          </div>
        </PremiumCard>

        <PremiumCard highlight className="col-span-2 flex flex-col gap-1">
          <p className="text-[10px] text-gold-700 dark:text-gold-400 uppercase tracking-wide">VGV Concluído</p>
          <h3 className="font-ui text-2xl font-bold text-text-primary mt-1">{brl(vgv)}</h3>
        </PremiumCard>
      </section>

      {/* Pipeline by stage */}
      <section className="mb-6">
        <SectionHeader title="Pipeline por Etapa" subtitle="Distribuição atual dos clientes" />
        <PremiumCard className="overflow-hidden p-0">
          {Object.entries(byStage).length === 0 ? (
            <p className="text-sm text-text-secondary text-center py-8">Nenhum cliente no período.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50 dark:bg-surface-100">
                  <th className="text-left p-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Etapa</th>
                  <th className="text-center p-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Clientes</th>
                  <th className="text-center p-3 text-xs font-medium text-text-secondary uppercase tracking-wide">%</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byStage)
                  .sort((a, b) => b[1] - a[1])
                  .map(([stage, count]) => (
                    <tr key={stage} className="border-b border-surface-100 last:border-0 hover:bg-surface-50 transition-colors">
                      <td className="p-3 font-medium text-text-primary">{stage}</td>
                      <td className="p-3 text-center text-text-secondary">{count}</td>
                      <td className="p-3 text-center">
                        <span className="text-xs font-bold text-text-secondary">
                          {totalClientes > 0 ? Math.round((count / totalClientes) * 100) : 0}%
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </PremiumCard>
      </section>

      {/* Broker ranking */}
      <section>
        <SectionHeader title="Ranking de Corretores" subtitle="Clique em um corretor para ver seus clientes" />
        {brokerRanking.length === 0 ? (
          <PremiumCard className="text-center py-8">
            <p className="text-text-secondary text-sm">Nenhum corretor vinculado a esta equipe.</p>
          </PremiumCard>
        ) : (
          <div className="space-y-2">
            {brokerRanking.map((broker, i) => {
              const score = broker.total > 0 ? Math.min(100, Math.round((broker.vendas / broker.total) * 100)) : 0;
              const isSelected = selectedBrokerId === broker.id;
              const brokerClients = teamClients.filter(c => (c as any).owner_id === broker.id);
              return (
                <div key={broker.id}>
                  <PremiumCard
                    className={`flex items-center justify-between p-4 cursor-pointer transition-all ${isSelected ? 'border-gold-400 dark:border-gold-500 shadow-md' : 'hover:border-gold-300'}`}
                    onClick={() => setSelectedBrokerId(isSelected ? null : broker.id)}
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
                      <ChevronRight
                        size={16}
                        className={`text-text-secondary transition-transform ${isSelected ? 'rotate-90' : ''}`}
                      />
                    </div>
                  </PremiumCard>

                  {/* Client list for selected broker */}
                  {isSelected && (
                    <div className="mt-1 mb-2 ml-4 border-l-2 border-gold-200 dark:border-gold-800 pl-3 space-y-2">
                      {brokerClients.length === 0 ? (
                        <p className="text-xs text-text-secondary py-2 pl-1">Nenhum cliente no período selecionado.</p>
                      ) : (
                        brokerClients.map(client => (
                          <div
                            key={client.id}
                            onClick={() => navigate(`/clients/${client.id}`)}
                            className="flex items-center justify-between bg-card-bg rounded-xl px-3 py-2.5 cursor-pointer hover:bg-gold-50 dark:hover:bg-gold-900/10 hover:border-gold-200 border border-surface-100 transition-all"
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
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Sub-view: Coordenação Report ─────────────────────────────────────────────

function CoordReportView({
  coordId, coordName, startDate, endDate, period, onPeriodChange,
}: { coordId: string; coordName: string; startDate: string; endDate: string; period: string; onPeriodChange: (period: string) => void }) {
  const navigate = useNavigate();
  const { allProfiles, clients } = useApp();
  const [selectedBrokerId, setSelectedBrokerId] = useState<string | null>(null);

  // Corretores vinculados a este coordenador
  const brokerProfiles = allProfiles.filter(p => p.coordinator_id === coordId);
  const memberIds = Array.from(new Set([coordId, ...brokerProfiles.map(p => p.id)]));

  const start = startDate ? parseDateOnlyLocal(startDate).getTime() : null;
  const end = endDate ? parseDateOnlyLocalEnd(endDate).getTime() : null;

  const coordClients = clients.filter(c => {
    const ownerId = (c as any).owner_id;
    if (!memberIds.includes(ownerId)) return false;
    if (start && end) {
      const created = c.createdAt ? new Date(c.createdAt).getTime() : 0;
      return created >= start && created <= end;
    }
    return true;
  });

  const coordSales = clients.filter(c => {
    const ownerId = (c as any).owner_id;
    if (!memberIds.includes(ownerId)) return false;
    return isSaleInPeriod(c, start, end);
  });

  const totalClientes = coordClients.length;
  const vendas = coordSales.length;
  const aprovados = coordClients.filter(c => c.stage === 'Aprovado').length;
  const taxaConversao = totalClientes > 0 ? Math.round((vendas / totalClientes) * 100) : 0;
  const vgv = coordSales.reduce((acc, c) => acc + parseValue(c.intendedValue), 0);

  const byStage: Record<string, number> = {};
  coordClients.forEach(c => { byStage[c.stage] = (byStage[c.stage] ?? 0) + 1; });

  const brokerRanking = allProfiles
    .filter(p => memberIds.includes(p.id))
    .map(p => {
      const bc = coordClients.filter(c => (c as any).owner_id === p.id);
      const sales = coordSales.filter(c => (c as any).owner_id === p.id);
      return {
        id: p.id,
        name: p.name,
        total: bc.length,
        vendas: sales.length,
      };
    })
    .sort((a, b) => b.vendas - a.vendas || b.total - a.total);

  const convColor = taxaConversao >= 60
    ? 'text-green-500' : taxaConversao >= 30
      ? 'text-amber-400' : 'text-red-500';

  return (
    <div className="p-6 pb-24 min-h-screen bg-surface-50">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-3">
        <div>
          <button
            onClick={() => navigate('/reports')}
            className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-gold-600 font-medium mb-2 transition-colors"
          >
            <ArrowLeft size={13} /> Ver Relatório Global
          </button>
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

      {/* Summary cards */}
      <section className="grid grid-cols-2 gap-3 mb-6">
        <PremiumCard className="flex flex-col gap-1">
          <p className="text-[10px] text-text-secondary uppercase tracking-wide">Total Clientes</p>
          <div className="flex items-end gap-2 mt-1">
            <Users size={18} className="text-gold-500 mb-0.5" />
            <h3 className="font-ui text-2xl font-bold text-text-primary">{totalClientes}</h3>
          </div>
        </PremiumCard>

        <PremiumCard className="flex flex-col gap-1">
          <p className="text-[10px] text-text-secondary uppercase tracking-wide">Vendas Concluídas</p>
          <div className="flex items-end gap-2 mt-1">
            <TrendingUp size={18} className="text-green-500 mb-0.5" />
            <h3 className="font-ui text-2xl font-bold text-text-primary">{vendas}</h3>
          </div>
        </PremiumCard>

        <PremiumCard className="flex flex-col gap-1">
          <p className="text-[10px] text-text-secondary uppercase tracking-wide">Aprovados</p>
          <div className="flex items-end gap-2 mt-1">
            <TrendingUp size={18} className="text-blue-500 mb-0.5" />
            <h3 className="font-ui text-2xl font-bold text-green-600">{aprovados}</h3>
          </div>
        </PremiumCard>

        <PremiumCard className="flex flex-col gap-1">
          <p className="text-[10px] text-text-secondary uppercase tracking-wide">Taxa de Conversão</p>
          <div className="flex items-end gap-2 mt-1">
            <Target size={18} className="text-blue-500 mb-0.5" />
            <h3 className={`font-ui text-2xl font-bold ${convColor}`}>{taxaConversao}%</h3>
          </div>
        </PremiumCard>

        <PremiumCard highlight className="col-span-2 flex flex-col gap-1">
          <p className="text-[10px] text-gold-700 dark:text-gold-400 uppercase tracking-wide">VGV Concluído</p>
          <h3 className="font-ui text-2xl font-bold text-text-primary mt-1">{brl(vgv)}</h3>
        </PremiumCard>
      </section>

      {/* Pipeline by stage */}
      <section className="mb-6">
        <SectionHeader title="Pipeline por Etapa" subtitle="Distribuição atual dos clientes" />
        <PremiumCard className="overflow-hidden p-0">
          {Object.entries(byStage).length === 0 ? (
            <p className="text-sm text-text-secondary text-center py-8">Nenhum cliente no período.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50 dark:bg-surface-100">
                  <th className="text-left p-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Etapa</th>
                  <th className="text-center p-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Clientes</th>
                  <th className="text-center p-3 text-xs font-medium text-text-secondary uppercase tracking-wide">%</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byStage)
                  .sort((a, b) => b[1] - a[1])
                  .map(([stage, count]) => (
                    <tr key={stage} className="border-b border-surface-100 last:border-0 hover:bg-surface-50 transition-colors">
                      <td className="p-3 font-medium text-text-primary">{stage}</td>
                      <td className="p-3 text-center text-text-secondary">{count}</td>
                      <td className="p-3 text-center">
                        <span className="text-xs font-bold text-text-secondary">
                          {totalClientes > 0 ? Math.round((count / totalClientes) * 100) : 0}%
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </PremiumCard>
      </section>

      {/* Broker ranking — clicável com lista de clientes */}
      <section>
        <SectionHeader title="Ranking de Corretores" subtitle="Clique em um corretor para ver seus clientes" />
        {brokerRanking.length === 0 ? (
          <PremiumCard className="text-center py-8">
            <p className="text-text-secondary text-sm">Nenhum corretor vinculado a esta coordenação.</p>
          </PremiumCard>
        ) : (
          <div className="space-y-2">
            {brokerRanking.map((broker, i) => {
              const score = broker.total > 0 ? Math.min(100, Math.round((broker.vendas / broker.total) * 100)) : 0;
              const isSelected = selectedBrokerId === broker.id;
              const brokerClients = coordClients.filter(c => (c as any).owner_id === broker.id);
              return (
                <div key={broker.id}>
                  <PremiumCard
                    className={`flex items-center justify-between p-4 cursor-pointer transition-all ${isSelected ? 'border-gold-400 dark:border-gold-500 shadow-md' : 'hover:border-gold-300'}`}
                    onClick={() => setSelectedBrokerId(isSelected ? null : broker.id)}
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
                      <ChevronRight
                        size={16}
                        className={`text-text-secondary transition-transform ${isSelected ? 'rotate-90' : ''}`}
                      />
                    </div>
                  </PremiumCard>

                  {isSelected && (
                    <div className="mt-1 mb-2 ml-4 border-l-2 border-gold-200 dark:border-gold-800 pl-3 space-y-2">
                      {brokerClients.length === 0 ? (
                        <p className="text-xs text-text-secondary py-2 pl-1">Nenhum cliente no período selecionado.</p>
                      ) : (
                        brokerClients.map(client => (
                          <div
                            key={client.id}
                            onClick={() => navigate(`/clients/${client.id}`)}
                            className="flex items-center justify-between bg-card-bg rounded-xl px-3 py-2.5 cursor-pointer hover:bg-gold-50 dark:hover:bg-gold-900/10 border border-surface-100 hover:border-gold-200 transition-all"
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
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Sub-view: Diretoria Report ────────────────────────────────────────────────

function DiretoriaReportView({
  dirId, dirName, startDate, endDate, period, onPeriodChange,
}: { dirId: string; dirName: string; startDate: string; endDate: string; period: string; onPeriodChange: (period: string) => void }) {
  const navigate = useNavigate();
  const { clients, teams, allProfiles } = useApp();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);

  // Clients belonging to this directorate (no period cut)
  const dirScopedClients = useMemo(() =>
    clients.filter(c => (c as any).directorate_id === dirId),
    [clients, dirId]
  );

  // Clients in the selected period (creation-based metric)
  const dirClients = useMemo(() =>
    dirScopedClients.filter(c => {
      if (startDate && new Date(c.createdAt) < parseDateOnlyLocal(startDate)) return false;
      if (endDate && new Date(c.createdAt) > parseDateOnlyLocalEnd(endDate)) return false;
      return true;
    }),
    [dirScopedClients, startDate, endDate]
  );

  // Teams that belong to this directorate
  const dirTeams = useMemo(() =>
    teams.filter(t => t.directorate_id === dirId),
    [teams, dirId]
  );
  const isSingleTeamDirectorate = dirTeams.length === 1;

  // ── Metrics
  const totalClientes = dirClients.length;
  const vendas = dirScopedClients.filter(c => isSaleInPeriod(c, startDate ? parseDateOnlyLocal(startDate).getTime() : null, endDate ? parseDateOnlyLocalEnd(endDate).getTime() : null));
  const totalVendas = vendas.length;
  const aprovados = dirClients.filter(c => c.stage === 'Aprovado').length;
  const taxaConversao = totalClientes > 0 ? ((totalVendas / totalClientes) * 100).toFixed(1) : '0.0';
  const ciclosComDados = vendas.filter(c => c.closed_at);
  const cicloMedioDias = ciclosComDados.length > 0
    ? (ciclosComDados.reduce((acc, c) => {
        const days = (new Date(c.closed_at!).getTime() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        return acc + days;
      }, 0) / ciclosComDados.length).toFixed(1)
    : null;

  // ── Health Scores (top 5 at-risk clients)
  const healthScores = useMemo(() =>
    dirClients.slice(0, 5).map(c => {
      const stageBase: Record<string, number> = {
        'Aprovado': 85, 'Contrato': 80, 'Em Tratativa': 65, 'Condicionado': 55,
        'Em Análise': 50, 'Documentação': 40, 'Novo Lead': 35, 'Desistência': 0, 'Reprovado': 10, 'Concluído': 100,
      };
      let score = stageBase[c.stage] ?? 50;
      if (parseValue(c.intendedValue ?? '') > 0) score += 10;
      if (c.updated_at) {
        const days = (Date.now() - new Date(c.updated_at).getTime()) / (1000 * 60 * 60 * 24);
        if (days > 10) score -= 15;
      }
      score = Math.min(100, Math.max(0, Math.round(score)));
      return { id: c.id, name: c.name, stage: c.stage, score, potentialValue: c.intendedValue ?? '', conversionProbability: score };
    }),
    [dirClients]
  );

  // ── Weighted Pipeline chart data
  const { weightedPipeline, forecastTotal } = useMemo(() => {
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    let totalWeightedBRL = 0;
    const pipeline = months.map((m, i) => {
      // Pipeline uses ALL directorate clients grouped by creation month — not period-filtered.
      const mc = dirScopedClients.filter(c => new Date(c.createdAt).getMonth() === i);
      const weighted = mc.reduce((acc, c) => acc + parseValue(c.intendedValue ?? '') * (STAGE_WEIGHTS[c.stage] ?? 0), 0);
      // confirmed = Concluído clients whose closed_at falls in month i.
      const confirmed = dirScopedClients
        .filter(c => {
          if (c.stage !== 'Concluído') return false;
          const closedRaw = c.closed_at;
          if (!closedRaw) return false;
          return new Date(closedRaw).getMonth() === i;
        })
        .reduce((acc, c) => acc + parseValue(c.intendedValue ?? ''), 0);
      totalWeightedBRL += weighted;
      return { month: m, weighted: weighted / 1000, confirmed: confirmed / 1000 };
    });
    return { weightedPipeline: pipeline, forecastTotal: totalWeightedBRL };
  }, [dirScopedClients]);

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      const pdfDoc = await PDFDocument.create();
      const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const logoImg = await loadKaizenLogo(pdfDoc);

      const PAGE_W = 595;
      const PAGE_H = 842;
      const MARGIN = 36;
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

      const ensureSpace = (needed: number, continuationLabel = 'Relatorio por Diretoria (continuacao)') => {
        if (y < MARGIN + needed) addContinuationPage(continuationLabel);
      };

      const rows = dirTeams
        .map((team) => {
          const memberIds = getTeamMemberIds(team, allProfiles as any);
          const teamClients = isSingleTeamDirectorate
            ? dirClients
            : dirClients.filter((c) => memberIds.includes((c as any).owner_id));
          const vendasEquipe = isSingleTeamDirectorate
            ? dirScopedClients.filter((c) => isSaleInPeriod(c, startDate ? parseDateOnlyLocal(startDate).getTime() : null, endDate ? parseDateOnlyLocalEnd(endDate).getTime() : null))
            : dirScopedClients.filter((c) => memberIds.includes((c as any).owner_id) && isSaleInPeriod(c, startDate ? parseDateOnlyLocal(startDate).getTime() : null, endDate ? parseDateOnlyLocalEnd(endDate).getTime() : null));
          const vgvEquipe = vendasEquipe.reduce((acc, c) => acc + parseValue(c.intendedValue), 0);
          return {
            equipe: team.name,
            clientes: teamClients.length,
            vendas: vendasEquipe.length,
            conversao: teamClients.length > 0 ? Math.round((vendasEquipe.length / teamClients.length) * 100) : 0,
            receita: vgvEquipe,
          };
        })
        .sort((a, b) => b.vendas - a.vendas || b.receita - a.receita);

      y = drawReportHeader(page, { regular, bold }, logoImg, { title: 'Relatório por Diretoria', subtitle: `Diretoria: ${dirName} · Período: ${toPtBrDate(startDate)} a ${toPtBrDate(endDate)}` });

      page.drawText('RESUMO', { x: MARGIN, y, size: 10, font: bold, color: gold });
      y -= 18;
      for (const [label, value] of [
        ['Vendas Totais', String(totalVendas)],
        ['Total de Clientes', String(totalClientes)],
        ['Taxa de Conversao', `${taxaConversao}%`],
        ['Ciclo de Vendas', cicloMedioDias ? `${cicloMedioDias} dias` : '—'],
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
        ensureSpace(ROW_H + 10, 'Relatorio por Diretoria (continuacao)');
        if (y > PAGE_H - MARGIN - 20) {
          page.drawText('DESEMPENHO POR EQUIPE (continuacao)', { x: MARGIN, y, size: 10, font: bold, color: gold });
          y -= 16;
          drawTableHeader();
        }

        const isEven = i % 2 === 0;
        page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: TABLE_W, height: ROW_H, color: isEven ? white : light });

        const cells = [row.equipe, String(row.clientes), String(row.vendas), `${row.conversao}%`, brl(row.receita)];
        let cx = MARGIN + 4;
        cells.forEach((cell, idx) => {
          const maxChars = Math.max(8, Math.floor(columns[idx].width / 4.5));
          const text = cell.length > maxChars ? `${cell.slice(0, maxChars - 1)}…` : cell;
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
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <button
            onClick={() => navigate('/reports')}
            className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-gold-600 font-medium mb-2 transition-colors"
          >
            <ArrowLeft size={13} /> Ver Relatório Global
          </button>
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
          onClick={() => setIsActionsMenuOpen(v => !v)}
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

      {/* ── Metrics ── */}
      <section className="grid grid-cols-2 gap-3 mb-8">
        {[
          { id: '1', label: 'Vendas Totais', value: totalVendas.toString(), trend: 'up' as const, period: 'no período', inverse: false },
          { id: '2', label: 'Total Clientes', value: totalClientes.toString(), trend: 'up' as const, period: 'no período', inverse: false },
          { id: '3', label: 'Taxa de Conversão', value: `${taxaConversao}%`, trend: 'up' as const, period: 'no período', inverse: false },
          { id: '4', label: 'Ciclo de Vendas', value: cicloMedioDias ? `${cicloMedioDias} dias` : '— dias', trend: 'up' as const, period: 'média real', inverse: true },
        ].map(m => <MetricCard key={m.id} {...m} change="" />)}
      </section>

      {/* ── Forecast Comercial ── */}
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

      {/* ── Health Score Comercial ── */}
      <section className="mb-8">
        <SectionHeader title="Health Score Comercial" subtitle="Risco e Probabilidade — Ponderado" />
        <div className="space-y-3">
          {healthScores.length === 0
            ? <p className="text-sm text-text-secondary text-center py-8">Dados insuficientes para análise.</p>
            : healthScores.map(client => (
              <PremiumCard key={client.id} className="flex items-center justify-between p-4 cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all"
                onClick={() => navigate(`/clients/${client.id}`)}>
                <div className="flex items-center gap-3">
                  <CircularScore score={client.score} />
                  <div>
                    <h4 className="font-bold text-text-primary text-sm">{client.name}</h4>
                    <p className="text-xs text-text-secondary">
                      {client.stage}{parseValue(client.potentialValue ?? '') > 0 ? ` • ${brl(parseValue(client.potentialValue ?? ''))}` : ''}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-text-secondary uppercase mb-0.5">Probabilidade</p>
                  <p className={`text-sm font-bold ${client.conversionProbability > 70 ? 'text-green-500' : client.conversionProbability > 40 ? 'text-amber-400' : 'text-red-500'}`}>
                    {client.conversionProbability}%
                  </p>
                </div>
              </PremiumCard>
            ))}
        </div>
      </section>

      {/* ── Relatório por Equipe ── */}
      <section>
        <SectionHeader title="Relatório por Equipe" subtitle="Análise segmentada por equipe da diretoria" />
        {dirTeams.length === 0 ? (
          <PremiumCard className="text-center py-8">
            <p className="text-text-secondary text-sm">Nenhuma equipe vinculada a esta diretoria.</p>
          </PremiumCard>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {dirTeams.map(team => {
              const memberIds = getTeamMemberIds(team, allProfiles as any);
              const memberCount = memberIds.length;
              const teamClients = isSingleTeamDirectorate
                ? dirClients
                : dirClients.filter(c => memberIds.includes((c as any).owner_id));
              const teamSales = isSingleTeamDirectorate
                ? dirScopedClients.filter(c => isSaleInPeriod(c, startDate ? parseDateOnlyLocal(startDate).getTime() : null, endDate ? parseDateOnlyLocalEnd(endDate).getTime() : null)).length
                : dirScopedClients.filter(c => memberIds.includes((c as any).owner_id) && isSaleInPeriod(c, startDate ? parseDateOnlyLocal(startDate).getTime() : null, endDate ? parseDateOnlyLocalEnd(endDate).getTime() : null)).length;
              return (
                <PremiumCard
                  key={team.id}
                  className="flex items-center justify-between p-4 cursor-pointer hover:border-gold-300 transition-colors"
                  onClick={() => navigate(`/reports?scope=equipe&id=${team.id}&name=${encodeURIComponent(team.name)}&start=${startDate}&end=${endDate}`)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gold-50 dark:bg-gold-900/20 flex items-center justify-center">
                      <Shield size={20} className="text-gold-500" />
                    </div>
                    <div>
                      <h4 className="font-bold text-text-primary">{team.name}</h4>
                      <p className="text-xs text-text-secondary">{memberCount} membro{memberCount !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-text-secondary">{teamClients.length} clientes</p>
                      <p className="text-xs font-bold text-green-600">{teamSales} vendas</p>
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

// ─── Main: Global Reports View ─────────────────────────────────────────────────

export default function Reports() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { loading, teams, allProfiles, profile } = useApp();
  const { isAdmin, isDirector, isManager, isCoordinator, canViewAllClients } = useAuthorization();

  // ── Period state
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [startDateInput, setStartDateInput] = useState('');
  const [endDateInput, setEndDateInput] = useState('');

  // ── Route-level scope reading
  const scope = searchParams.get('scope') ?? 'global';
  const scopeId = searchParams.get('id') ?? '';
  const scopeName = decodeURIComponent(searchParams.get('name') ?? '');
  const currentUserProfile = allProfiles.find(p => p.id === profile?.id);
  const defaultPeriod = 'Mês vigente';
  const queryStart = searchParams.get('start');
  const queryEnd = searchParams.get('end');
  const period = (queryStart && queryEnd)
    ? `${toPtBrDate(queryStart)} - ${toPtBrDate(queryEnd)}`
    : (searchParams.get('period') ?? defaultPeriod);

  // ── Derive ISO dates from selected period
  const { start: startDate, end: endDate } = periodToDates(period);

  // ── Business Intelligence hook — reactive to date range
  const { globalMetrics, weightedPipeline, forecastTotal, healthScores } = useReportsData({
    startDate,
    endDate,
  });

  // ── Metric cards for display
  const metrics = [
    {
      id: '1',
      label: 'Vendas Totais',
      value: globalMetrics.totalVendas.toString(),
      change: '',
      trend: 'up' as const,
      period: `no período de ${period}`,
    },
    {
      id: '2',
      label: 'Novos Leads',
      value: globalMetrics.novosLeads.toString(),
      change: '',
      trend: 'up' as const,
      period: `no período de ${period}`,
    },
    {
      id: '3',
      label: 'Taxa de Conversão',
      value: `${globalMetrics.taxaConversao.toFixed(1)}%`,
      change: '',
      trend: 'up' as const,
      period: `no período de ${period}`,
    },
    {
      id: '4',
      label: 'Ciclo de Vendas',
      value: globalMetrics.cicloMedioDias > 0 ? `${globalMetrics.cicloMedioDias} dias` : '— dias',
      change: '',
      trend: 'down' as const,
      period: 'média real',
    },
  ];

  // ── Delegate to diretoria sub-view (ADMIN only)
  if (scope === 'diretoria' && scopeId && isAdmin) {
    return (
      <>
        <DiretoriaReportView
          dirId={scopeId}
          dirName={scopeName || 'Diretoria'}
          startDate={startDate}
          endDate={endDate}
          period={period}
          onPeriodChange={handlePeriodChange}
        />
        <Modal isOpen={isDateModalOpen} onClose={() => setIsDateModalOpen(false)} title="Período Personalizado">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Início</label>
              <input type="date" value={startDateInput} onChange={e => setStartDateInput(e.target.value)} className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Fim</label>
              <input type="date" value={endDateInput} onChange={e => setEndDateInput(e.target.value)} className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
            </div>
            <RoundedButton fullWidth onClick={applyCustomDate}>Aplicar Filtro</RoundedButton>
          </div>
        </Modal>
      </>
    );
  }

  // ── Delegate to equipe sub-view
  if (scope === 'equipe' && scopeId && canViewAllClients) {
    const teamObj = teams.find(t => t.id === scopeId);
    // GERENTE só pode ver equipes que gerencia; COORDENADOR só a sua
    const canViewThisTeam =
      isAdmin || isDirector ||
      (isManager && teamObj?.manager_id === profile?.id) ||
      (isCoordinator && (
        teamObj?.members?.includes(profile?.id ?? '') ||
        (!!teamObj && !!currentUserProfile && profileMatchesTeam(currentUserProfile, teamObj))
      ));
    if (teamObj && canViewThisTeam) {
      return (
        <>
          <TeamReportView team={teamObj} startDate={startDate} endDate={endDate} period={period} onPeriodChange={handlePeriodChange} />
          <Modal isOpen={isDateModalOpen} onClose={() => setIsDateModalOpen(false)} title="Período Personalizado">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Início</label>
                <input type="date" value={startDateInput} onChange={e => setStartDateInput(e.target.value)} className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Fim</label>
                <input type="date" value={endDateInput} onChange={e => setEndDateInput(e.target.value)} className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
              </div>
              <RoundedButton fullWidth onClick={applyCustomDate}>Aplicar Filtro</RoundedButton>
            </div>
          </Modal>
        </>
      );
    }
  }

  // ── Delegate to coordenação sub-view (GERENTE + ADMIN)
  if (scope === 'coordenacao' && scopeId && (isManager || isAdmin)) {
    return (
      <>
        <CoordReportView
          coordId={scopeId}
          coordName={scopeName || 'Coordenação'}
          startDate={startDate}
          endDate={endDate}
          period={period}
          onPeriodChange={handlePeriodChange}
        />
        <Modal isOpen={isDateModalOpen} onClose={() => setIsDateModalOpen(false)} title="Período Personalizado">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Início</label>
              <input type="date" value={startDateInput} onChange={e => setStartDateInput(e.target.value)} className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Fim</label>
              <input type="date" value={endDateInput} onChange={e => setEndDateInput(e.target.value)} className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
            </div>
            <RoundedButton fullWidth onClick={applyCustomDate}>Aplicar Filtro</RoundedButton>
          </div>
        </Modal>
      </>
    );
  }

  function handlePeriodChange(p: string) {
    if (p === 'Personalizado') {
      setStartDateInput(startDate);
      setEndDateInput(endDate);
      setIsDateModalOpen(true);
      return;
    }
    const params = new URLSearchParams(searchParams);
    params.delete('start');
    params.delete('end');
    params.set('period', p);
    setSearchParams(params);
  }

  function applyCustomDate() {
    if (startDateInput && endDateInput) {
      const params = new URLSearchParams(searchParams);
      params.set('start', startDateInput);
      params.set('end', endDateInput);
      params.set('period', `${toPtBrDate(startDateInput)} - ${toPtBrDate(endDateInput)}`);
      setSearchParams(params);
      setIsDateModalOpen(false);
    } else alert('Por favor, selecione as datas de início e fim.');
  }

  const handleExport = async (format: 'pdf' | 'excel') => {
    const fileName = `relatorio_estrategico_${new Date().toISOString().split('T')[0]}.${format === 'excel' ? 'csv' : 'pdf'}`;
    if (format === 'excel') {
      const headers = ['Cliente', 'Estágio', 'Valor Potencial', 'Health Score'];
      const rows = healthScores.map(c => [c.name, c.stage, c.potentialValue, c.score]);
      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', fileName);
      link.click();
    } else {
      try {
        const pdfDoc = await PDFDocument.create();
        const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const logoImg = await loadKaizenLogo(pdfDoc);
        const PAGE_W = 595, PAGE_H = 842, MARGIN = 36;
        const COL_W  = PAGE_W - MARGIN * 2;
        const ROW_H = 18;
        const HDR_H = 20;
        const gold   = rgb(0.145, 0.388, 0.922);
        const dark   = rgb(0.10, 0.10, 0.10);
        const gray   = rgb(0.45, 0.45, 0.45);
        const light  = rgb(0.96, 0.96, 0.96);
        const white  = rgb(1, 1, 1);
        const brlFmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

        let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        let y = PAGE_H - MARGIN;

        const addContinuationPage = (label: string) => {
          page = pdfDoc.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - MARGIN;
          page.drawText(label, { x: MARGIN, y, size: 8, font: regular, color: gray });
          y -= 14;
        };

        const ensureSpace = (needed: number, continuationLabel = 'Relatorio Estrategico (continuacao)') => {
          if (y < MARGIN + needed) addContinuationPage(continuationLabel);
        };

        const drawHealthHeader = () => {
          page.drawRectangle({ x: MARGIN, y: y - HDR_H, width: COL_W, height: HDR_H, color: gold });
          for (const [txt, px] of [['Cliente', MARGIN + 4], ['Etapa', MARGIN + 250], ['Score', MARGIN + 430]] as [string, number][]) {
            page.drawText(txt, { x: px, y: y - HDR_H + 6, size: 7, font: bold, color: white });
          }
          y -= HDR_H;
        };

        // Cabeçalho padrão (logo + azul)
        y = drawReportHeader(page, { regular, bold }, logoImg, { title: 'Relatório Estratégico — Visão Global', subtitle: `Período: ${period}` });

        // Indicadores
        page.drawText('INDICADORES DO PERIODO', { x: MARGIN, y, size: 10, font: bold, color: gold });
        y -= 18;
        for (const [label, value] of [
          ['Vendas Totais', String(globalMetrics.totalVendas)],
          ['Novos Leads', String(globalMetrics.novosLeads)],
          ['Taxa de Conversao', `${globalMetrics.taxaConversao.toFixed(1)}%`],
          ['Ciclo Medio de Vendas', globalMetrics.cicloMedioDias > 0 ? `${globalMetrics.cicloMedioDias} dias` : '—'],
        ] as [string, string][]) {
          page.drawText(`${label}:`, { x: MARGIN, y, size: 9, font: bold, color: dark });
          page.drawText(value, { x: MARGIN + 170, y, size: 9, font: regular, color: dark });
          y -= 14;
        }
        y -= 8;
        page.drawRectangle({ x: MARGIN, y, width: COL_W, height: 0.5, color: rgb(0.85, 0.85, 0.85) });
        y -= 16;

        // Forecast
        page.drawText('FORECAST COMERCIAL (PIPELINE PONDERADO)', { x: MARGIN, y, size: 10, font: bold, color: gold });
        y -= 18;
        page.drawText('Pipeline Ponderado Total:', { x: MARGIN, y, size: 9, font: bold, color: dark });
        page.drawText(brlFmt(forecastTotal), { x: MARGIN + 170, y, size: 9, font: regular, color: dark });
        y -= 14;
        y -= 8;
        page.drawRectangle({ x: MARGIN, y, width: COL_W, height: 0.5, color: rgb(0.85, 0.85, 0.85) });
        y -= 16;

        ensureSpace(64, 'Relatorio Estrategico (continuacao)');
        // Health Score
        page.drawText('HEALTH SCORE — TOP CLIENTES', { x: MARGIN, y, size: 10, font: bold, color: gold });
        y -= 16;
        if (healthScores.length > 0) {
          drawHealthHeader();
          let rowIdx = 0;
          for (const hs of healthScores) {
            ensureSpace(ROW_H + 10, 'Relatorio Estrategico (continuacao)');
            if (y > PAGE_H - MARGIN - 20) {
              page.drawText('HEALTH SCORE — TOP CLIENTES (continuacao)', { x: MARGIN, y, size: 10, font: bold, color: gold });
              y -= 16;
              drawHealthHeader();
            }
            const rc = rowIdx % 2 === 0 ? white : light;
            page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: COL_W, height: ROW_H, color: rc });
            page.drawText((hs.name ?? '—').slice(0, 45), { x: MARGIN + 4, y: y - ROW_H + 6, size: 7, font: regular, color: dark });
            page.drawText((hs.stage ?? '—').slice(0, 24), { x: MARGIN + 250, y: y - ROW_H + 6, size: 7, font: regular, color: dark });
            page.drawText(String(hs.score), { x: MARGIN + 430, y: y - ROW_H + 6, size: 7, font: regular, color: dark });
            y -= ROW_H;
            rowIdx++;
          }
        }

        addStandardFooters(pdfDoc, { regular, bold });

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        logAuditEvent({ action: 'document_downloaded', entity: 'report', entityId: fileName, metadata: { type: 'relatorio_global' } });
      } catch (err: any) {
        alert(`Erro ao gerar PDF: ${err.message}`);
      }
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="w-8 h-8 text-gold-500 animate-spin" />
    </div>
  );

  return (
    <div className="p-6 pb-24 min-h-screen bg-surface-50 print:bg-white print:p-0 print:min-h-0 print:h-auto print:block">
      <PageHeader
        eyebrow="Inteligência Estratégica"
        title="Relatórios"
        subtitle="Visão global de desempenho, forecast e health score."
      />

      {/* ── Period Filters ── */}
      <PeriodFilters period={period} onPeriodChange={handlePeriodChange} />

      <div className="print:hidden flex justify-end mb-6 relative">
        <button
          onClick={() => setIsExportMenuOpen(v => !v)}
          className="h-9 w-9 flex items-center justify-center rounded-lg border border-surface-200 bg-card-bg text-text-secondary hover:text-gold-700 hover:border-gold-300 shadow-sm transition-all"
        >
          <MoreHorizontal size={18} />
        </button>

        {isExportMenuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setIsExportMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-2 z-20 w-56 bg-card-bg border border-surface-200 rounded-xl shadow-xl overflow-hidden p-2">
              <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-text-secondary">Exportar relatório</p>
              <div className="space-y-1.5">
                <button
                  onClick={() => { setIsExportMenuOpen(false); handleExport('pdf'); }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 border border-surface-200 rounded-lg text-text-secondary text-[11px] font-semibold hover:text-gold-700 hover:bg-gold-50 transition-colors"
                >
                  <FileText size={14} /> PDF
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Metric Cards ── */}
      <section className="grid grid-cols-2 gap-3 mb-8">
        {metrics.map((metric) => (
          <MetricCard key={metric.id} {...metric} inverse={metric.label === 'Ciclo de Vendas'} />
        ))}
      </section>

      {/* ── Weighted Pipeline Chart ── */}
      <section className="mb-8 print:break-inside-avoid">
        <SectionHeader title="Forecast Comercial" subtitle="Pipeline Ponderado por Probabilidade de Estágio" />
        <PremiumCard className="p-4 h-80">
          <div className="flex justify-between items-center mb-4">
            <div>
              <p className="text-xs text-text-secondary uppercase">Receita Ponderada (Pipeline)</p>
              <h3 className="font-ui text-xl font-bold text-text-primary">
                R$ {(forecastTotal / 1000000).toFixed(2)}M
              </h3>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-text-secondary uppercase">Período</p>
              <p className="text-xs font-medium text-text-primary">{period}</p>
            </div>
          </div>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weightedPipeline}>
                <defs>
                  <linearGradient id="colorWeighted" x1="0" y1="0" x2="0" y2="1">
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
                  formatter={(val: number, name: string) => [
                    `R$ ${val.toFixed(0)}k`,
                    name === 'weighted' ? 'Pipeline Ponderado' : 'Confirmado',
                  ]}
                />
                <Area type="monotone" dataKey="weighted" stroke="#2563eb" strokeWidth={3} fillOpacity={1} fill="url(#colorWeighted)" />
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

      {/* ── Health Score ── */}
      <section>
        <SectionHeader title="Health Score Comercial" subtitle="Risco e Probabilidade — Ponderado" />
        <div className="space-y-3">
          {healthScores.length === 0
            ? <p className="text-sm text-text-secondary text-center py-8">Dados insuficientes para análise.</p>
            : healthScores.map((client) => (
              <PremiumCard key={client.id} className="flex items-center justify-between p-4 cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all" onClick={() => navigate(`/clients/${client.id}`)}>
                <div className="flex items-center gap-3">
                  <CircularScore score={client.score} />
                  <div>
                    <h4 className="font-bold text-text-primary text-sm">{client.name}</h4>
                    <p className="text-xs text-text-secondary">
                      {client.stage}{parseValue(client.potentialValue ?? '') > 0 ? ` • ${brl(parseValue(client.potentialValue ?? ''))}` : ''}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-text-secondary uppercase mb-0.5">Probabilidade</p>
                  <p className={`text-sm font-bold ${client.conversionProbability > 70 ? 'text-green-500' : client.conversionProbability > 40 ? 'text-amber-400' : 'text-red-500'}`}>
                    {client.conversionProbability}%
                  </p>
                </div>
              </PremiumCard>
            ))}
        </div>
      </section>

      {/* ── Por Coordenação (GERENTE) ── */}
      {isManager && (() => {
        const myCoords = allProfiles.filter(
          p => p.manager_id === profile?.id && p.role?.toUpperCase() === 'COORDENADOR'
        );
        if (myCoords.length === 0) return null;
        return (
          <section className="mt-8 print:hidden">
            <SectionHeader title="Relatório por Coordenação" subtitle="Análise segmentada por coordenador" />
            <div className="grid grid-cols-1 gap-3">
              {myCoords.map(coord => {
                const brokerCount = allProfiles.filter(p => p.coordinator_id === coord.id).length;
                return (
                  <PremiumCard
                    key={coord.id}
                    className="flex items-center justify-between p-4 cursor-pointer hover:border-purple-300 transition-colors"
                    onClick={() => navigate(`/reports?scope=coordenacao&id=${coord.id}&name=${encodeURIComponent(coord.name)}&start=${startDate}&end=${endDate}`)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                        <Users size={20} className="text-purple-500" />
                      </div>
                      <div>
                        <h4 className="font-bold text-text-primary">{coord.name}</h4>
                        <p className="text-xs text-text-secondary">{brokerCount} corretor{brokerCount !== 1 ? 'es' : ''}</p>
                      </div>
                    </div>
                    <span className="text-gold-600 font-medium text-sm">Ver Relatório →</span>
                  </PremiumCard>
                );
              })}
            </div>
          </section>
        );
      })()}

      {/* ── Por Equipe ── */}
      {canViewAllClients && (() => {
        const myDirectorateId = profile?.directorate_id || allProfiles.find(p => p.id === profile?.id)?.directorate_id;
        const visibleTeams = isAdmin
          ? teams
          : isDirector
            ? teams.filter(t => t.directorate_id && t.directorate_id === myDirectorateId)
            : isManager
              ? teams.filter(t => t.manager_id === profile?.id)
              : // COORDENADOR: só a equipe a que pertence
                teams.filter(t =>
                  t.members?.includes(profile?.id ?? '') ||
                  (!!currentUserProfile && profileMatchesTeam(currentUserProfile, t))
                );
        if (visibleTeams.length === 0) return null;
        return (
        <section className="mt-8 print:hidden">
          <SectionHeader title="Relatório por Equipe" subtitle="Análise segmentada por equipe comercial" />
          <div className="grid grid-cols-1 gap-3">
            {visibleTeams.map(team => {
              const memberCount = new Set([
                ...(team.members ?? []),
                ...allProfiles.filter(p => profileMatchesTeam(p, team)).map(p => p.id),
                ...(team.manager_id ? [team.manager_id] : []),
              ]).size;
              return (
                <PremiumCard
                  key={team.id}
                  className="flex items-center justify-between p-4 cursor-pointer hover:border-gold-300 transition-colors"
                  onClick={() => navigate(`/reports?scope=equipe&id=${team.id}&name=${encodeURIComponent(team.name)}&start=${startDate}&end=${endDate}`)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gold-50 dark:bg-gold-900/20 flex items-center justify-center">
                      <Shield size={20} className="text-gold-500" />
                    </div>
                    <div>
                      <h4 className="font-bold text-text-primary">{team.name}</h4>
                      <p className="text-xs text-text-secondary">{memberCount} membro{memberCount !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-gold-600 font-medium text-sm">
                    Ver Relatório →
                  </div>
                </PremiumCard>
              );
            })}
          </div>
        </section>
        );
      })()}

      {/* ── Custom Date Modal ── */}
      <Modal isOpen={isDateModalOpen} onClose={() => setIsDateModalOpen(false)} title="Período Personalizado">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Início</label>
            <input type="date" value={startDateInput} onChange={e => setStartDateInput(e.target.value)} className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Fim</label>
            <input type="date" value={endDateInput} onChange={e => setEndDateInput(e.target.value)} className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
          </div>
          <RoundedButton fullWidth onClick={applyCustomDate}>Aplicar Filtro</RoundedButton>
        </div>
      </Modal>
    </div>
  );
}
