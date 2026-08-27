import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Calendar, MessageSquare, Building2,
  CheckSquare, GraduationCap, Calculator, Settings, BarChart3,
  FileType, Globe, QrCode, Home, Lock, ChevronRight, ChevronLeft, LogOut,
  Bell, PanelLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGsapPageTransition } from '@/lib/motion';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useApp } from '@/context/AppContext';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { useChatUnread } from '@/context/ChatUnreadContext';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

// ─── Nav items definition ─────────────────────────────────────────────────────

interface NavItem {
  icon: React.ElementType;
  label: string;
  path: string;
  leadershipOnly?: boolean;
  adminOnly?: boolean;
  locked?: boolean;
}

const NAV_CORE: NavItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard',  path: '/' },
  { icon: Users,           label: 'Clientes',   path: '/clients' },
  { icon: Calendar,        label: 'Agenda',     path: '/schedule' },
  { icon: MessageSquare,   label: 'Chat',       path: '/chat' },
];

const NAV_TOOLS: NavItem[] = [
  { icon: Building2,  label: 'Empreendimentos', path: '/developments' },
  { icon: Globe,      label: 'Portais',         path: '/portals' },
  { icon: QrCode,     label: 'Check-in',        path: '/checkin' },
  { icon: QrCode,     label: 'Tela Check-in',   path: '/checkin/display', adminOnly: true },
  { icon: CheckSquare,label: 'Tarefas',         path: '/tasks' },
  { icon: GraduationCap, label: 'Treinamentos', path: '/training' },
  { icon: FileType,   label: 'Conversor PDF',   path: '/pdf-tools' },
];

const NAV_REPORTS: NavItem[] = [
  { icon: BarChart3,  label: 'Relatórios',       path: '/reports',       leadershipOnly: true },
  { icon: Calculator, label: 'Apuração de Renda', path: '/income',       leadershipOnly: true },
  { icon: Home,       label: 'Amortização',       path: '/amortization', leadershipOnly: true },
];

const NAV_ADMIN: NavItem[] = [
  { icon: Lock, label: 'Painel Admin', path: '/admin', adminOnly: true },
];

// ─── Sidebar nav link ─────────────────────────────────────────────────────────

