import React, { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, Calendar, MessageSquare, Menu, Calculator, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'motion/react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useChatUnread } from '@/context/ChatUnreadContext';
import { useGsapPageTransition } from '@/lib/motion';

/** Detecta se o teclado virtual está aberto no iOS via visualViewport */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setOpen(vv.height < window.innerHeight * 0.75);
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);
  return open;
}

export const BottomNav = () => {
  const location = useLocation();
  const { isAnalyst } = useAuthorization();
  const keyboardOpen = useKeyboardOpen();
  const { totalUnread } = useChatUnread();

  const navItems = isAnalyst
    ? [
      { icon: Calculator, label: 'Apuração', path: '/income' },
      { icon: Settings, label: 'Config.', path: '/settings' },
    ]
    : [
      { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
      { icon: Users, label: 'Clientes', path: '/clients' },
      { icon: Calendar, label: 'Agenda', path: '/schedule' },
      { icon: MessageSquare, label: 'Chat', path: '/chat' },
      { icon: Menu, label: 'Mais', path: '/more' },
    ];

  return (
    <div className={cn("fixed bottom-0 left-0 right-0 bg-card-bg/90 backdrop-blur-md border-t border-surface-200/80 pb-safe pt-2 px-4 shadow-[0_-4px_20px_rgba(0,0,0,0.4)] z-50 print:hidden", keyboardOpen && "hidden")}>
      <div className="flex justify-between items-center max-w-md mx-auto">
        {navItems.map((item) => {
          const isActive = item.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.path);

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => cn(
                "flex flex-col items-center justify-center p-2 rounded-xl transition-all duration-300 w-16",
                isActive ? "text-primary-400" : "text-text-secondary hover:text-text-primary"
              )}
            >
              <div className="relative">
                <item.icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                {item.path === '/chat' && totalUnread > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {totalUnread > 99 ? '99+' : totalUnread}
                  </span>
                )}
                {isActive && (
                  <motion.div
                    layoutId="nav-indicator"
                    className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary-500"
                  />
                )}
              </div>
              <span className="text-[10px] font-medium mt-1">{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </div>
  );
};

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const contentRef = useGsapPageTransition<HTMLDivElement>(location.pathname);
  return (
    <div className="min-h-screen bg-surface-50 pb-24 max-w-md mx-auto shadow-2xl shadow-black/5 relative overflow-x-hidden print:pb-0 print:max-w-none print:shadow-none print:bg-white print:overflow-visible print:px-4">
      <main className="h-full overflow-y-auto overflow-x-hidden overscroll-x-none no-scrollbar print:overflow-visible print:h-auto">
        <div ref={contentRef}>{children}</div>
      </main>
      <BottomNav />
    </div>
  );
};

export const FAB = ({ onClick, icon: Icon }: { onClick?: () => void, icon?: React.ElementType }) => {
  const DefaultIcon = () => <span className="text-xl font-bold">+</span>;
  const IconComp = Icon ?? DefaultIcon;
  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className="fixed bottom-24 right-6 w-14 h-14 bg-primary-600 text-white rounded-full shadow-lg shadow-primary-500/30 flex items-center justify-center z-40 cursor-pointer print:hidden"
    >
      <IconComp size={24} />
    </motion.button>
  );
};
