import { ReactNode, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Shield } from 'lucide-react';
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
  renderActions?: (team: Team) => ReactNode;
}

const CARD_STEP = 182; // 170px do card + 12px de gap

export function TeamCardGrid({ teams, clients, startDate, endDate, from, fromId, fromName, renderActions }: TeamCardGridProps) {
  const navigate = useNavigate();
  const { allProfiles } = useApp();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    updateScrollState();
    window.addEventListener('resize', updateScrollState);
    return () => window.removeEventListener('resize', updateScrollState);
  }, [teams.length]);

  const scrollByCard = (direction: 1 | -1) => {
    scrollRef.current?.scrollBy({ left: direction * CARD_STEP, behavior: 'smooth' });
  };

  const arrowClass =
    'absolute top-1/2 -translate-y-1/2 z-10 h-8 w-8 rounded-full bg-card-bg border border-surface-200 shadow-md flex items-center justify-center text-text-secondary hover:text-gold-700 hover:border-gold-300 transition-all';

  return (
    <div className="relative">
      {canScrollLeft && (
        <button type="button" aria-label="Equipes anteriores" onClick={() => scrollByCard(-1)} className={`${arrowClass} left-1`}>
          <ChevronLeft size={16} />
        </button>
      )}

      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory no-scrollbar pb-2 -mx-1 px-1"
      >
        {teams.map((team) => {
          const memberIds = getTeamMemberIds(team, allProfiles);
          const teamClients = clients.filter((c) => memberIds.includes(c.owner_id || ''));
          const teamMetrics = computeHybridMetrics(teamClients, startDate, endDate);
          const managerName = allProfiles.find((p) => p.id === team.manager_id)?.name ?? '—';
          return (
            <PremiumCard
              key={team.id}
              className="relative min-w-[170px] w-[170px] aspect-square snap-start p-4 cursor-pointer hover:border-gold-300 transition-colors flex flex-col justify-between shrink-0"
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
              {renderActions && (
                <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
                  {renderActions(team)}
                </div>
              )}
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

      {canScrollRight && (
        <button type="button" aria-label="Próximas equipes" onClick={() => scrollByCard(1)} className={`${arrowClass} right-1`}>
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}
