import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Calendar, CheckCircle2, DollarSign, Loader2, Search, Undo2 } from 'lucide-react';
import { PremiumCard, RoundedButton, StatusBadge } from '@/components/ui/PremiumComponents';
import { MetricCard } from '@/components/reports/MetricCard';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import {
  deriveCommissionDisplayStatus,
  formatBRL,
  isSoldInYearMonth,
  soldAtYearMonth,
  type CommissionDisplayStatus,
  type CommissionPaymentStatus,
} from '@/lib/sales/commission';

interface CommissionEntry {
  id: string;
  client_id: string;
  owner_id: string | null;
  directorate_id: string | null;
  cliente_nome: string | null;
  empreendimento: string | null;
  unidade: string | null;
  corretor_nome: string | null;
  coordenador_nome: string | null;
  gerente_nome: string | null;
  vgv_numeric: number | string;
  commission_amount: number | string;
  payment_status: CommissionPaymentStatus;
  due_date: string | null;
  paid_at: string | null;
  paid_by: string | null;
  sold_at: string | null;
}

type StatusFilter = 'all' | CommissionDisplayStatus;

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return value;
  return Number(value) || 0;
}

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function latestSoldPeriod(entries: CommissionEntry[]): { year: number; month: number } | null {
  let best: { year: number; month: number; t: number } | null = null;
  for (const entry of entries) {
    const parts = soldAtYearMonth(entry.sold_at);
    if (!parts) continue;
    const t = entry.sold_at ? new Date(entry.sold_at).getTime() : 0;
    if (!best || t > best.t) best = { year: parts.year, month: parts.month, t: Number.isNaN(t) ? 0 : t };
  }
  return best ? { year: best.year, month: best.month } : null;
}

function formatSoldDate(soldAt: string | null) {
  if (!soldAt) return '—';
  const date = new Date(soldAt);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR');
}

