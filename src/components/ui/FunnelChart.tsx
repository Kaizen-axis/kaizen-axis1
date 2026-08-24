import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, LabelList } from 'recharts';
import { PremiumCard } from './PremiumComponents';
import { useApp } from '@/context/AppContext';


interface FunnelChartProps {
  clientsData?: Array<{ stage: string }>;
}

export const FunnelChart = ({ clientsData }: FunnelChartProps) => {
  const { clients } = useApp();
  const sourceClients = clientsData ?? clients;

  // Etapas reais do pipeline (CLIENT_STAGES em src/data/clients.ts)
  const data = [
    { name: 'Documentação', value: sourceClients.filter(c => c.stage === 'Documentação').length },
    { name: 'Em Análise', value: sourceClients.filter(c => c.stage === 'Em Análise').length },
    { name: 'Aprovados', value: sourceClients.filter(c => c.stage === 'Aprovado').length },
    { name: 'Concluídos', value: sourceClients.filter(c => c.stage === 'Concluído').length },
  ];

  return (
    <PremiumCard className="h-72 flex flex-col">
      <div className="mb-4">
        <h3 className="v3-serif text-lg text-text-primary tracking-tight">Funil de Conversão</h3>
        <p className="text-xs text-text-secondary">Clientes por etapa do pipeline</p>
      </div>
      <div className="flex-1 w-full -ml-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{
              top: 10,
              right: 30,
              left: 0,
              bottom: 0,
            }}
          >
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-surface-200)" />
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-card-bg)',
                borderColor: 'var(--color-surface-200)',
                borderRadius: '12px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                color: 'var(--color-text-primary)'
              }}
              itemStyle={{ color: 'var(--color-text-primary)' }}
              cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 4' }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#3b82f6"
              strokeWidth={3}
              fillOpacity={1}
              fill="url(#colorValue)"
              activeDot={{ r: 6, fill: '#3b82f6', stroke: 'var(--color-card-bg)', strokeWidth: 2 }}
            >
              <LabelList
                dataKey="value"
                position="top"
                offset={8}
                style={{ fill: 'var(--color-text-primary)', fontSize: 12, fontWeight: 700 }}
              />
            </Area>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </PremiumCard>
  );
};
