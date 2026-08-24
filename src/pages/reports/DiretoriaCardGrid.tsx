import { ReactNode } from 'react';
import { Building2, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PremiumCard } from '@/components/ui/PremiumComponents';
import { Directorate, useApp } from '@/context/AppContext';
import { brl, computeHybridMetrics, ReportClientLike } from '@/lib/reports/computeHybridMetrics';
import { buildReportHref } from '@/lib/reports/reportNav';

interface DiretoriaCardGridProps {
  directorates: Directorate[];
  clients: ReportClientLike[];
  startDate: string;
  endDate: string;
  renderActions?: (directorate: Directorate) => ReactNode;
}

export function DiretoriaCardGrid({ directorates, clients, startDate, endDate, renderActions }: DiretoriaCardGridProps) {
  const navigate = useNavigate();
  const { allProfiles } = useApp();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {directorates.map((d) => {
        const dClients = clients.filter((c) => c.directorate_id === d.id);
        const metrics = computeHybridMetrics(dClients, startDate, endDate);
        const leaderName = allProfiles.find(
          (p) => p.directorate_id === d.id && p.role?.toUpperCase() === 'DIRETOR',
        )?.name ?? '—';
        return (
          <PremiumCard
            key={d.id}
            interactive
            className="relative p-4 flex flex-col gap-3"
            onClick={() => navigate(buildReportHref({
              scope: 'diretoria',
              id: d.id,
              name: d.name,
              start: startDate,
              end: endDate,
            }))}
          >
            {renderActions && (
              <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
                {renderActions(d)}
              </div>
            )}
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-accent-subtle flex items-center justify-center shrink-0">
                <Building2 size={18} className="text-gold-500" />
              </div>
              <h4 className="font-bold text-text-primary text-sm leading-tight truncate">{d.name}</h4>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="min-w-0">
                <p className="text-[9px] text-text-secondary uppercase tracking-wide">Receita</p>
                <p className="text-xs font-bold text-green-600 truncate">{brl(metrics.vgv)}</p>
              </div>
              <div>
                <p className="text-[9px] text-text-secondary uppercase tracking-wide">Vendas</p>
                <p className="text-xs font-bold text-text-primary">{metrics.vendas}</p>
              </div>
              <div>
                <p className="text-[9px] text-text-secondary uppercase tracking-wide">Clientes</p>
                <p className="text-xs font-bold text-text-primary">{metrics.createdInPeriodCount}</p>
              </div>
              <div>
                <p className="text-[9px] text-text-secondary uppercase tracking-wide">Conversão</p>
                <p className="text-xs font-bold text-gold-600">{metrics.taxaConversao}%</p>
              </div>
            </div>
            <div className="pt-2 border-t border-surface-100 flex items-center gap-1.5 min-w-0">
              <User size={12} className="text-gold-500 shrink-0" />
              <p className="text-[10px] text-text-secondary truncate">
                Liderados por <span className="text-gold-600 font-medium">{leaderName}</span>
              </p>
            </div>
          </PremiumCard>
        );
      })}
    </div>
  );
}