export function CommissionManagement() {
  const { user, allProfiles } = useApp();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [entries, setEntries] = useState<CommissionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const userPickedMonth = useRef(false);
  const didAutoJump = useRef(false);

  const loadEntries = async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from('commission_entries')
      .select('*')
      .order('sold_at', { ascending: false });
    if (error) {
      console.error('Erro ao carregar comissões:', error);
      setEntries([]);
      setLoadError(error.message || 'Não foi possível carregar as comissões.');
    } else {
      setEntries((data || []) as CommissionEntry[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadEntries();
  }, []);

  useEffect(() => {
    if (loading || didAutoJump.current || userPickedMonth.current) return;
    const inMonth = entries.some(entry => isSoldInYearMonth(entry.sold_at, year, month));
    if (inMonth || entries.length === 0) return;
    const latest = latestSoldPeriod(entries);
    if (!latest) return;
    didAutoJump.current = true;
    setYear(latest.year);
    setMonth(latest.month);
  }, [loading, entries, year, month]);

  const periodEntries = useMemo(
    () => entries.filter(entry => isSoldInYearMonth(entry.sold_at, year, month)),
    [entries, year, month],
  );

  const filteredCards = useMemo(() => {
    const term = search.trim().toLowerCase();
    return periodEntries.filter(entry => {
      const display = deriveCommissionDisplayStatus(entry.payment_status, entry.due_date);
      if (statusFilter !== 'all' && display !== statusFilter) return false;
      if (!term) return true;
      const haystack = [
        entry.cliente_nome,
        entry.corretor_nome,
        entry.empreendimento,
        entry.unidade,
        entry.gerente_nome,
        entry.coordenador_nome,
      ].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [periodEntries, search, statusFilter]);

  const kpis = useMemo(() => {
    let paid = 0;
    let pending = 0;
    let overdue = 0;
    for (const entry of periodEntries) {
      const amount = toNumber(entry.commission_amount);
      const display = deriveCommissionDisplayStatus(entry.payment_status, entry.due_date);
      if (display === 'Pago') paid += amount;
      else if (display === 'Atrasado') overdue += amount;
      else pending += amount;
    }
    return { paid, pending, overdue, count: periodEntries.length };
  }, [periodEntries]);

  const evolutionData = useMemo(() => {
    const points: { label: string; pago: number; key: string }[] = [];
    for (let i = 11; i >= 0; i -= 1) {
      const cursor = new Date(year, month - 1 - i, 1);
      const y = cursor.getFullYear();
      const m = cursor.getMonth() + 1;
      const pago = entries
        .filter(entry => entry.payment_status === 'paid' && isSoldInYearMonth(entry.sold_at, y, m))
        .reduce((sum, entry) => sum + toNumber(entry.commission_amount), 0);
      points.push({
        key: `${y}-${m}`,
        label: cursor.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
        pago,
      });
    }
    return points;
  }, [entries, year, month]);

  const byUserData = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of periodEntries) {
      if (entry.payment_status !== 'paid') continue;
      const name = entry.corretor_nome
        || allProfiles.find(p => p.id === entry.owner_id)?.name
        || 'Sem corretor';
      map.set(name, (map.get(name) || 0) + toNumber(entry.commission_amount));
    }
    return Array.from(map.entries())
      .map(([name, pago]) => ({ name, pago }))
      .sort((a, b) => b.pago - a.pago)
      .slice(0, 8);
  }, [periodEntries, allProfiles]);

  const updateEntry = async (id: string, patch: Partial<CommissionEntry>) => {
    setSavingId(id);
    const { error } = await supabase.from('commission_entries').update(patch).eq('id', id);
    if (error) {
      alert(`Erro ao atualizar: ${error.message}`);
    } else {
      setEntries(prev => prev.map(entry => entry.id === id ? { ...entry, ...patch } : entry));
    }
    setSavingId(null);
  };

  const markPaid = (entry: CommissionEntry) => {
    updateEntry(entry.id, {
      payment_status: 'paid',
      paid_at: new Date().toISOString(),
      paid_by: user?.id ?? null,
    } as Partial<CommissionEntry>);
  };

  const undoPaid = (entry: CommissionEntry) => {
    updateEntry(entry.id, {
      payment_status: 'pending',
      paid_at: null,
      paid_by: null,
    } as Partial<CommissionEntry>);
  };

  const otherMonthsCount = useMemo(
    () => entries.filter(entry => !isSoldInYearMonth(entry.sold_at, year, month)).length,
    [entries, year, month],
  );
  const periodText = monthLabel(year, month);
  const chips: { id: StatusFilter; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'Pendente', label: 'Pendente' },
    { id: 'Pago', label: 'Pago' },
    { id: 'Atrasado', label: 'Atrasado' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-2 overflow-x-auto">
          {chips.map(chip => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setStatusFilter(chip.id)}
              className={`shrink-0 h-9 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all ${
                statusFilter === chip.id
                  ? 'bg-gold-500 text-white shadow-md shadow-gold-500/20'
                  : 'bg-card-bg text-text-secondary border border-surface-200'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar cliente, corretor, empreendimento..."
              className="w-full h-9 pl-9 pr-3 py-1.5 text-xs bg-card-bg border border-surface-200 rounded-xl focus:outline-none focus:border-gold-400"
            />
          </div>
          <label className="flex items-center gap-2 h-9 px-3 py-1.5 bg-card-bg border border-surface-200 rounded-xl text-xs text-text-secondary">
            <Calendar size={14} />
            <input
              type="month"
              value={`${year}-${String(month).padStart(2, '0')}`}
              onChange={e => {
                const [nextYear, nextMonth] = e.target.value.split('-').map(Number);
                userPickedMonth.current = true;
                if (nextYear) setYear(nextYear);
                if (nextMonth) setMonth(nextMonth);
              }}
              className="bg-transparent text-text-primary focus:outline-none"
            />
          </label>
        </div>
      </div>

      {loadError && (
        <PremiumCard className="p-4 border border-red-200 bg-red-50 dark:bg-red-900/20">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300">Não foi possível carregar as comissões.</p>
          <p className="text-xs text-red-600 dark:text-red-400 mt-1">{loadError}</p>
        </PremiumCard>
      )}

      {otherMonthsCount > 0 && (
        <p className="text-xs text-text-secondary">
          Existem {otherMonthsCount} {otherMonthsCount === 1 ? 'venda' : 'vendas'} em outros meses.
          {periodEntries.length === 0 && (
            <button
              type="button"
              className="ml-1 font-semibold text-gold-600 hover:underline"
              onClick={() => {
                const latest = latestSoldPeriod(entries);
                if (!latest) return;
                userPickedMonth.current = true;
                setYear(latest.year);
                setMonth(latest.month);
              }}
            >
              Ver o mês mais recente
            </button>
          )}
        </p>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <MetricCard label="Pago no período" value={formatBRL(kpis.paid)} change="—" trend="neutral" period={periodText} />
        <MetricCard label="Pendente" value={formatBRL(kpis.pending)} change="—" trend="neutral" period={periodText} />
        <MetricCard label="Atrasado" value={formatBRL(kpis.overdue)} change="—" trend="neutral" period={periodText} inverse />
        <MetricCard label="Vendas" value={String(kpis.count)} change="—" trend="neutral" period={periodText} />
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <PremiumCard className="p-4">
          <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">Comissão paga · 12 meses</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={evolutionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-200, #e5e7eb)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip formatter={(value: number) => formatBRL(Number(value) || 0)} />
                <Line type="monotone" dataKey="pago" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </PremiumCard>
        <PremiumCard className="p-4">
          <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">Pago por corretor · período</p>
          <div className="h-52">
            {byUserData.length === 0 ? (
              <p className="text-sm text-text-secondary h-full flex items-center justify-center">Nenhum pagamento neste período.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byUserData} layout="vertical" margin={{ left: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-200, #e5e7eb)" />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => formatBRL(Number(value) || 0)} />
                  <Bar dataKey="pago" fill="#2563eb" radius={[0, 8, 8, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </PremiumCard>
      </div>

      {loading ? (
        <Loader2 size={24} className="animate-spin mx-auto text-gold-400 py-8" />
      ) : filteredCards.length === 0 ? (
        <PremiumCard className="p-8 text-center">
          <DollarSign className="mx-auto mb-2 text-text-secondary" size={28} />
          <p className="text-sm font-semibold text-text-primary">Nenhuma venda com espelho neste período.</p>
          <p className="text-xs text-text-secondary mt-1">
            {entries.length > 0
              ? 'Há vendas em outros meses — use o seletor de mês ou o atalho acima.'
              : 'O card é criado quando a liderança salva o Espelho de Vendas de um cliente Concluído.'}
          </p>
        </PremiumCard>
      ) : (
        <div className="grid gap-3">
          {filteredCards.map(entry => {
            const display = deriveCommissionDisplayStatus(entry.payment_status, entry.due_date);
            const busy = savingId === entry.id;
            return (
              <PremiumCard key={entry.id} className="p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h4 className="font-semibold text-text-primary truncate">{entry.cliente_nome || 'Cliente'}</h4>
                      <StatusBadge status={display} />
                    </div>
                    <p className="text-xs text-text-secondary truncate">{entry.empreendimento || 'Empreendimento não informado'}{entry.unidade ? ` · Unidade ${entry.unidade}` : ''}</p>
                    <p className="text-xs text-text-secondary mt-1">
                      Corretor: {entry.corretor_nome || '—'}
                      {entry.coordenador_nome ? ` · Coord. ${entry.coordenador_nome}` : ''}
                      {entry.gerente_nome ? ` · Ger. ${entry.gerente_nome}` : ''}
                    </p>
                  </div>
                  <div className="text-left md:text-right shrink-0">
                    <p className="text-[10px] uppercase tracking-wider text-text-secondary font-semibold">Comissão</p>
                    <p className="text-lg font-bold text-text-primary">{formatBRL(toNumber(entry.commission_amount))}</p>
                    <p className="text-xs text-text-secondary">VGV {formatBRL(toNumber(entry.vgv_numeric))}</p>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-surface-200 flex flex-col sm:flex-row sm:items-center gap-3">
                  <p className="text-[11px] text-text-secondary">Venda em {formatSoldDate(entry.sold_at)}</p>
                  <label className="flex items-center gap-2 text-[11px] text-text-secondary sm:ml-auto">
                    Vencimento
                    <input
                      type="date"
                      value={entry.due_date || ''}
                      disabled={busy}
                      onChange={e => updateEntry(entry.id, { due_date: e.target.value || null })}
                      className="px-2 py-1 rounded-lg border border-surface-200 bg-surface-50 text-text-primary text-xs"
                    />
                  </label>
                  {entry.payment_status === 'paid' ? (
                    <RoundedButton size="sm" variant="outline" disabled={busy} onClick={() => undoPaid(entry)}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
                      Desfazer pagamento
                    </RoundedButton>
                  ) : (
                    <RoundedButton size="sm" disabled={busy} onClick={() => markPaid(entry)} className="bg-green-600 hover:bg-green-700 text-white border-0">
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                      Marcar como pago
                    </RoundedButton>
                  )}
                </div>
              </PremiumCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