function SideNavLink({ item, unreadCount = 0, collapsed = false }: { item: NavItem; unreadCount?: number; collapsed?: boolean }) {
  const location = useLocation();
  const isActive = item.path === '/'
    ? location.pathname === '/'
    : location.pathname.startsWith(item.path);

  if (item.locked) {
    return (
      <div
        title={collapsed ? item.label : undefined}
        className={cn(
          'flex items-center rounded-xl text-sm font-medium text-text-secondary/70 bg-surface-100/60 cursor-not-allowed',
          collapsed ? 'justify-center py-2.5' : 'gap-3 px-3 py-2.5',
        )}
      >
        <item.icon size={18} strokeWidth={2} />
        {!collapsed && <span>{item.label}</span>}
        {!collapsed && <Lock size={14} className="ml-auto text-text-secondary/70" />}
      </div>
    );
  }

  return (
    <NavLink
      to={item.path}
      title={collapsed ? item.label : undefined}
      className={cn(
        'group flex items-center rounded-xl text-sm font-medium transition-all duration-200',
        collapsed ? 'justify-center py-2.5' : 'gap-3 px-3 py-2.5',
        isActive
          ? 'bg-gradient-to-r from-primary-600/20 to-primary-500/5 text-primary-200 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.28)]'
          : 'text-text-secondary hover:bg-surface-100 hover:text-text-primary',
      )}
    >
      <div className="relative flex-shrink-0">
        <item.icon size={18} strokeWidth={isActive ? 2.5 : 2} className={cn(isActive ? 'text-primary-400' : 'text-surface-500 group-hover:text-text-primary')} />
        {collapsed && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-card-bg" />
        )}
      </div>
      {!collapsed && <span>{item.label}</span>}
      {!collapsed && unreadCount > 0 && (
        <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
      {!collapsed && isActive && unreadCount === 0 && <ChevronRight size={16} className="ml-auto text-primary-400" />}
    </NavLink>
  );
}

// ─── Sidebar group ────────────────────────────────────────────────────────────

function NavGroup({ label, items, chatUnread, collapsed = false }: { label: string; items: NavItem[]; chatUnread?: number; collapsed?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {collapsed
        ? <div className="h-px bg-surface-200/70 mx-2 mb-1.5" />
        : <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-surface-500 px-3 mb-1.5">{label}</p>}
      {items.map(item => <SideNavLink key={item.path} item={item} unreadCount={item.path === '/chat' ? chatUnread : 0} collapsed={collapsed} />)}
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { isAdmin, isDirector, isManager, isCoordinator, isAnalyst, canAccessIncomeAnalysis } = useAuthorization();
  const { userName, profile, signOut } = useApp();
  const { totalUnread } = useChatUnread();
  const navigate = useNavigate();
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = React.useState(false);
  const [isSigningOut, setIsSigningOut] = React.useState(false);

  const isLeadership = isAdmin || isDirector || isManager || isCoordinator;
  const isAdminOrDirector = isAdmin || isDirector;

  const canAccessCheckInDisplay = isAdmin || isDirector || isManager;

  const filteredTools = NAV_TOOLS.filter(item => {
    if (item.path === '/checkin/display') return canAccessCheckInDisplay;
    return (!item.leadershipOnly || isLeadership) && (!item.adminOnly || isAdminOrDirector);
  });
  const filteredReports = NAV_REPORTS.filter(item => {
    if (item.path === '/income') return canAccessIncomeAnalysis;
    return !item.leadershipOnly || isLeadership;
  });
  const filteredAdmin = NAV_ADMIN.filter(item => !item.adminOnly || isAdminOrDirector);
  const reportsForRole = isAnalyst
    ? NAV_REPORTS.filter(item => item.path === '/income' && canAccessIncomeAnalysis)
    : filteredReports;

  const handleConfirmLogout = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      navigate('/login');
    } finally {
      setIsSigningOut(false);
      setIsLogoutConfirmOpen(false);
    }
  };

  const allGroups = isAnalyst
    ? [{ label: 'Análise', items: reportsForRole }]
    : [
      { label: 'Principal', items: NAV_CORE },
      { label: 'Ferramentas', items: filteredTools },
      { label: 'Análise', items: reportsForRole },
      { label: 'Administrativo', items: filteredAdmin },
    ].filter(g => g.items.length > 0);

  return (
    <aside className={cn(
      'fixed top-0 left-0 h-screen bg-card-bg/95 backdrop-blur-md border-r border-surface-200/80 flex flex-col z-40 print:hidden transition-all duration-200',
      collapsed ? 'w-16' : 'w-64',
    )}>
      {/* Brand */}
      <div className={cn('h-16 flex items-center border-b border-surface-200/80', collapsed ? 'px-2 justify-center' : 'px-5')}>
        {collapsed ? (
          <button
            onClick={onToggle}
            title="Expandir menu"
            className="h-9 w-9 overflow-hidden rounded-xl shadow-lg shadow-primary-500/25 hover:opacity-90 transition-opacity"
          >
            <img src="/pwa-192x192.png" alt="Kaizen Axis" className="h-full w-full object-cover" />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <img src="/pwa-192x192.png" alt="Kaizen Axis" className="h-9 w-9 rounded-xl object-cover shadow-sm shadow-primary-500/25 flex-shrink-0" />
              <div className="min-w-0">
                <h1 className="v3-serif text-text-primary text-lg leading-none tracking-tight">Kaizen</h1>
                <p className="text-[10px] text-primary-400 font-semibold uppercase tracking-[0.24em] mt-0.5">Axis</p>
              </div>
            </div>
            <button
              onClick={onToggle}
              title="Recolher menu"
              className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-100 hover:text-text-primary transition-colors flex-shrink-0"
            >
              <ChevronLeft size={18} />
            </button>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className={cn('flex-1 overflow-y-auto py-4 space-y-5 no-scrollbar', collapsed ? 'px-2' : 'px-3')}>
        {allGroups.map(g => (
          <NavGroup key={g.label} label={g.label} items={g.items} chatUnread={totalUnread} collapsed={collapsed} />
        ))}
      </nav>

      {/* User footer */}
      <div className={cn('py-3 border-t border-surface-200/80', collapsed ? 'px-2' : 'px-3')}>
        <button
          onClick={() => navigate('/settings')}
          title={collapsed ? `${userName} — Configurações` : undefined}
          className={cn(
            'w-full flex items-center rounded-xl hover:bg-surface-100 transition-all group',
            collapsed ? 'justify-center py-2' : 'gap-3 px-3 py-2.5',
          )}
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm shadow-primary-500/25">
            {(userName || '?').charAt(0).toUpperCase()}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-semibold text-text-primary truncate">{userName}</p>
                <p className="text-[10px] text-text-secondary truncate">{profile?.role}</p>
              </div>
              <ChevronRight size={14} className="text-surface-400 group-hover:text-text-secondary transition-colors" />
            </>
          )}
        </button>
        <button
          onClick={() => setIsLogoutConfirmOpen(true)}
          title={collapsed ? 'Sair' : undefined}
          className={cn(
            'w-full flex items-center mt-1 rounded-xl text-sm text-text-secondary hover:text-red-500 hover:bg-red-500/10 transition-all',
            collapsed ? 'justify-center py-2' : 'gap-3 px-3 py-2',
          )}
        >
          <LogOut size={16} />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>

      <ConfirmDialog
        isOpen={isLogoutConfirmOpen}
        onClose={() => !isSigningOut && setIsLogoutConfirmOpen(false)}
        onConfirm={handleConfirmLogout}
        title="Confirmar saída"
        message="Tem certeza que deseja sair? Você precisará fazer login novamente para acessar o sistema."
        confirmLabel="Sair agora"
        loading={isSigningOut}
      />
    </aside>
  );
}

// ─── Desktop Layout ───────────────────────────────────────────────────────────

export function DesktopLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const toggleCollapsed = () => setCollapsed(prev => {
    const next = !prev;
    try { localStorage.setItem('sidebar-collapsed', String(next)); } catch { /* ignore */ }
    return next;
  });

  // Derive page title from current path
  const pageTitles: Record<string, string> = {
    '/':              'Dashboard',
    '/clients':       'Clientes',
    '/schedule':      'Agenda',
    '/chat':          'Chat',
    '/developments':  'Empreendimentos',
    '/portals':       'Portais',
    '/checkin':       'Check-in',
    '/tasks':         'Tarefas',
    '/training':      'Treinamentos',
    '/pdf-tools':     'Conversor de PDF',
    '/reports':       'Relatórios',
    '/income':        'Apuração de Renda',
    '/amortization':  'Amortização',
    '/admin':         'Painel Administrativo',
    '/settings':      'Configurações',
    '/more':          'Menu',
  };

  const currentTitle = Object.entries(pageTitles)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([path]) => location.pathname === path || location.pathname.startsWith(path + '/'))
    ?.[1] ?? 'Kaizen Axis';

  return (
    <div className="min-h-screen bg-surface-50 flex">
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />

      {/* Main content */}
      <div className={cn(
        'flex flex-col min-h-screen min-w-0 transition-all duration-200',
        collapsed ? 'ml-16 w-[calc(100%_-_4rem)]' : 'ml-64 w-[calc(100%_-_16rem)]',
      )}>
        {/* Top header */}
        <header className="sticky top-0 z-30 h-16 bg-card-bg/80 backdrop-blur-md border-b border-surface-200/80 flex items-center px-6 gap-4 print:hidden">
          {collapsed && (
            <button
              onClick={toggleCollapsed}
              title="Expandir menu"
              className="p-1.5 -ml-1 rounded-lg text-text-secondary hover:bg-surface-100 hover:text-text-primary transition-colors"
            >
              <PanelLeft size={18} />
            </button>
          )}
          <div className="flex-1" />
          <NotificationBell />
        </header>

        {/* Page content */}
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden overscroll-x-none print:overflow-visible print:h-auto">
          <div
            ref={useGsapPageTransition<HTMLDivElement>(location.pathname)}
            className="mx-auto w-full max-w-7xl px-2 sm:px-4 lg:px-6"
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
