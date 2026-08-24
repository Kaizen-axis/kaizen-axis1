import { PremiumCard, SectionHeader } from '@/components/ui/PremiumComponents';
import { PipelineStageCount } from '@/lib/reports/computeHybridMetrics';

export function PipelineByStage({
  pipeline,
  totalClientes,
}: {
  pipeline: PipelineStageCount[];
  totalClientes: number;
}) {
  return (
    <section className="mb-6">
      <SectionHeader title="Pipeline por Etapa" subtitle="Clientes criados no período por estágio atual" />
      <PremiumCard className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50 dark:bg-surface-100">
              <th className="text-left p-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Etapa</th>
              <th className="text-center p-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Clientes</th>
              <th className="text-center p-3 text-xs font-medium text-text-secondary uppercase tracking-wide">%</th>
            </tr>
          </thead>
          <tbody>
            {pipeline.map((row) => (
              <tr key={row.stage} className="border-b border-surface-100 last:border-0 hover:bg-surface-50 transition-colors">
                <td className="p-3 font-medium text-text-primary">{row.stage}</td>
                <td className="p-3 text-center text-text-secondary">{row.count}</td>
                <td className="p-3 text-center">
                  <span className="text-xs font-bold text-text-secondary">
                    {totalClientes > 0 ? Math.round((row.count / totalClientes) * 100) : 0}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PremiumCard>
    </section>
  );
}
