import { useState } from 'react';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { loadKaizenLogo, drawReportHeader, addStandardFooters } from '@/lib/pdf/reportKit';
import { SectionHeader, PageHeader, PremiumCard, RoundedButton } from '@/components/ui/PremiumComponents';
import { MetricCard } from '@/components/reports/MetricCard';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, Users, Shield, MoreHorizontal, FileText } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { logAuditEvent } from '@/services/auditLogger';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useReportsData } from '@/hooks/useReportsData';
import { toDateOnlyLocal, toPtBrDate } from '@/lib/dateRange';
import { buildReportHref } from '@/lib/reports/reportNav';
import { profileMatchesTeam } from '@/lib/reports/teamMembers';
import { PeriodFilters } from './reports/PeriodFilters';
import { DiretoriaReportView } from './reports/DiretoriaReportView';
import { TeamReportView } from './reports/TeamReportView';
import { CoordReportView } from './reports/CoordReportView';
import { BrokerReportView } from './reports/BrokerReportView';

function periodToDates(period: string): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  if (period === 'Mês vigente') {
    start.setDate(1);
  } else if (period === '30 dias') start.setDate(end.getDate() - 30);
  else if (period === '60 dias') start.setDate(end.getDate() - 60);
  else if (period === '90 dias') start.setDate(end.getDate() - 90);
  else {
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

function CustomDateModal({
  isOpen, onClose, startDateInput, endDateInput, setStartDateInput, setEndDateInput, onApply,
}: {
  isOpen: boolean;
  onClose: () => void;
  startDateInput: string;
  endDateInput: string;
  setStartDateInput: (v: string) => void;
  setEndDateInput: (v: string) => void;
  onApply: () => void;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Período Personalizado">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Início</label>
          <input type="date" value={startDateInput} onChange={(e) => setStartDateInput(e.target.value)} className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Fim</label>
          <input type="date" value={endDateInput} onChange={(e) => setEndDateInput(e.target.value)} className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
        </div>
        <RoundedButton fullWidth onClick={onApply}>Aplicar Filtro</RoundedButton>
      </div>
    </Modal>
  );
}

export default function Reports() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { loading, teams, allProfiles, profile } = useApp();
  const { isAdmin, isDirector, isManager, isCoordinator, canViewAllClients } = useAuthorization();

  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [startDateInput, setStartDateInput] = useState('');
  const [endDateInput, setEndDateInput] = useState('');

  const scope = searchParams.get('scope') ?? 'global';
  const scopeId = searchParams.get('id') ?? '';
  const scopeName = decodeURIComponent(searchParams.get('name') ?? '');
  const from = searchParams.get('from');
  const fromId = searchParams.get('fromId');
  const fromName = searchParams.get('fromName') ? decodeURIComponent(searchParams.get('fromName') as string) : null;
  const currentUserProfile = allProfiles.find((p) => p.id === profile?.id);
  const defaultPeriod = 'Mês vigente';
  const queryStart = searchParams.get('start');
  const queryEnd = searchParams.get('end');
  const period = (queryStart && queryEnd)
    ? `${toPtBrDate(queryStart)} - ${toPtBrDate(queryEnd)}`
    : (searchParams.get('period') ?? defaultPeriod);

  const { start: startDate, end: endDate } = periodToDates(period);
  const { globalMetrics, weightedPipeline, forecastTotal } = useReportsData({ startDate, endDate });

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

  const dateModal = (
    <CustomDateModal
      isOpen={isDateModalOpen}
      onClose={() => setIsDateModalOpen(false)}
      startDateInput={startDateInput}
      endDateInput={endDateInput}
      setStartDateInput={setStartDateInput}
      setEndDateInput={setEndDateInput}
      onApply={applyCustomDate}
    />
  );

  const canOpenDiretoria = isAdmin || (isDirector && profile?.directorate_id === scopeId);
  if (scope === 'diretoria' && scopeId && canOpenDiretoria) {
    return (
      <>
        <DiretoriaReportView dirId={scopeId} dirName={scopeName || 'Diretoria'} startDate={startDate} endDate={endDate} period={period} onPeriodChange={handlePeriodChange} />
        {dateModal}
      </>
    );
  }

  if (scope === 'equipe' && scopeId && canViewAllClients) {
    const teamObj = teams.find((t) => t.id === scopeId);
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
          {dateModal}
        </>
      );
    }
  }

  if (scope === 'coordenacao' && scopeId && (isAdmin || isManager || (isCoordinator && profile?.id === scopeId))) {
    return (
      <>
        <CoordReportView
          coordId={scopeId}
          coordName={scopeName || 'Coordenação'}
          from={from}
          fromId={fromId}
          fromName={fromName}
          startDate={startDate}
          endDate={endDate}
          period={period}
          onPeriodChange={handlePeriodChange}
        />
        {dateModal}
      </>
    );
  }

  if (scope === 'corretor' && scopeId && canViewAllClients) {
    return (
      <>
        <BrokerReportView
          brokerId={scopeId}
          brokerName={scopeName || 'Corretor'}
          from={from}
          fromId={fromId}
          fromName={fromName}
          startDate={startDate}
          endDate={endDate}
          period={period}
          onPeriodChange={handlePeriodChange}
        />
        {dateModal}
      </>
    );
  }

  const metrics = [
    { id: '1', label: 'Vendas Totais', value: globalMetrics.totalVendas.toString(), change: '', trend: 'up' as const, period: `no período de ${period}` },
    { id: '2', label: 'Novos Leads', value: globalMetrics.novosLeads.toString(), change: '', trend: 'up' as const, period: `no período de ${period}` },
    { id: '3', label: 'Taxa de Conversão', value: `${globalMetrics.taxaConversao.toFixed(1)}%`, change: '', trend: 'up' as const, period: `no período de ${period}` },
    { id: '4', label: 'Ciclo de Vendas', value: globalMetrics.cicloMedioDias > 0 ? `${globalMetrics.cicloMedioDias} dias` : '— dias', change: '', trend: 'down' as const, period: 'média real' },
  ];

  const handleExport = async (format: 'pdf' | 'excel') => {
    const fileName = `relatorio_estrategico_${new Date().toISOString().split('T')[0]}.${format === 'excel' ? 'csv' : 'pdf'}`;
    if (format === 'excel') {
      const headers = ['Métrica', 'Valor'];
      const rows = [
        ['Vendas Totais', String(globalMetrics.totalVendas)],
        ['Novos Leads', String(globalMetrics.novosLeads)],
        ['Taxa de Conversão', `${globalMetrics.taxaConversao.toFixed(1)}%`],
        ['Ciclo Médio (dias)', String(globalMetrics.cicloMedioDias)],
      ];
      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', fileName);
      link.click();
    } else {
      try {
        const pdfDoc = await PDFDocument.create();
        const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const logoImg = await loadKaizenLogo(pdfDoc);
        const PAGE_W = 595, PAGE_H = 842, MARGIN = 36;
        const gold = rgb(0.145, 0.388, 0.922);
        const dark = rgb(0.10, 0.10, 0.10);
        const brlFmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

        const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        let y = PAGE_H - MARGIN;
        y = drawReportHeader(page, { regular, bold }, logoImg, { title: 'Relatório Estratégico — Visão Global', subtitle: `Período: ${period}` });
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
        page.drawRectangle({ x: MARGIN, y, width: PAGE_W - MARGIN * 2, height: 0.5, color: rgb(0.85, 0.85, 0.85) });
        y -= 16;
        page.drawText('FORECAST COMERCIAL (PIPELINE PONDERADO)', { x: MARGIN, y, size: 10, font: bold, color: gold });
        y -= 18;
        page.drawText('Pipeline Ponderado Total:', { x: MARGIN, y, size: 9, font: bold, color: dark });
        page.drawText(brlFmt(forecastTotal), { x: MARGIN + 170, y, size: 9, font: regular, color: dark });

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
        subtitle="Visão global de desempenho e forecast comercial."
      />

      <PeriodFilters period={period} onPeriodChange={handlePeriodChange} />

      <div className="print:hidden flex justify-end mb-6 relative">
        <button
          onClick={() => setIsExportMenuOpen((v) => !v)}
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

      <section className="grid grid-cols-2 gap-3 mb-8">
        {metrics.map((metric) => (
          <MetricCard key={metric.id} {...metric} inverse={metric.label === 'Ciclo de Vendas'} />
        ))}
      </section>

      <section className="mb-8 print:break-inside-avoid">
        <SectionHeader title="Forecast Comercial" subtitle="Pipeline Ponderado por Probabilidade de Estágio" />
        <PremiumCard className="p-4 h-80">
          <div className="flex justify-between items-center mb-4">
            <div>
              <p className="text-xs text-text-secondary uppercase">Receita Ponderada (Pipeline)</p>
              <h3 className="font-ui text-xl font-bold text-text-primary">R$ {(forecastTotal / 1000000).toFixed(2)}M</h3>
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
                  formatter={(val: number, name: string) => [`R$ ${val.toFixed(0)}k`, name === 'weighted' ? 'Pipeline Ponderado' : 'Confirmado']}
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

      {isManager && (() => {
        const myCoords = allProfiles.filter(
          (p) => p.manager_id === profile?.id && p.role?.toUpperCase() === 'COORDENADOR',
        );
        if (myCoords.length === 0) return null;
        return (
          <section className="mt-8 print:hidden">
            <SectionHeader title="Relatório por Coordenação" subtitle="Análise segmentada por coordenador" />
            <div className="grid grid-cols-1 gap-3">
              {myCoords.map((coord) => {
                const brokerCount = allProfiles.filter((p) => p.coordinator_id === coord.id).length;
                return (
                  <PremiumCard
                    key={coord.id}
                    className="flex items-center justify-between p-4 cursor-pointer hover:border-purple-300 transition-colors"
                    onClick={() => navigate(buildReportHref({
                      scope: 'coordenacao',
                      id: coord.id,
                      name: coord.name,
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

      {canViewAllClients && (() => {
        const myDirectorateId = profile?.directorate_id || allProfiles.find((p) => p.id === profile?.id)?.directorate_id;
        const visibleTeams = isAdmin
          ? teams
          : isDirector
            ? teams.filter((t) => t.directorate_id && t.directorate_id === myDirectorateId)
            : isManager
              ? teams.filter((t) => t.manager_id === profile?.id)
              : teams.filter((t) =>
                t.members?.includes(profile?.id ?? '') ||
                (!!currentUserProfile && profileMatchesTeam(currentUserProfile, t))
              );
        if (visibleTeams.length === 0) return null;
        return (
          <section className="mt-8 print:hidden">
            <SectionHeader title="Relatório por Equipe" subtitle="Análise segmentada por equipe comercial" />
            <div className="grid grid-cols-1 gap-3">
              {visibleTeams.map((team) => {
                const memberCount = new Set([
                  ...(team.members ?? []),
                  ...allProfiles.filter((p) => profileMatchesTeam(p, team)).map((p) => p.id),
                  ...(team.manager_id ? [team.manager_id] : []),
                ]).size;
                return (
                  <PremiumCard
                    key={team.id}
                    className="flex items-center justify-between p-4 cursor-pointer hover:border-gold-300 transition-colors"
                    onClick={() => navigate(buildReportHref({
                      scope: 'equipe',
                      id: team.id,
                      name: team.name,
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
                        <p className="text-xs text-text-secondary">{memberCount} membro{memberCount !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-gold-600 font-medium text-sm">Ver Relatório →</div>
                  </PremiumCard>
                );
              })}
            </div>
          </section>
        );
      })()}

      {dateModal}
    </div>
  );
}
