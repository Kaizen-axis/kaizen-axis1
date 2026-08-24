import { Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PremiumCard } from '@/components/ui/PremiumComponents';
import { Team, useApp } from '@/context/AppContext';
import { computeHybridMetrics, ReportClientLike } from '@/lib/reports/computeHybridMetrics';
import { buildReportHref, ReportScope } from '@/lib/reports/reportNav';
import { getTeamMemberIds } from '@/lib/reports/teamMembers';

interface TeamCardGridProps {
  teams: Team[];
  clients: ReportClientLike[];
  startDate: string;
  endDate: string;
  from?: ReportScope;
  fromId?: string;
  fromName?: string;
}

export function TeamCardGrid({ teams, clients, startDate, endDate, from, fromId, fromName }: TeamCardGridProps) {
  const navigate = useNavigate();
  const { allProfiles } = useApp();

  return (
    <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1">
      {teams.map((team) => {
        const memberIds = getTeamMemberIds(team, allProfiles);
        const teamClients = clients.filter((c) => memberIds.includes(c.owner_id || ''));
        const teamMetrics = computeHybridMetrics(teamClients, startDate, endDate);
        const managerName = allProfiles.find((p) => p.id === team.manager_id)?.name ?? '—';
        return (
          <PremiumCard
            key={team.id}
            className="min-w-[170px] w-[170px] aspect-square snap-start p-4 cursor-pointer hover:border-gold-300 transition-colors flex flex-col justify-between shrink-0"
            onClick={() => navigate(buildReportHref({
              scope: 'equipe',
              id: team.id,
              name: team.name,
              from,
              fromId,
              fromName,
              start: startDate,
              end: endDate,
            }))}
          >
            <div className="min-w-0">
              <div className="w-9 h-9 rounded-xl bg-gold-50 dark:bg-gold-900/20 flex items-center justify-center mb-2">
                <Shield size={18} className="text-gold-500" />
              </div>
              <h4 className="font-bold text-text-primary text-sm leading-tight truncate">{team.name}</h4>
              <p className="text-[10px] text-text-secondary truncate">Gerente: {managerName}</p>
              <p className="text-[10px] text-text-secondary">{memberIds.length} membro{memberIds.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="pt-2 border-t border-surface-100">
              <p className="text-[10px] text-text-secondary">{teamMetrics.totalClientes} clientes</p>
              <p className="text-xs font-bold text-green-600">{teamMetrics.vendas} vendas</p>
            </div>
          </PremiumCard>
        );
      })}
    </div>
  );
}
