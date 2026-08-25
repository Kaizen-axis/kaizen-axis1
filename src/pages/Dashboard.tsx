import { useMemo, useState } from 'react';
import { PremiumCard, SectionHeader } from '@/components/ui/PremiumComponents';
import { Loader2, Users, TrendingUp, Target, Calendar, ChevronDown } from 'lucide-react';
import { SalesProgressCard } from '@/components/dashboard/SalesProgressCard';
import { FunnelChart } from '@/components/ui/FunnelChart';
import { useNavigate } from 'react-router-dom';

import { AnnouncementCard } from '@/components/admin/AnnouncementCard';
import { useApp, Goal } from '@/context/AppContext';
import { isGoalVisibleToUser } from '@/lib/admin/scopeTarget';
import { useAuthorization } from '@/hooks/useAuthorization';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { GamificationProfile } from '@/components/gamification/GamificationProfile';
import { LeaderboardPanel } from '@/components/gamification/LeaderboardPanel';
import { parseDateOnlyLocal, parseDateOnlyLocalEnd, toDateOnlyLocal, toPtBrDate } from '@/lib/dateRange';
import { getDashboardSaleDate } from '@/lib/sales/salePeriod';
import { useGsapReveal } from '@/lib/motion';
import { CountNumber } from '@/components/dashboard/CountNumber';
import { DiretoriaCardGrid } from './reports/DiretoriaCardGrid';

