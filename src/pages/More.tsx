import { PremiumCard, PageHeader } from '@/components/ui/PremiumComponents';
import { Building2, CheckSquare, GraduationCap, Calculator, Settings, ChevronRight, BarChart3, Lock, FileType, Globe, QrCode, Home } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthorization } from '@/hooks/useAuthorization';

const menuItems = [
  { icon: QrCode, label: 'Check-in', path: '/checkin', desc: 'Marcar presença diária' },
  { icon: Building2, label: 'Empreendimentos', path: '/developments', desc: 'Catálogo completo' },
  { icon: Globe, label: 'Portais', path: '/portals', desc: 'Caixa e Construtoras' },
  { icon: Calculator, label: 'Apuração de Renda', path: '/income', desc: 'Análise de crédito' },
  { icon: Home, label: 'Amortização', path: '/amortization', desc: 'Simulador de Amortização' },
  { icon: BarChart3, label: 'Relatórios', path: '/reports', desc: 'Inteligência e Forecast' },
  { icon: FileType, label: 'Conversor de PDF', path: '/pdf-tools', desc: 'Ferramentas de documentos' },
  { icon: CheckSquare, label: 'Tarefas', path: '/tasks', desc: 'Minhas pendências' },
  { icon: GraduationCap, label: 'Treinamentos', path: '/training', desc: 'Universidade corporativa' },
  { icon: Settings, label: 'Configurações', path: '/settings', desc: 'Preferências do app' },
];

export default function More() {
  const navigate = useNavigate();
  const { isAdmin, isManager, isCoordinator, isDirector, canAccessIncomeAnalysis } = useAuthorization();
  const isAdminOrDirector = isAdmin || isDirector;

  return (
    <div className="p-6 pb-24 min-h-screen bg-surface-50">
      <PageHeader title="Menu" subtitle="Acesse todas as ferramentas e áreas do app." />

      {/* Administrativo — Admin + Liderança */}
      {(isAdmin || isDirector || isManager || isCoordinator) && (
        <div className="mb-6">
          <h3 className="text-xs font-bold text-text-secondary uppercase mb-2 px-2">Administrativo</h3>
          <div className="space-y-3">
            {isAdminOrDirector && (
              <PremiumCard
                className="flex items-center gap-4 p-4 bg-gradient-to-r from-gray-900 to-gray-800 text-white border-none cursor-pointer"
                onClick={() => navigate('/admin')}
              >
                <div className="w-10 h-10 rounded-xl bg-card-bg/10 flex items-center justify-center backdrop-blur-sm">
                  <Lock size={20} className="text-gold-400" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-white">Painel Administrativo</h3>
                  <p className="text-xs text-gray-300">Governança e Controle</p>
                </div>
                <ChevronRight size={20} className="text-text-secondary" />
              </PremiumCard>
            )}
            {isAdminOrDirector && (
              <PremiumCard
                className="flex items-center gap-4 p-4 bg-gradient-to-r from-gray-900 to-gray-800 text-white border-none cursor-pointer"
                onClick={() => navigate('/checkin/display')}
              >
                <div className="w-10 h-10 rounded-xl bg-card-bg/10 flex items-center justify-center backdrop-blur-sm">
                  <QrCode size={20} className="text-gold-400" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-white">Tela de Check-in</h3>
                  <p className="text-xs text-gray-300">QR diário para a recepção</p>
                </div>
                <ChevronRight size={20} className="text-text-secondary" />
              </PremiumCard>
            )}
          </div>
        </div>
      )}

      {/* All menu items visible to all roles — data is scoped by RLS */}
      <div className="space-y-3">
        {menuItems
          .filter(item => {
            const leadershipOnly = !isAdmin && !isDirector && !isManager && !isCoordinator;
            if (item.path === '/amortization' && leadershipOnly) return false;
            if (item.path === '/income' && !canAccessIncomeAnalysis) return false;
            return true;
          })
          .map((item) => {
            return (
              <Link key={item.path} to={item.path}>
                <PremiumCard interactive="list" className="flex items-center gap-4 py-4">
                  <div className="w-10 h-10 rounded-full bg-surface-100 flex items-center justify-center text-text-secondary">
                    <item.icon size={20} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-text-primary">{item.label}</h4>
                    <p className="text-xs text-text-secondary">{item.desc}</p>
                  </div>
                  <ChevronRight size={18} className="text-surface-300" />
                </PremiumCard>
              </Link>
            );
          })}
      </div>
    </div>
  );
}
