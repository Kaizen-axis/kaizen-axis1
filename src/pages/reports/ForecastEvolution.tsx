import { useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, CartesianGrid, ComposedChart, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { PremiumCard, SectionHeader } from '@/components/ui/PremiumComponents';
import { STAGE_WEIGHTS } from '@/types/reports';
import { parseReportValue, ReportClientLike } from '@/lib/reports/computeHybridMetrics';
import { buildEvolutionSeries, EvolutionGranularity } from '@/lib/reports/evolutionSeries';

const GRANULARITIES: Array<{ id: EvolutionGranularity; label: string }> = [
  { id: 'mensal', label: 'Mensal' },
  { id: 'trimestral', label: 'Trimestral' },
  { id: 'semestral', label: 'Semestral' },
  { id: 'anual', label: 'Anual' },
];

const tooltipStyle = {
  borderRadius: '8px',
  border: '1px solid #2b3547',
  backgroundColor: '#0d111a',
  color: '#f4f6fb',
  boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
};

export function ForecastEvolution({ clients }: { clients: ReportClientLike[] }) {
  const [granularity, setGranularity] = useState<EvolutionGranularity>('mensal');

  const { weightedPipeline, forecastTotal } = useMemo(() => {
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    let totalWeightedBRL = 0;
    const pipeline = months.map((m, i) => {
      const mc = clients.filter((c) => new Date(c.createdAt).getMonth() === i);
      const weighted = mc.reduce((acc, c) => acc + parseReportValue(c.intendedValue ?? '') * (STAGE_WEIGHTS[c.stage] ?? 0), 0);
      const confirmed = clients
        .filter((c) => {
          if (c.stage !== 'Concluído' || !c.closed_at) return false;
          return new Date(c.closed_at).getMonth() === i;
        })
        .reduce((acc, c) => acc + parseReportValue(c.intendedValue ?? ''), 0);
      totalWeightedBRL += weighted;
      return { month: m, weighted: weighted / 1000, confirmed: confirmed / 1000 };
    });
    return { weightedPipeline: pipeline, forecastTotal: totalWeightedBRL };
  }, [clients]);

  const evolution = useMemo(
    () => buildEvolutionSeries(clients, granularity).map((p) => ({ ...p, vgvK: p.vgv / 1000 })),
    [clients, granularity],
  );

  return (
    <section className="mb-8">
      <SectionHeader title="Forecast & Evolução" subtitle="Pipeline ponderado e histórico de vendas" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PremiumCard className="p-4 h-64">
          <div className="flex justify-between items-center mb-2">
            <div>
              <p className="text-[10px] text-text-secondary uppercase">Receita Ponderada (Pipeline)</p>
              <h3 className="font-ui text-lg font-bold text-text-primary">R$ {(forecastTotal / 1000000).toFixed(2)}M</h3>
            </div>
          </div>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weightedPipeline}>
                <defs>
                  <linearGradient id="colorWeightedFE" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e2636" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#8b94a3' }} dy={8} />
                <YAxis hide />
                <Tooltip
                  contentStyle={tooltipStyle}
                  itemStyle={{ color: '#f4f6fb' }}
                  labelStyle={{ color: '#8b94a3' }}
                  formatter={(val: number, name: string) => [`R$ ${val.toFixed(0)}k`, name === 'weighted' ? 'Pipeline Ponderado' : 'Confirmado']}
                />
                <Area type="monotone" dataKey="weighted" stroke="#2563eb" strokeWidth={2.5} fillOpacity={1} fill="url(#colorWeightedFE)" />
                <Area type="monotone" dataKey="confirmed" stroke="#22c55e" strokeWidth={2} strokeDasharray="5 5" fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-1">
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-primary-500" /><span className="text-[10px] text-text-secondary">Ponderado</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-green-500" /><span className="text-[10px] text-text-secondary">Confirmado</span></div>
          </div>
        </PremiumCard>

        <PremiumCard className="p-4 h-64">
          <div className="flex justify-between items-center mb-2 gap-2">
            <div>
              <p className="text-[10px] text-text-secondary uppercase">Evolução de Vendas</p>
              <h3 className="font-ui text-lg font-bold text-text-primary">
                {evolution.reduce((acc, p) => acc + p.vendas, 0)} vendas
              </h3>
            </div>
            <div className="flex gap-1">
              {GRANULARITIES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGranularity(g.id)}
                  className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-all ${
                    granularity === g.id
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'bg-surface-100 text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={evolution}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e2636" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#8b94a3' }} dy={8} />
                <YAxis yAxisId="left" hide allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" hide />
                <Tooltip
                  contentStyle={tooltipStyle}
                  itemStyle={{ color: '#f4f6fb' }}
                  labelStyle={{ color: '#8b94a3' }}
                  formatter={(val: number, name: string) =>
                    name === 'Vendas' ? [val, 'Vendas'] : [`R$ ${val.toFixed(0)}k`, 'VGV Confirmado']
                  }
                />
                <Bar yAxisId="left" dataKey="vendas" name="Vendas" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Line yAxisId="right" type="monotone" dataKey="vgvK" name="VGV" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-1">
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-primary-500" /><span className="text-[10px] text-text-secondary">Vendas</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-green-500" /><span className="text-[10px] text-text-secondary">VGV Confirmado</span></div>
          </div>
        </PremiumCard>
      </div>
    </section>
  );
}