export default function Dashboard() {
  const navigate = useNavigate();
  const { clients, appointments, goals, announcements, userName, loading, directorates, allProfiles, profile, user, teams } = useApp();
  const { isAdmin, isDirector, isManager, isCoordinator, isBroker, directorateId, role } = useAuthorization();

  const [period, setPeriod] = useState<'este_mes' | '30_dias' | '60_dias' | '90_dias' | 'custom'>('este_mes');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [mobilePeriodOpen, setMobilePeriodOpen] = useState(false);

  const { periodStart, periodEnd, periodLabel } = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);

    if (period === 'este_mes') {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    } else if (period === '30_dias') {
      start.setDate(end.getDate() - 30);
      start.setHours(0, 0, 0, 0);
    } else if (period === '60_dias') {
      start.setDate(end.getDate() - 60);
      start.setHours(0, 0, 0, 0);
    } else if (period === '90_dias') {
      start.setDate(end.getDate() - 90);
      start.setHours(0, 0, 0, 0);
    } else if (period === 'custom') {
      if (customStartDate && customEndDate) {
        const cs = parseDateOnlyLocal(customStartDate);
        const ce = parseDateOnlyLocalEnd(customEndDate);
        return {
          periodStart: cs,
          periodEnd: ce,
          periodLabel: `${toPtBrDate(customStartDate)} - ${toPtBrDate(customEndDate)}`,
        };
      }
      start.setDate(end.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      return { periodStart: start, periodEnd: end, periodLabel: 'Personalizado (30 dias até definir datas)' };
    }

    const labels: Record<string, string> = {
      este_mes: 'Este mês',
      '30_dias': '30 dias',
      '60_dias': '60 dias',
      '90_dias': '90 dias',
      custom: 'Personalizado',
    };
    return { periodStart: start, periodEnd: end, periodLabel: labels[period] || '30 dias' };
  }, [period, customStartDate, customEndDate]);

  const periodStartYmd = toDateOnlyLocal(periodStart);
  const periodEndYmd = toDateOnlyLocal(periodEnd);

  // Active announcements from the real database
  const today = new Date().toISOString().slice(0, 10);
  const activeAnnouncements = announcements.filter(a => {
    if (!a.start_date || !a.end_date) return true;
    return a.start_date <= today && a.end_date >= today;
  });

  // ── Data is already scoped by RLS on the backend ──────────────────────────
  const scopedClients = clients;
  const inSelectedPeriod = (isoLike?: string | null) => {
    if (!isoLike) return false;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(isoLike)
      ? parseDateOnlyLocal(isoLike)
      : new Date(isoLike);
    return d >= periodStart && d <= periodEnd;
  };

  const getSaleReferenceDate = (client: any): string | null => getDashboardSaleDate(client, periodEnd);

  const periodClients = scopedClients.filter(c => inSelectedPeriod(c.createdAt));
  const periodSales = scopedClients.filter(c => c.stage === 'Concluído' && inSelectedPeriod(getSaleReferenceDate(c)));

  const totalSales = periodSales.length;
  const emAnalise = periodClients.filter(c => c.stage === 'Em Análise').length;
  const aprovados = periodClients.filter(c => c.stage === 'Aprovado').length;
  const totalClients = periodClients.length;

  // Upcoming appointments for this user's scope
  const todayStr = new Date().toISOString().slice(0, 10);
  const allUpcomingAppointments = appointments.filter(a => a.date >= todayStr);
  const upcomingAppointments = allUpcomingAppointments.slice(0, 5);
  const upcomingAppointmentsTotal = allUpcomingAppointments.length;

  // Role label for header
  const roleLabel: Record<string, string> = {
    ADMIN: '🔑 Administrador',
    DIRETOR: '🏢 Diretor',
    GERENTE: '👥 Gerente',
    COORDENADOR: '📋 Coordenador',
    CORRETOR: '🏠 Corretor',
  };

  // Ranking Mock for Corretor (In a real scenario, fetch total_sales from backend)
  const topCorretores = [...allProfiles]
    .filter(p => p.role === 'CORRETOR' || p.role === 'Corretor' || p.role === 'corretor')
    .slice(0, 3);

  return (
    <div ref={useGsapReveal<HTMLDivElement>()} className="p-6 space-y-8">
      {/* Header — editorial */}
      <div data-reveal className="flex justify-between items-start border-b border-surface-200 pb-6 pt-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-400">{roleLabel[role] ?? 'Visão geral'}</p>
          <h1 className="v3-serif mt-2 text-2xl sm:text-3xl text-text-primary flex items-center gap-2 tracking-tight">
            Olá, {userName.split(' ')[0]}
            {loading && <Loader2 className="animate-spin text-primary-400" size={18} />}
          </h1>
          <p className="text-sm text-text-secondary mt-1">Acompanhe seus números e atividades do período.</p>
        </div>
        <div className="z-50 relative lg:hidden">
          <NotificationBell />
        </div>
      </div>

      {/* Announcements */}
      {activeAnnouncements.length > 0 && (
        <section className="space-y-3">
          {activeAnnouncements.map(a => <AnnouncementCard key={a.id} announcement={a} />)}
        </section>
      )}

      <section className="space-y-3">
        {/* ── Mobile period selector (below md) ──────────────────────────── */}
        <div className="flex gap-2 items-center md:hidden">
          {(['este_mes', '30_dias'] as const).map(id => (
            <button
              key={id}
              onClick={() => { setPeriod(id); setMobilePeriodOpen(false); }}
              className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-all ${
                period === id
                  ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                  : 'bg-card-bg text-text-secondary border-surface-200 hover:border-primary-400'
              }`}
            >
              {id === 'este_mes' ? 'Este mês' : '30 dias'}
            </button>
          ))}
          <div className="relative">
            <button
              onClick={() => setMobilePeriodOpen(o => !o)}
              className={`flex items-center gap-1 px-4 py-2 rounded-lg text-xs font-semibold border transition-all ${
                ['60_dias', '90_dias', 'custom'].includes(period)
                  ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                  : 'bg-card-bg text-text-secondary border-surface-200 hover:border-primary-400'
              }`}
            >
              {period === '60_dias'
                ? '60 dias'
                : period === '90_dias'
                ? '90 dias'
                : period === 'custom'
                ? 'Personalizado'
                : 'Mais'}
              <ChevronDown size={11} className={`transition-transform ${mobilePeriodOpen ? 'rotate-180' : ''}`} />
            </button>
            {mobilePeriodOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMobilePeriodOpen(false)} />
                <div className="absolute left-0 top-full mt-1.5 z-50 bg-card-bg border border-surface-200 rounded-2xl shadow-lg py-1.5 min-w-[160px]">
                  {[
                    { id: '60_dias' as const, label: '60 dias' },
                    { id: '90_dias' as const, label: '90 dias' },
                    { id: 'custom'  as const, label: 'Personalizado' },
                  ].map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => { setPeriod(opt.id); setMobilePeriodOpen(false); }}
                      className={`w-full text-left px-4 py-2 text-xs font-medium transition-colors hover:bg-surface-50 ${
                        period === opt.id ? 'text-gold-600 font-bold' : 'text-text-primary'
                      }`}
                    >
                      {opt.label}
                      {period === opt.id && <span className="ml-1 text-gold-500">✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Desktop period selector (md and above) ─────────────────────── */}
        <div className="hidden md:flex flex-wrap gap-2">
          {[
            { id: 'este_mes' as const, label: 'Este mês' },
            { id: '30_dias'  as const, label: '30 dias' },
            { id: '60_dias'  as const, label: '60 dias' },
            { id: '90_dias'  as const, label: '90 dias' },
            { id: 'custom'   as const, label: 'Personalizado' },
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setPeriod(opt.id)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-all ${
                period === opt.id
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-card-bg text-text-secondary border-surface-200 hover:border-primary-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Custom date inputs (both breakpoints) */}
        {period === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="w-full p-2.5 bg-surface-50 rounded-xl border border-surface-200 focus:ring-2 focus:ring-gold-300 text-sm text-text-primary"
            />
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="w-full p-2.5 bg-surface-50 rounded-xl border border-surface-200 focus:ring-2 focus:ring-gold-300 text-sm text-text-primary"
            />
          </div>
        )}
      </section>

      {/* ── ADMIN ONLY: Global Metrics ─────────────────────────────────────── */}
      {isAdmin && (
        <>
          <div data-reveal className="grid grid-cols-2 gap-4">
            <PremiumCard highlight interactive className="col-span-2 flex justify-between items-center"
              onClick={() => navigate('/reports')}>
              <div>
                <p className="text-[11px] text-primary-400 font-semibold uppercase tracking-[0.18em]">Vendas Globais Concluídas</p>
                <h3 className="v3-serif text-4xl text-text-primary mt-1.5 tabular-nums"><CountNumber value={totalSales} /></h3>
                <p className="text-xs text-emerald-400 mt-1.5 font-medium">{totalClients} clientes no período ({periodLabel})</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-primary-500/15 flex items-center justify-center text-primary-400 font-bold text-xl">{totalSales}</div>
            </PremiumCard>
            <PremiumCard interactive onClick={() => navigate('/clients', { state: { initialStage: 'Em Análise' } })}>
              <p className="text-[10px] text-text-secondary uppercase tracking-[0.16em]">Em Análise</p>
              <h3 className="v3-serif text-3xl text-text-primary mt-2 tabular-nums"><CountNumber value={emAnalise} pad={2} /></h3>
            </PremiumCard>
            <PremiumCard interactive onClick={() => navigate('/clients', { state: { initialStage: 'Aprovado' } })}>
              <p className="text-[10px] text-text-secondary uppercase tracking-[0.16em]">Aprovados</p>
              <h3 className="v3-serif text-3xl text-emerald-400 mt-2 tabular-nums"><CountNumber value={aprovados} pad={2} /></h3>
            </PremiumCard>
          </div>
          {/* Directorates overview - ADMIN only */}
          {isAdmin && directorates.length > 0 && (
            <section>
              <SectionHeader title="Visão por Diretoria" />
              <DiretoriaCardGrid
                directorates={directorates}
                clients={scopedClients}
                startDate={periodStartYmd}
                endDate={periodEndYmd}
              />
            </section>
          )}
          <section><FunnelChart clientsData={periodClients} /></section>
        </>
      )}

      {/* ── DIRETOR: Diretoria Metrics ─────────────────────────────────────── */}
      {isDirector && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <PremiumCard highlight interactive className="col-span-2 flex justify-between items-center"
              onClick={() => navigate('/reports')}>
              <div>
                <p className="text-sm text-gold-700 dark:text-gold-400 font-medium uppercase tracking-wider">Vendas da Diretoria</p>
                <h3 className="text-3xl font-bold text-text-primary mt-1">{totalSales}</h3>
                <p className="text-xs text-green-600 mt-1 font-medium">{totalClients} clientes no período ({periodLabel})</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-gold-100 dark:bg-gold-900/40 flex items-center justify-center text-gold-600 font-bold text-xl">{totalSales}</div>
            </PremiumCard>
            <PremiumCard interactive onClick={() => navigate('/clients', { state: { initialStage: 'Em Análise' } })}>
              <p className="text-xs text-text-secondary uppercase">Em Análise</p>
              <h3 className="text-2xl font-bold text-text-primary mt-2">{String(emAnalise).padStart(2, '0')}</h3>
            </PremiumCard>
            <PremiumCard interactive onClick={() => navigate('/clients', { state: { initialStage: 'Aprovado' } })}>
              <p className="text-xs text-text-secondary uppercase">Aprovados</p>
              <h3 className="text-2xl font-bold text-green-600 mt-2">{String(aprovados).padStart(2, '0')}</h3>
            </PremiumCard>
          </div>
          <SalesProgressCard />
          <section><FunnelChart clientsData={periodClients} /></section>
        </>
      )}

      {/* ── CORRETOR: Personal Metrics ─────────────────────────────────────── */}
      {isBroker && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <PremiumCard highlight interactive className="col-span-2 flex justify-between items-center"
              onClick={() => navigate('/clients', { state: { initialStage: 'Concluído' } })}>
              <div>
                <p className="text-sm text-gold-700 dark:text-gold-400 font-medium uppercase tracking-wider">Vendas Concluídas</p>
                <h3 className="text-3xl font-bold text-text-primary mt-1">{totalSales}</h3>
                <p className="text-xs text-green-600 dark:text-green-400 mt-1 font-medium">{totalClients} clientes no período ({periodLabel})</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-gold-100 dark:bg-gold-900/40 flex items-center justify-center text-gold-600 font-bold text-xl">{totalSales}</div>
            </PremiumCard>
            <PremiumCard interactive onClick={() => navigate('/clients', { state: { initialStage: 'Em Análise' } })}>
              <p className="text-xs text-text-secondary uppercase">Em Análise</p>
              <h3 className="text-2xl font-bold text-text-primary mt-2">{String(emAnalise).padStart(2, '0')}</h3>
            </PremiumCard>
            <PremiumCard interactive onClick={() => navigate('/clients', { state: { initialStage: 'Aprovado' } })}>
              <p className="text-xs text-text-secondary uppercase">Aprovados</p>
              <h3 className="text-2xl font-bold text-green-600 dark:text-green-400 mt-2">{String(aprovados).padStart(2, '0')}</h3>
            </PremiumCard>
          </div>

          <SalesProgressCard />

          <div className="mt-8 grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 flex flex-col gap-6">
              <GamificationProfile />
              <section><FunnelChart clientsData={periodClients} /></section>
            </div>
            <div className="xl:col-span-1 h-[600px] xl:h-[auto]">
              <LeaderboardPanel />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
            {/* Weekly Appointments */}
            <section>
              <SectionHeader
                title="Agendamentos da Semana"
                subtitle="Todos os seus compromissos"
                action={
                  <button onClick={() => navigate('/schedule', { state: { showAll: true } })} className="text-xs text-gold-600 dark:text-gold-400 font-medium hover:underline">
                    Ver todos
                  </button>
                }
              />
              <div className="space-y-3">
                {upcomingAppointments.length === 0 ? (
                  <PremiumCard className="text-center py-6">
                    <Calendar className="mx-auto mb-2 text-surface-300 dark:text-surface-700" size={32} />
                    <p className="text-text-secondary text-sm">Sua agenda está livre na semana.</p>
                  </PremiumCard>
                ) : (
                  upcomingAppointments.map((app) => (
                    <PremiumCard key={app.id} interactive="list"
                      onClick={() => navigate('/schedule', { state: { date: app.date } })}>
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-4">
                          <div className="flex-col flex items-center justify-center w-12 h-12 bg-surface-100 dark:bg-surface-800 rounded-xl text-center">
                            <span className="text-xs font-bold text-text-primary">{app.time}</span>
                          </div>
                          <div>
                            <p className="font-semibold text-text-primary">{app.title}</p>
                            <p className="text-xs text-text-secondary mt-1">
                              {new Date(app.date).toLocaleDateString('pt-BR')} • {app.type}
                            </p>
                            {app.client_name && <p className="text-xs text-gold-600 font-medium mt-1">{app.client_name}</p>}
                          </div>
                        </div>
                      </div>
                    </PremiumCard>
                  ))
                )}
              </div>
            </section>

            {/* Metas */}
            <section className="space-y-6">
              {(() => {
                const corretorGoals = goals.filter(g => isGoalVisibleToUser(g, {
                  userId: user?.id,
                  directorateId: profile?.directorate_id,
                  teamIds: [profile?.team_id, profile?.team],
                  coordinatorId: profile?.coordinator_id,
                }));

                if (corretorGoals.length === 0) {
                  return (
                    <div>
                      <SectionHeader title="Metas" subtitle="Seus objetivos" />
                      <PremiumCard className="text-center py-6">
                        <Target className="mx-auto mb-2 text-surface-300 dark:text-surface-700" size={32} />
                        <p className="text-text-secondary text-sm">Nenhuma meta ativa atribuída.</p>
                      </PremiumCard>
                    </div>
                  );
                }

                return (
                  <div>
                    <SectionHeader title="Metas" subtitle="Seus objetivos" />
                    <div className="space-y-3">
                      {corretorGoals.slice(0, 5).map((goal) => {
                        const progress = goal.target ? ((goal.current_progress || 0) / goal.target) * 100 : 0;
                        const pct = Math.min(100, Math.round(progress));
                        const progressColor = pct >= 67 ? 'bg-emerald-500' : pct >= 34 ? 'bg-orange-400' : 'bg-blue-500';
                        const tierText = pct >= 100 ? 'Batida' : pct >= 67 ? 'Prata' : pct >= 34 ? 'Bronze' : 'Em andamento';
                        const formatGoalVal = (g: Goal, val: number) =>
                          g.measure_type === 'quantity'
                            ? val.toString()
                            : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

                        return (
                          <PremiumCard key={goal.id}>
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex-1 min-w-0">
                                <span className="font-semibold text-text-primary text-sm flex items-center gap-2">
                                  {goal.title}
                                  {goal.status === 'achieved' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">Atingida</span>}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${pct >= 100 ? 'bg-emerald-500/15 text-emerald-400' : pct >= 60 ? 'bg-blue-500/15 text-blue-400' : 'bg-surface-100 text-text-secondary'}`}>{pct}%</span>
                              </div>
                            </div>
                            <div className="h-2 w-full bg-surface-200 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-700 ${progressColor}`} style={{ width: `${pct}%` }} />
                            </div>
                            <div className="flex justify-between items-end mt-1">
                              <div className="flex flex-col text-[10px] text-text-secondary">
                                <span>{tierText}: {formatGoalVal(goal, goal.current_progress || 0)} de {formatGoalVal(goal, goal.target || 0)}</span>
                              </div>
                              {goal.deadline && <span className="text-[10px] text-text-secondary">Até {new Date(goal.deadline).toLocaleDateString('pt-BR')}</span>}
                            </div>
                          </PremiumCard>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </section>
          </div>
        </>
      )}

      {/* ── GERENTE / COORDENADOR: Team Metrics ───────────────────────────── */}
      {(isManager || isCoordinator) && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <PremiumCard
              interactive
              className="flex flex-col items-center gap-1"
              onClick={() => navigate('/clients')}
            >
              <Users size={22} className="text-gold-500" />
              <h3 className="text-2xl font-bold text-text-primary">{totalClients}</h3>
              <p className="text-xs text-text-secondary">Clientes no período</p>
            </PremiumCard>
            <PremiumCard
              interactive
              className="flex flex-col items-center gap-1"
              onClick={() => navigate('/clients', { state: { initialStage: 'Concluído' } })}
            >
              <TrendingUp size={22} className="text-green-500" />
              <h3 className="text-2xl font-bold text-text-primary">{totalSales}</h3>
              <p className="text-xs text-text-secondary">Vendas no período</p>
            </PremiumCard>
            <PremiumCard
              interactive
              className="flex flex-col items-center gap-1"
              onClick={() => navigate('/clients', { state: { initialStage: 'Em Análise' } })}
            >
              <Target size={22} className="text-blue-500" />
              <h3 className="text-2xl font-bold text-text-primary">{emAnalise}</h3>
              <p className="text-xs text-text-secondary">Em Análise no período</p>
            </PremiumCard>
            <PremiumCard
              interactive
              className="flex flex-col items-center gap-1"
              onClick={() => navigate('/schedule')}
            >
              <Calendar size={22} className="text-purple-500" />
              <h3 className="text-2xl font-bold text-text-primary">{upcomingAppointmentsTotal}</h3>
              <p className="text-xs text-text-secondary">Agendamentos</p>
            </PremiumCard>
          </div>
          <SalesProgressCard />

          <section><FunnelChart clientsData={periodClients} /></section>

          {/* Metas da equipe */}
          {(() => {
            const myTeamIds = [
              profile?.team_id,
              profile?.team,
              ...teams
                .filter(t => t.manager_id === user?.id || (t.members || []).includes(user?.id || ''))
                .map(t => t.id),
            ];
            const teamGoals = goals.filter(g => isGoalVisibleToUser(g, {
              userId: user?.id,
              directorateId: profile?.directorate_id,
              teamIds: myTeamIds,
              coordinatorId: profile?.coordinator_id,
            }));
            const formatGoalVal = (g: Goal, val: number) =>
              g.measure_type === 'quantity'
                ? val.toString()
                : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

            if (teamGoals.length === 0) {
              return (
                <section>
                  <SectionHeader title="Metas da Equipe" />
                  <PremiumCard className="text-center py-6">
                    <Target className="mx-auto mb-2 text-surface-300" size={28} />
                    <p className="text-text-secondary text-sm">Nenhuma meta ativa no momento.</p>
                  </PremiumCard>
                </section>
              );
            }

            return (
              <section className="space-y-6">
                <div>
                  <SectionHeader title="Metas da Equipe" subtitle="Acompanhe o progresso das metas" />
                  <div className="space-y-3">
                    {teamGoals.slice(0, 5).map((goal) => {
                      const progress = goal.target ? ((goal.current_progress || 0) / goal.target) * 100 : 0;
                      const pct = Math.min(100, Math.round(progress));
                      const progressColor = pct >= 67 ? 'bg-emerald-500' : pct >= 34 ? 'bg-orange-400' : 'bg-blue-500';
                      const tierText = pct >= 100 ? 'Batida' : pct >= 67 ? 'Prata' : pct >= 34 ? 'Bronze' : 'Em andamento';

                      return (
                        <PremiumCard key={goal.id}>
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex-1 min-w-0">
                              <span className="font-semibold text-text-primary text-sm flex items-center gap-2">
                                {goal.title}
                                {goal.status === 'achieved' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">Atingida</span>}
                              </span>
                              {goal.description && <p className="text-[11px] text-text-secondary mt-0.5 line-clamp-1">{goal.description}</p>}
                            </div>
                            <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${pct >= 100 ? 'bg-emerald-500/15 text-emerald-400' : pct >= 60 ? 'bg-blue-500/15 text-blue-400' : 'bg-surface-100 text-text-secondary'}`}>{pct}%</span>
                            </div>
                          </div>
                          <div className="h-2 w-full bg-surface-200 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-700 ${progressColor}`} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="flex justify-between items-end mt-1">
                            <div className="flex flex-col text-[10px] text-text-secondary">
                              <span>{tierText}: {formatGoalVal(goal, goal.current_progress || 0)} de {formatGoalVal(goal, goal.target || 0)}</span>
                            </div>
                            {goal.deadline && <span className="text-[10px] text-text-secondary">Até {new Date(goal.deadline).toLocaleDateString('pt-BR')}</span>}
                          </div>
                        </PremiumCard>
                      );
                    })}
                  </div>
                </div>
              </section>
            );
          })()}
        </>
      )}



      {/* Upcoming Schedule — visible to non-broker roles */}
      {!isBroker && upcomingAppointments.length > 0 && (
        <section>
          <SectionHeader
            title="Próximos Agendamentos"
            action={
              <button onClick={() => navigate('/schedule', { state: { showAll: true } })} className="text-xs text-gold-600 dark:text-gold-400 font-medium hover:underline">
                Ver todos
              </button>
            }
          />
          <div className="space-y-3">
            {upcomingAppointments.map(item => (
              <PremiumCard key={item.id} interactive="list" className="p-4 flex items-center gap-4" onClick={() => navigate('/schedule', { state: { date: item.date } })}>
                <div className="flex-col flex items-center justify-center w-12 h-12 bg-surface-100 rounded-xl text-center">
                  <span className="text-xs font-bold text-text-secondary">{item.time}</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-text-primary">{item.title}</h4>
                  <p className="text-xs text-text-secondary">{item.type} {item.client_name ? `• ${item.client_name}` : ''}</p>
                </div>
                <div className="w-1 h-8 rounded-full bg-gold-400" />
              </PremiumCard>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
