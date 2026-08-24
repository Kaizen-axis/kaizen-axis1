import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  ArrowLeft, Download, Loader2, AlertTriangle,
  Users, CalendarCheck, TrendingDown, BarChart2,
} from 'lucide-react';
import { PremiumCard, SectionHeader, RoundedButton } from '@/components/ui/PremiumComponents';
import { useApp } from '@/context/AppContext';
import { logAuditEvent } from '@/services/auditLogger';
import { useAuthorization } from '@/hooks/useAuthorization';
import { supabase } from '@/lib/supabase';
import { X } from 'lucide-react';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { loadKaizenLogo, drawReportHeader, addStandardFooters } from '@/lib/pdf/reportKit';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Metrics {
  total_checkins: number;
  usuarios_ativos: number;
  usuarios_inativos: number;
  media_diaria: number;
}

interface DailyPoint { date: string; checkins: number; }
interface WeeklyPoint { week: string; week_key: string; checkins: number; }
interface DirPoint { name: string; checkins: number; }

interface RankingRow {
  id: string;
  name: string;
  directorate_id: string | null;
  team: string | null;
  dias_presenca: number;
  ultimo_checkin: string | null;
  taxa_presenca: number;
  leads_atendidos: number;
  vendas: number;
  score: number;
}

interface AlertRow {
  id: string;
  name: string;
  team: string | null;
  directorate_id: string | null;
  dias_ausente: number;
}

interface ReportData {
  metrics: Metrics;
  daily_presence: DailyPoint[];
  weekly_presence: WeeklyPoint[];
  by_directorate: DirPoint[];
  ranking: RankingRow[];
  alerts: AlertRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toISO = (d: Date) => d.toISOString().split('T')[0];

const subDays = (d: Date, n: number): Date => {
  const r = new Date(d);
  r.setDate(r.getDate() - n);
  return r;
};

const fmtDate = (s: string | null) => {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

const classify = (score: number) =>
  score >= 50 ? { label: 'Alto', icon: '🔥', color: 'text-orange-500' }
    : score >= 25 ? { label: 'Médio', icon: '⚡', color: 'text-yellow-500' }
      : { label: 'Baixo', icon: '⚠️', color: 'text-red-500' };

type Period = 'week' | 'month' | 'quarter' | 'semester' | 'year' | 'custom';

const PERIOD_LABELS: Record<Period, string> = {
  week: 'Última Semana',
  month: 'Último Mês',
  quarter: 'Último Trimestre',
  semester: 'Último Semestre',
  year: 'Último Ano',
  custom: 'Personalizado',
};

const PERIOD_DAYS: Record<Exclude<Period, 'custom'>, number> = {
  week: 7, month: 30, quarter: 90, semester: 180, year: 365,
};

// ─── Main Component ────────────────────────────────────────────────────────────

export default function PresenceReport() {
  const navigate = useNavigate();
  const { user, allProfiles, directorates, teams } = useApp();
  const { isAdmin, role } = useAuthorization();

  const isDirector = role === 'DIRETOR';
  const canFilterDir = isAdmin;
  // DIRETOR sees all teams within their directorate; ADMIN sees all
  const canFilterTeam = isAdmin || isDirector;

  // ── Filters ─────────────────────────────────────────────────────────────────
  const [period, setPeriod] = useState<Period>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [filterDir, setFilterDir] = useState('');
  const [filterTeam, setFilterTeam] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [activeModal, setActiveModal] = useState<'ativos' | 'inativos' | null>(null);

  // ── Data ────────────────────────────────────────────────────────────────────
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unique teams from all roles
  const teamOptions = Array.from(
    new Set(
      allProfiles
        .filter(p => p.team)
        .map(p => p.team as string)
    )
  ).sort();

  // Team name lookup
  const teamName = (id: string | null) =>
    id ? (teams.find(t => t.id === id)?.name ?? id) : '—';

  // Users for filter dropdown
  const userOptions = allProfiles
    .filter(p => {
      if (filterDir && p.directorate_id !== filterDir) return false;
      if (filterTeam && p.team !== filterTeam) return false;
      return true;
    })
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  // Directorate name lookup
  const dirName = (id: string | null) =>
    id ? (directorates.find(d => d.id === id)?.name ?? '—') : '—';

  // ── Compute date range ──────────────────────────────────────────────────────
  const getDateRange = (): { start: string; end: string } => {
    const today = new Date();
    if (period === 'custom') {
      return {
        start: customStart || toISO(subDays(today, 30)),
        end: customEnd || toISO(today),
      };
    }
    return {
      start: toISO(subDays(today, PERIOD_DAYS[period])),
      end: toISO(today),
    };
  };

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { start, end } = getDateRange();

    const { data: result, error: rpcErr } = await supabase.rpc('get_presence_report', {
      p_start: start,
      p_end: end,
      p_directorate: filterDir || null,
      p_team: filterTeam || null,
      p_corretor: filterUser || null,
      p_caller_id: user?.id ?? null,
    });

    if (rpcErr) {
      setError(rpcErr.message);
    } else {
      setData(result as ReportData);
    }

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customStart, customEnd, filterDir, filterTeam, filterUser, user?.id]);

