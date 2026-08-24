import { Team } from '@/data/admin';
import { PremiumCard, RoundedButton } from '@/components/ui/PremiumComponents';
import { Users, UserPlus, Settings } from 'lucide-react';

interface TeamCardProps {
  team: Team;
  onManage?: (id: string) => void;
}

export function TeamCard({ team, onManage }: TeamCardProps) {
  return (
    <PremiumCard className="p-4">
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-subtle flex items-center justify-center text-gold-600 dark:text-gold-400">
            <Users size={20} />
          </div>
          <div>
            <h4 className="font-bold text-text-primary text-sm">{team.name}</h4>
            <p className="text-xs text-text-secondary">{team.members.length} membros</p>
          </div>
        </div>
        <button 
          onClick={() => onManage?.(team.id)}
          className="p-1.5 rounded-lg hover:bg-surface-100 text-text-secondary transition-colors"
        >
          <Settings size={16} />
        </button>
      </div>
      
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">Líder:</span>
          <span className="font-medium text-text-primary">{team.managerId ? 'Ana Gerente' : 'Não definido'}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">Vendas Totais:</span>
          <span className="font-bold text-green-600 dark:text-green-400">{team.totalSales}</span>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-surface-100 flex justify-center">
        <button className="text-xs font-medium text-gold-600 dark:text-gold-400 flex items-center gap-1 hover:underline">
          <UserPlus size={14} /> Gerenciar Membros
        </button>
      </div>
    </PremiumCard>
  );
}
