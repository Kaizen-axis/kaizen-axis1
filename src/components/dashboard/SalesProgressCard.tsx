import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useAuthorization } from '@/hooks/useAuthorization';
import { getDashboardSaleDate, isSaleInCurrentMonth } from '@/lib/sales/salePeriod';
import { supabase } from '@/lib/supabase';
import { AlertTriangle, TrendingUp, DollarSign, Users, User, Pencil, Check } from 'lucide-react';

const COMMISSION_CONFIG: Record<string, { ownRate: number; teamRate: number }> = {
  CORRETOR:    { ownRate: 0.018, teamRate: 0     },
  COORDENADOR: { ownRate: 0.020, teamRate: 0.001 },
  GERENTE:     { ownRate: 0.024, teamRate: 0.004 },
  DIRETOR:     { ownRate: 0.024, teamRate: 0.001 },
};

const TAX_DEDUCTION = 0.86;
const SLOGAN = 'Melhoria contínua, conquistas duradouras.';

function parseCurrency(value: any): number {
  if (value == null) return 0;
  if (typeof value === 'number') return isNaN(value) ? 0 : value;
  const cleaned = String(value)
    .replace(/R\$\s*/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return parseFloat(cleaned) || 0;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatCurrencyInput(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 12);
  if (!digits) return '';
  return (Number(digits) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function SalesProgressCard() {
  const { clients, user, allProfiles } = useApp();
  const { role, directorateId } = useAuthorization();

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [goalAmount, setGoalAmount] = useState<number | null>(null);
  const [goalInput, setGoalInput] = useState('');
  const [editingGoal, setEditingGoal] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);

  const config = COMMISSION_CONFIG[role?.toUpperCase() ?? ''] ?? COMMISSION_CONFIG.CORRETOR;
  const hasTeamCommission = config.teamRate > 0;

  const monthlySales = clients
    .filter(c => {
      if (role === 'DIRETOR' && directorateId && (c as any).directorate_id !== directorateId) return false;
      return isSaleInCurrentMonth(c);
    })
    .slice(0, 100);

  const ownSales  = monthlySales.filter(c => (c as any).owner_id === user?.id);
  const teamSales = monthlySales.filter(c => (c as any).owner_id !== user?.id);

  const ownVGV  = ownSales.reduce((sum, c)  => sum + parseCurrency(c.intendedValue), 0);
  const teamVGV = teamSales.reduce((sum, c) => sum + parseCurrency(c.intendedValue), 0);
  const totalVGV = ownVGV + teamVGV;

  const ownCommission   = ownVGV  * config.ownRate  * TAX_DEDUCTION;
  const teamCommission  = teamVGV * config.teamRate * TAX_DEDUCTION;
  const totalCommission = ownCommission + teamCommission;

  const hasSales = monthlySales.length > 0;
  const hasGoal = goalAmount != null && goalAmount > 0;
  const goalMet = hasGoal && totalCommission >= goalAmount;
  const monthName = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const progressPct = hasGoal ? Math.min(100, Math.round((totalCommission / goalAmount) * 100)) : 0;

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('monthly_commission_goals')
        .select('amount')
        .eq('user_id', user.id)
        .eq('year', year)
        .eq('month', month)
        .maybeSingle();
      if (cancelled || error) return;
      if (data?.amount != null) {
        const amount = Number(data.amount);
        setGoalAmount(amount);
        setGoalInput(formatCurrencyInput(String(Math.round(amount * 100))));
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, year, month]);

  const saveGoal = async () => {
    if (!user?.id) return;
    const amount = parseCurrency(goalInput);
    if (amount <= 0) {
      alert('Informe um valor de meta maior que zero.');
      return;
    }
    setSavingGoal(true);
    try {
      const { error } = await supabase.from('monthly_commission_goals').upsert(
        { user_id: user.id, year, month, amount, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,year,month' },
      );
      if (error) throw error;
      setGoalAmount(amount);
      setEditingGoal(false);
    } catch (e: any) {
      alert(e?.message || 'Erro ao salvar a meta.');
    } finally {
      setSavingGoal(false);
    }
  };

  const tone = !hasGoal
    ? 'bg-card-bg border-surface-200'
    : goalMet
      ? 'bg-green-950/45 border-green-500/70'
      : 'bg-red-950/45 border-red-500/70';

  return (
    <div className={`rounded-2xl border p-4 sm:p-5 shadow-sm transition-all duration-300 ${tone}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="font-bold text-text-primary text-base">Progresso do Mês</h3>
          <p className="text-xs text-text-secondary capitalize">{monthName}</p>
        </div>
        <div className={`p-2 rounded-xl flex-shrink-0 ${
          !hasGoal ? 'bg-surface-100' : goalMet ? 'bg-green-500/20' : 'bg-red-500/20'
        }`}>
          {!hasGoal
            ? <TrendingUp size={20} className="text-text-secondary" />
            : goalMet
              ? <TrendingUp size={20} className="text-green-500" />
              : <AlertTriangle size={20} className="text-red-500" />
          }
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch mb-3 rounded-xl overflow-hidden border border-black/5 dark:border-black/20 bg-black/5 dark:bg-black/20">
        <div className="flex-1 flex flex-col items-center justify-center py-3 px-2 gap-0.5">
          <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Vendas</p>
          <p className="text-xl font-bold text-text-primary">{monthlySales.length}</p>
        </div>
        <div className="h-px sm:h-auto sm:w-px bg-black/10 dark:bg-black/30" />
        <div className="flex-1 flex flex-col items-center justify-center py-3 px-2 gap-0.5">
          <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">VGV Total</p>
          <p className="text-sm font-bold text-text-primary">{formatBRL(totalVGV)}</p>
        </div>
        <div className="h-px sm:h-auto sm:w-px bg-black/10 dark:bg-black/30" />
        <div className="flex-1 flex flex-col items-center justify-center py-3 px-2 gap-0.5">
          <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Comissão Prevista</p>
          <p className="text-sm font-bold text-green-500">{formatBRL(totalCommission)}</p>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-surface-200/80 bg-black/10 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Meta de comissão</p>
          {hasGoal && !editingGoal && (
            <button
              type="button"
              onClick={() => setEditingGoal(true)}
              className="text-xs text-primary-400 font-medium flex items-center gap-1 min-h-11 px-2"
            >
              <Pencil size={12} /> Editar
            </button>
          )}
        </div>

        {editingGoal || !hasGoal ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={goalInput}
              onChange={(e) => setGoalInput(formatCurrencyInput(e.target.value))}
              placeholder="0,00"
              inputMode="numeric"
              className="flex-1 min-h-11 px-3 rounded-xl bg-surface-50 border border-surface-200 text-text-primary text-sm"
            />
            <button
              type="button"
              onClick={() => void saveGoal()}
              disabled={savingGoal || !goalInput}
              className="min-h-11 px-4 rounded-xl bg-primary-600 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <Check size={14} /> {savingGoal ? 'Salvando…' : 'Salvar meta'}
            </button>
          </div>
        ) : (
          <p className="text-sm font-bold text-text-primary">{formatBRL(goalAmount)}</p>
        )}

        {hasGoal && (
          <>
            <div className="h-2 rounded-full bg-black/30 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${goalMet ? 'bg-green-500' : 'bg-red-500'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-[11px] text-text-secondary">
              {formatBRL(totalCommission)} de {formatBRL(goalAmount)} ({progressPct}%)
            </p>
          </>
        )}

        {goalMet && (
          <p className="text-sm font-semibold text-green-400 text-center pt-1">
            {SLOGAN}
          </p>
        )}
      </div>

      {hasTeamCommission && hasSales && (ownSales.length > 0 || teamSales.length > 0) && (
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          {ownSales.length > 0 && (
            <div className="flex-1 flex items-center gap-2 bg-card-bg/80 rounded-xl px-3 py-2 border border-green-500/30">
              <div className="w-6 h-6 rounded-full bg-primary-500/15 flex items-center justify-center flex-shrink-0">
                <User size={11} className="text-primary-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-text-secondary font-medium">Própria ({ownSales.length})</p>
                <p className="text-xs font-bold text-green-500 truncate">{formatBRL(ownCommission)}</p>
              </div>
            </div>
          )}
          {teamSales.length > 0 && (
            <div className="flex-1 flex items-center gap-2 bg-card-bg/80 rounded-xl px-3 py-2 border border-blue-500/30">
              <div className="w-6 h-6 rounded-full bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                <Users size={11} className="text-blue-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-text-secondary font-medium">Equipe ({teamSales.length})</p>
                <p className="text-xs font-bold text-blue-400 truncate">{formatBRL(teamCommission)}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {!hasSales ? (
        <div className="flex flex-col items-center justify-center py-4 gap-2">
          <AlertTriangle size={28} className={hasGoal && !goalMet ? 'text-red-500' : 'text-red-500'} />
          <p className="text-sm font-semibold text-red-500 text-center">
            Nenhuma venda realizada neste mês
          </p>
          <p className="text-xs text-text-secondary text-center">Bora fechar negócio!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {monthlySales.map(c => {
            const isOwn = (c as any).owner_id === user?.id;
            const ownerProfile = !isOwn
              ? allProfiles.find(p => p.id === (c as any).owner_id)
              : null;
            const vgv = parseCurrency(c.intendedValue);
            const comissao = isOwn
              ? vgv * config.ownRate  * TAX_DEDUCTION
              : vgv * config.teamRate * TAX_DEDUCTION;

            const rawDate = getDashboardSaleDate(c);
            let dateDisplay = '—';
            try {
              if (rawDate) {
                const d = new Date(rawDate);
                if (!isNaN(d.getTime())) dateDisplay = d.toLocaleDateString('pt-BR');
              }
            } catch { /* keep '—' */ }

            return (
              <div
                key={c.id}
                className={`bg-card-bg/90 rounded-xl px-3 py-2.5 shadow-xs border ${
                  isOwn ? 'border-green-500/30' : 'border-blue-500/30'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-semibold text-text-primary text-sm truncate">{c.name}</p>
                      {hasTeamCommission && (
                        <span className={`flex-shrink-0 text-[9px] font-bold px-1.5 py-px rounded-full ${
                          isOwn
                            ? 'bg-primary-500/15 text-primary-300'
                            : 'bg-blue-500/15 text-blue-300'
                        }`}>
                          {isOwn ? 'Própria' : ownerProfile?.name ?? 'Equipe'}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-text-secondary truncate">{c.development || '—'}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-medium text-text-primary">{formatBRL(vgv)}</p>
                    <p className={`text-[11px] font-semibold ${isOwn ? 'text-green-500' : 'text-blue-400'}`}>
                      {formatBRL(comissao)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <DollarSign size={10} className="text-text-secondary" />
                  <p className="text-[10px] text-text-secondary">{dateDisplay}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