  useEffect(() => {
    if (period !== 'custom' || (customStart && customEnd)) {
      fetchReport();
    }
  }, [fetchReport, period, customStart, customEnd]);

  // ── PDF Export ──────────────────────────────────────────────────────────────
  const exportPDF = async () => {
    if (!data) return;
    const { start, end } = getDateRange();
    setPdfLoading(true);
    try {
      const pdfDoc = await PDFDocument.create();
      const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const logoImg = await loadKaizenLogo(pdfDoc);
      const PAGE_W = 595, PAGE_H = 842, MARGIN = 36;
      const COL_W  = PAGE_W - MARGIN * 2;
      const gold   = rgb(0.145, 0.388, 0.922);
      const dark   = rgb(0.10, 0.10, 0.10);
      const gray   = rgb(0.45, 0.45, 0.45);
      const light  = rgb(0.96, 0.96, 0.96);
      const white  = rgb(1, 1, 1);
      const red    = rgb(0.75, 0.15, 0.15);

      let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      let y = PAGE_H - MARGIN;

      // ── Cabeçalho padrão (logo + azul) ──
      y = drawReportHeader(page, { regular, bold }, logoImg, { title: 'Relatório de Presença', subtitle: `Período: ${fmtDate(start)} – ${fmtDate(end)}` });

      // ── Métricas ──
      page.drawText('METRICAS', { x: MARGIN, y, size: 10, font: bold, color: gold });
      y -= 18;
      for (const [label, value] of [
        ['Total Check-ins', String(data.metrics.total_checkins)],
        ['Usuarios Ativos (7d)', String(data.metrics.usuarios_ativos)],
        ['Usuarios Inativos', String(data.metrics.usuarios_inativos)],
        ['Media Diaria', String(data.metrics.media_diaria)],
      ] as [string, string][]) {
        page.drawText(`${label}:`, { x: MARGIN, y, size: 9, font: bold, color: dark });
        page.drawText(value, { x: MARGIN + 170, y, size: 9, font: regular, color: dark });
        y -= 14;
      }
      y -= 8;
      page.drawRectangle({ x: MARGIN, y, width: COL_W, height: 0.5, color: rgb(0.85, 0.85, 0.85) });
      y -= 16;

      // ── Helper: tabela genérica ──
      const ROW_H = 16, HDR_H = 18;
      type TblCol = { label: string; w: number };

      const drawTableHeader = (pg: ReturnType<typeof pdfDoc.addPage>, startY: number, cols: TblCol[]) => {
        pg.drawRectangle({ x: MARGIN, y: startY - HDR_H + 4, width: COL_W, height: HDR_H, color: gold });
        let cx = MARGIN + 4;
        for (const col of cols) {
          pg.drawText(col.label, { x: cx, y: startY - 9, size: 7, font: bold, color: white });
          cx += col.w;
        }
        return startY - HDR_H;
      };

      const drawTableRow = (pg: ReturnType<typeof pdfDoc.addPage>, startY: number, cells: string[], cols: TblCol[], rowIdx: number) => {
        const rc = rowIdx % 2 === 0 ? white : light;
        pg.drawRectangle({ x: MARGIN, y: startY - ROW_H + 5, width: COL_W, height: ROW_H, color: rc });
        let cx = MARGIN + 4;
        for (let i = 0; i < cols.length; i++) {
          pg.drawText(cells[i] ?? '—', { x: cx, y: startY - 8, size: 7, font: regular, color: dark });
          cx += cols[i].w;
        }
        return startY - ROW_H;
      };

      // ── Ranking de Presença ──
      page.drawText('RANKING DE PRESENCA', { x: MARGIN, y, size: 10, font: bold, color: gold });
      y -= 16;

      const rankCols: TblCol[] = [
        { label: '#',        w: 20  },
        { label: 'Nome',     w: 140 },
        { label: 'Dias',     w: 40  },
        { label: 'Taxa%',    w: 45  },
        { label: 'Ult. CI',  w: 60  },
        { label: 'Score',    w: 40  },
        { label: 'Nivel',    w: 40  },
      ];

      y = drawTableHeader(page, y, rankCols);
      let rowIdx = 0;

      for (const [i, row] of data.ranking.entries()) {
        if (y < MARGIN + ROW_H + 20) {
          page = pdfDoc.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - MARGIN;
          page.drawText('Relatorio de Presenca (continuacao)', { x: MARGIN, y, size: 8, font: regular, color: gray });
          y -= 14;
          y = drawTableHeader(page, y, rankCols);
          rowIdx = 0;
        }
        y = drawTableRow(page, y, [
          String(i + 1),
          (row.name ?? '—').slice(0, 24),
          String(row.dias_presenca),
          `${row.taxa_presenca}%`,
          fmtDate(row.ultimo_checkin),
          String(row.score),
          classify(row.score).label,
        ], rankCols, rowIdx);
        rowIdx++;
      }

      y -= 10;
      page.drawRectangle({ x: MARGIN, y, width: COL_W, height: 0.5, color: rgb(0.85, 0.85, 0.85) });
      y -= 16;

      // ── Score de Engajamento ──
      if (y < MARGIN + 60) {
        page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
      }

      page.drawText('SCORE DE ENGAJAMENTO', { x: MARGIN, y, size: 10, font: bold, color: gold });
      y -= 16;

      const engCols: TblCol[] = [
        { label: 'Nome',     w: 160 },
        { label: 'Presenca', w: 60  },
        { label: 'Leads',    w: 55  },
        { label: 'Vendas',   w: 55  },
        { label: 'Score',    w: 45  },
        { label: 'Nivel',    w: 48  },
      ];

      y = drawTableHeader(page, y, engCols);
      rowIdx = 0;

      for (const row of [...data.ranking].sort((a, b) => b.score - a.score)) {
        if (y < MARGIN + ROW_H + 20) {
          page = pdfDoc.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - MARGIN;
          page.drawText('Score de Engajamento (continuacao)', { x: MARGIN, y, size: 8, font: regular, color: gray });
          y -= 14;
          y = drawTableHeader(page, y, engCols);
          rowIdx = 0;
        }
        y = drawTableRow(page, y, [
          (row.name ?? '—').slice(0, 28),
          String(row.dias_presenca),
          String(row.leads_atendidos),
          String(row.vendas),
          String(row.score),
          classify(row.score).label,
        ], engCols, rowIdx);
        rowIdx++;
      }

      // ── Alertas de Ausência ──
      if (data.alerts.length > 0) {
        if (y < MARGIN + 60) {
          page = pdfDoc.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - MARGIN;
        }
        y -= 10;
        page.drawRectangle({ x: MARGIN, y, width: COL_W, height: 0.5, color: rgb(0.85, 0.85, 0.85) });
        y -= 16;
        page.drawText(`ALERTAS DE AUSENCIA (${data.alerts.length})`, { x: MARGIN, y, size: 10, font: bold, color: red });
        y -= 16;
        for (const a of data.alerts) {
          if (y < MARGIN + 14) {
            page = pdfDoc.addPage([PAGE_W, PAGE_H]);
            y = PAGE_H - MARGIN;
          }
          page.drawText(`• ${(a.name ?? '').slice(0, 42)}  —  ausente ha ${a.dias_ausente} dias`, { x: MARGIN, y, size: 9, font: regular, color: red });
          y -= 13;
        }
      }

      // ── Rodapé padrão em todas as páginas ──
      addStandardFooters(pdfDoc, { regular, bold });

      // ── Download ──
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `presenca_${start}_${end}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      logAuditEvent({ action: 'document_downloaded', entity: 'report', entityId: `presenca_${start}_${end}`, metadata: { type: 'relatorio_presenca', start, end } });

    } catch (err: any) {
      alert(`Erro ao gerar PDF: ${err.message}`);
    } finally {
      setPdfLoading(false);
    }
  };

  // ── Modal logic ────────────────────────────────────────────────────────
  const getModalUsers = () => {
    if (!data || !activeModal) return [];

    // We use a simpler 7-day cutoff for Ativos/Inativos
    // It's the same logic use in the RPC but done in JS for the modal 
    const isAtivo = (ultimo_checkin: string | null) => {
      if (!ultimo_checkin) return false;
      const ciDate = new Date(ultimo_checkin).getTime();
      const cutoff = new Date().getTime() - 7 * 24 * 60 * 60 * 1000;
      return ciDate >= cutoff;
    };

    return data.ranking.filter(r =>
      activeModal === 'ativos' ? isAtivo(r.ultimo_checkin) : !isAtivo(r.ultimo_checkin)
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 pb-28 min-h-screen bg-surface-50">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-5 gap-3">
        <div>
          <button
            onClick={() => navigate(isAdmin ? '/admin' : '/')}
            className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-gold-600 font-medium mb-2 transition-colors"
          >
            <ArrowLeft size={13} /> Voltar
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gold-100 dark:bg-gold-900/30 flex items-center justify-center">
              <CalendarCheck size={20} className="text-gold-600 dark:text-gold-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-text-primary tracking-tight">Relatório de Presença</h1>
              <p className="text-xs text-text-secondary">Score de engajamento dos usuários</p>
            </div>
          </div>
        </div>
        <RoundedButton size="sm" variant="outline" onClick={exportPDF} disabled={!data || pdfLoading}>
          {pdfLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {pdfLoading ? 'Gerando...' : 'Exportar PDF'}
        </RoundedButton>
      </div>

      {/* ── Filtros ─────────────────────────────────────────────────────────── */}
      <PremiumCard className="mb-5 p-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">Filtros</p>
        <div className="flex flex-wrap gap-3">

          {/* Período */}
          <div className="flex flex-col gap-1 min-w-[150px]">
            <label className="text-[11px] text-text-secondary">Período</label>
            <select
              value={period}
              onChange={e => setPeriod(e.target.value as Period)}
              className="text-sm bg-surface-100 border border-surface-200 rounded-xl px-3 py-2 text-text-primary focus:outline-none focus:border-gold-400"
            >
              {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
                <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
              ))}
            </select>
          </div>

          {/* Custom date range */}
          {period === 'custom' && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-secondary">De</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={e => setCustomStart(e.target.value)}
                  className="text-sm bg-surface-100 border border-surface-200 rounded-xl px-3 py-2 text-text-primary focus:outline-none focus:border-gold-400"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-secondary">Até</label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)}
                  className="text-sm bg-surface-100 border border-surface-200 rounded-xl px-3 py-2 text-text-primary focus:outline-none focus:border-gold-400"
                />
              </div>
            </>
          )}

          {/* Diretoria — ADMIN only */}
          {canFilterDir && (
            <div className="flex flex-col gap-1 min-w-[150px]">
              <label className="text-[11px] text-text-secondary">Diretoria</label>
              <select
                value={filterDir}
                onChange={e => { setFilterDir(e.target.value); setFilterTeam(''); setFilterUser(''); }}
                className="text-sm bg-surface-100 border border-surface-200 rounded-xl px-3 py-2 text-text-primary focus:outline-none focus:border-gold-400"
              >
                <option value="">Todas</option>
                {directorates.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Equipe */}
          {canFilterTeam && (
            <div className="flex flex-col gap-1 min-w-[150px]">
              <label className="text-[11px] text-text-secondary">Equipe</label>
              <select
                value={filterTeam}
                onChange={e => { setFilterTeam(e.target.value); setFilterUser(''); }}
                className="text-sm bg-surface-100 border border-surface-200 rounded-xl px-3 py-2 text-text-primary focus:outline-none focus:border-gold-400"
              >
                <option value="">Todas</option>
                {teamOptions.map(t => (
                  <option key={t} value={t}>{teamName(t)}</option>
                ))}
              </select>
            </div>
          )}

          {/* Usuário */}
          <div className="flex flex-col gap-1 min-w-[150px]">
            <label className="text-[11px] text-text-secondary">Usuário</label>
            <select
              value={filterUser}
              onChange={e => setFilterUser(e.target.value)}
              className="text-sm bg-surface-100 border border-surface-200 rounded-xl px-3 py-2 text-text-primary focus:outline-none focus:border-gold-400"
            >
              <option value="">Todos</option>
              {userOptions.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

        </div>
      </PremiumCard>

      {/* ── Loading ─────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 text-gold-500 animate-spin" />
          <p className="text-sm text-text-secondary">Carregando relatório…</p>
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {!loading && error && (
        <PremiumCard className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertTriangle size={36} className="text-red-400" />
          <p className="font-semibold text-text-primary">Erro ao carregar relatório</p>
          <p className="text-sm text-text-secondary">{error}</p>
          <RoundedButton size="sm" onClick={fetchReport}>Tentar novamente</RoundedButton>
        </PremiumCard>
      )}

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      {!loading && !error && data && (
        <>
          {/* ── Métricas ──────────────────────────────────────────────────── */}
          <section className="grid grid-cols-2 gap-3 mb-5">
            <MetricBlock
              icon={<CalendarCheck size={18} className="text-gold-600" />}
              label="Total Check-ins"
              value={data.metrics.total_checkins.toString()}
              bg="bg-accent-subtle"
            />
            <MetricBlock
              icon={<Users size={18} className="text-green-600" />}
              label="Ativos (7 dias)"
              value={data.metrics.usuarios_ativos.toString()}
              bg="bg-green-50 dark:bg-green-900/20"
              onClick={() => setActiveModal('ativos')}
            />
            <MetricBlock
              icon={<TrendingDown size={18} className="text-red-500" />}
              label="Inativos"
              value={data.metrics.usuarios_inativos.toString()}
              bg="bg-red-50 dark:bg-red-900/20"
              onClick={() => setActiveModal('inativos')}
            />
            <MetricBlock
              icon={<BarChart2 size={18} className="text-blue-500" />}
              label="Média Diária"
              value={data.metrics.media_diaria.toString()}
              bg="bg-blue-50 dark:bg-blue-900/20"
            />
          </section>

          {/* ── Gráfico: Presença Diária ───────────────────────────────────── */}
          {data.daily_presence.length > 0 && (
            <section className="mb-5">
              <SectionHeader title="Presença Diária" subtitle="Check-ins por dia no período" />
              <PremiumCard className="p-4">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={data.daily_presence} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-200, #e5e7eb)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }}
                      tickFormatter={v => {
                        const [, m, d] = v.split('-');
                        return `${d}/${m}`;
                      }}
                    />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }} allowDecimals={false} />
                    <Tooltip
                      formatter={(v: number) => [v, 'Check-ins']}
                      labelFormatter={l => `Data: ${fmtDate(l)}`}
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="checkins"
                      stroke="#d4a017"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </PremiumCard>
            </section>
          )}

          {/* ── Gráfico: Presença Semanal ──────────────────────────────────── */}
          {data.weekly_presence.length > 0 && (
            <section className="mb-5">
              <SectionHeader title="Presença Semanal" subtitle="Totais agrupados por semana" />
              <PremiumCard className="p-4">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={data.weekly_presence} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-200, #e5e7eb)" vertical={false} />
                    <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }} allowDecimals={false} />
                    <Tooltip formatter={(v: number) => [v, 'Check-ins']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="checkins" fill="#d4a017" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </PremiumCard>
            </section>
          )}

          {/* ── Gráfico: Por Diretoria ─────────────────────────────────────── */}
          {canFilterDir && data.by_directorate.length > 0 && (
            <section className="mb-5">
              <SectionHeader title="Por Diretoria" subtitle="Check-ins agrupados por diretoria" />
              <PremiumCard className="p-4">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart
                    data={data.by_directorate}
                    layout="vertical"
                    margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-200, #e5e7eb)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }}
                      width={90}
                    />
                    <Tooltip formatter={(v: number) => [v, 'Check-ins']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="checkins" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </PremiumCard>
            </section>
          )}

          {/* ── Ranking de Presença ───────────────────────────────────────── */}
          {data.ranking.length > 0 && (
            <section className="mb-5">
              <SectionHeader title="Ranking de Presença" subtitle={`${data.ranking.length} usuários`} />
              <PremiumCard className="p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-200 bg-surface-50">
                        <th className="text-left p-3 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">#</th>
                        <th className="text-left p-3 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Nome</th>
                        {canFilterDir && (
                          <th className="text-left p-3 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Diretoria</th>
                        )}
                        <th className="text-center p-3 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Dias</th>
                        <th className="text-center p-3 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Taxa</th>
                        <th className="text-left p-3 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Último</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ranking.map((row, i) => (
                        <tr key={row.id} className="border-b border-surface-100 hover:bg-surface-50 transition-colors">
                          <td className="p-3 text-text-secondary font-mono text-xs">{i + 1}</td>
                          <td className="p-3 font-medium text-text-primary">
                            {row.name}
                            {row.team && (
                              <span className="ml-1.5 text-[10px] text-text-secondary bg-surface-100 px-1.5 py-0.5 rounded-sm">{teamName(row.team)}</span>
                            )}
                          </td>
                          {canFilterDir && (
                            <td className="p-3 text-xs text-text-secondary">{dirName(row.directorate_id)}</td>
                          )}
                          <td className="p-3 text-center font-semibold text-text-primary">{row.dias_presenca}</td>
                          <td className="p-3 text-center">
                            <span className={`text-xs font-bold ${row.taxa_presenca >= 80 ? 'text-green-600' : row.taxa_presenca >= 50 ? 'text-gold-600' : 'text-red-500'}`}>
                              {row.taxa_presenca}%
                            </span>
                          </td>
                          <td className="p-3 text-xs text-text-secondary">{fmtDate(row.ultimo_checkin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </PremiumCard>
            </section>
          )}

          {/* ── Score de Engajamento ──────────────────────────────────────── */}
          {data.ranking.length > 0 && (
            <section className="mb-5">
              <SectionHeader
                title="Score de Engajamento"
                subtitle="Presença × 2 + Leads × 1 + Vendas × 5"
              />
              <PremiumCard className="p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-200 bg-surface-50">
                        <th className="text-left p-3 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Nome</th>
                        <th className="text-center p-3 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Presença</th>
                        <th className="text-center p-3 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Leads</th>
                        <th className="text-center p-3 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Vendas</th>
                        <th className="text-center p-3 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Score</th>
                        <th className="text-center p-3 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Nível</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.ranking]
                        .sort((a, b) => b.score - a.score)
                        .map(row => {
                          const eng = classify(row.score);
                          return (
                            <tr key={row.id} className="border-b border-surface-100 hover:bg-surface-50 transition-colors">
                              <td className="p-3 font-medium text-text-primary">{row.name}</td>
                              <td className="p-3 text-center text-text-primary">{row.dias_presenca}</td>
                              <td className="p-3 text-center text-text-primary">{row.leads_atendidos}</td>
                              <td className="p-3 text-center text-text-primary">{row.vendas}</td>
                              <td className="p-3 text-center font-bold text-text-primary">{row.score}</td>
                              <td className="p-3 text-center">
                                <span className={`text-sm font-semibold ${eng.color}`}>
                                  {eng.icon} {eng.label}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </PremiumCard>
            </section>
          )}

          {/* ── Alertas ───────────────────────────────────────────────────── */}
          {data.alerts.length > 0 && (
            <section className="mb-5">
              <SectionHeader
                title="Alertas de Ausência"
                subtitle={`${data.alerts.length} usuários sem check-in há mais de 10 dias`}
              />
              <div className="flex flex-col gap-2">
                {data.alerts.map(a => (
                  <PremiumCard key={a.id} className="p-3 flex items-center gap-3 border-l-4 border-red-400">
                    <AlertTriangle size={18} className="text-red-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-text-primary text-sm">{a.name}</p>
                      <p className="text-xs text-text-secondary">
                        {a.team && `Equipe ${teamName(a.team)} · `}
                        {a.directorate_id && `${dirName(a.directorate_id)} · `}
                        Ausente há {a.dias_ausente} dias
                      </p>
                    </div>
                    <span className="text-xs font-bold text-red-500 shrink-0">
                      {a.dias_ausente}d
                    </span>
                  </PremiumCard>
                ))}
              </div>
            </section>
          )}

          {/* ── Empty state ───────────────────────────────────────────────── */}
          {data.ranking.length === 0 && (
            <PremiumCard className="flex flex-col items-center gap-3 py-12 text-center">
              <Users size={36} className="text-text-secondary opacity-40" />
              <p className="font-semibold text-text-primary">Nenhum dado no período</p>
              <p className="text-sm text-text-secondary">Ajuste os filtros ou aguarde que os usuários realizem check-in.</p>
            </PremiumCard>
          )}
          {/* ── Modal de Ativos / Inativos ────────────────────────────────── */}
          {activeModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
              <PremiumCard className="w-full max-w-md max-h-[80vh] flex flex-col p-0">
                <div className="flex items-center justify-between p-4 border-b border-surface-200">
                  <h3 className="font-bold text-text-primary">
                    Usuários {activeModal === 'ativos' ? 'Ativos (Últimos 7 dias)' : 'Inativos'}
                  </h3>
                  <button onClick={() => setActiveModal(null)} className="p-2 text-text-secondary hover:bg-surface-100 rounded-full transition-colors">
                    <X size={20} />
                  </button>
                </div>
                <div className="p-4 overflow-y-auto space-y-2">
                  {getModalUsers().map(u => (
                    <div key={u.id} className="flex flex-col p-3 rounded-xl border border-surface-200 bg-surface-50">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-sm text-text-primary">{u.name}</span>
                        <span className="text-[10px] text-text-secondary uppercase">{u.team ? teamName(u.team) : 'Sem Equipe'}</span>
                      </div>
                      <div className="text-xs text-text-secondary mt-1">
                        Último Check-in: <span className="font-medium">{fmtDate(u.ultimo_checkin)}</span>
                      </div>
                    </div>
                  ))}
                  {getModalUsers().length === 0 && (
                    <div className="text-center text-text-secondary py-8">Nenhum usuário encontrado.</div>
                  )}
                </div>
              </PremiumCard>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── MetricBlock (local card) ─────────────────────────────────────────────────

function MetricBlock({
  icon, label, value, bg, onClick
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  bg: string;
  onClick?: () => void;
}) {
  return (
    <PremiumCard
      interactive={!!onClick}
      className="p-4 flex flex-col gap-2"
      onClick={onClick}
    >
      <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center`}>
        {icon}
      </div>
      <p className="text-[11px] text-text-secondary uppercase tracking-wide leading-tight">{label}</p>
      <p className="text-2xl font-bold text-text-primary leading-none">{value}</p>
    </PremiumCard>
  );
}
