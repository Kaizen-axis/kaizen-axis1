import React from 'react';
import { cn } from '@/lib/utils';
import { motion } from 'motion/react';

export const cardInteractiveHover =
  'cursor-pointer transition-all duration-200 hover:border-primary-400/50 hover:shadow-md hover:shadow-black/20 active:scale-[0.99]';

export const cardListInteractiveHover =
  'cursor-pointer transition-colors duration-200 hover:bg-surface-100/60';

interface PremiumCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  highlight?: boolean;
  interactive?: boolean | 'list';
}

export const PremiumCard = ({ children, className, highlight, interactive, ...props }: PremiumCardProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 } as any}
      animate={{ opacity: 1, y: 0 } as any}
      className={cn(
        "bg-card-bg rounded-2xl p-5 shadow-sm border border-surface-200",
        highlight && "border-gold-400/30 bg-gradient-to-br from-card-bg to-primary-500/10",
        interactive === true && cardInteractiveHover,
        interactive === 'list' && cardListInteractiveHover,
        className
      )}
      {...(props as any)}
    >
      {children}
    </motion.div>
  );
};

interface RoundedButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  children?: React.ReactNode;
  href?: string;
  target?: string;
}

export const RoundedButton = ({
  children,
  className,
  variant = 'primary',
  size = 'md',
  fullWidth,
  href,
  ...props
}: RoundedButtonProps) => {
  const variants = {
    primary: "bg-primary-600 text-white hover:bg-primary-700 shadow-sm shadow-primary-500/25 border border-transparent",
    secondary: "bg-surface-100 text-text-primary hover:bg-surface-200 border border-surface-200",
    outline: "border border-surface-200 text-text-secondary hover:bg-surface-100 hover:text-text-primary",
    ghost: "text-text-secondary hover:bg-surface-100 hover:text-text-primary border border-transparent",
  };

  const sizes = {
    sm: "px-4 py-2 text-sm",
    md: "px-6 py-3 text-base",
    lg: "px-8 py-4 text-lg",
  };

  const classes = cn(
    "rounded-xl font-medium transition-all flex items-center justify-center gap-2 cursor-pointer",
    variants[variant],
    sizes[size],
    fullWidth && "w-full",
    className
  );

  if (href) {
    return (
      <a
        href={href}
        className={classes}
        {...(props as any)}
      >
        {children}
      </a>
    );
  }

  return (
    <motion.button
      whileTap={{ scale: 0.98 } as any}
      className={classes}
      {...(props as any)}
    >
      {children}
    </motion.button>
  );
};

/**
 * Cabeçalho padrão de página (aba). Título serifado em tamanho único (text-3xl),
 * eyebrow opcional e frase explicativa. Use em todas as abas principais para
 * manter a padronização de tamanho/estilo dos títulos.
 */
export const PageHeader = ({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle?: string; action?: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-3 mb-5">
    <div className="min-w-0 flex-1">
      {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-400">{eyebrow}</p>}
      <h1 className="v3-serif text-2xl sm:text-3xl text-text-primary tracking-tight mt-1 leading-tight break-words">{title}</h1>
      {subtitle && <p className="text-sm text-text-secondary mt-1">{subtitle}</p>}
    </div>
    {action && <div className="flex-shrink-0 mt-1">{action}</div>}
  </div>
);

export const SectionHeader = ({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) => (
  <div className="flex items-center justify-between mb-4 px-1">
    <div>
      <h2 className="v3-serif text-xl text-text-primary tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm text-text-secondary mt-0.5">{subtitle}</p>}
    </div>
    {action}
  </div>
);

export const StatusBadge = ({ status, className }: { status: string; className?: string }) => {
  const styles: Record<string, string> = {
    // Client Stages
    'Documentação': 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-800',
    'Em Análise': 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-800',
    'Aprovado': 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-800',
    'Condicionado': 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border-orange-100 dark:border-orange-800',
    'Reprovado': 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-100 dark:border-red-800',
    'Agendamento': 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400 border-cyan-100 dark:border-cyan-800',
    'Em Tratativa': 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 border-purple-100 dark:border-purple-800',
    'Contrato': 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-800',
    'Formulários': 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 border-indigo-100 dark:border-indigo-800',
    'Conformidade': 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border-yellow-100 dark:border-yellow-800',
    'Abertura de Conta': 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400 border-teal-100 dark:border-teal-800',
    'Repasse': 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800',
    'Desistência': 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 border-rose-100 dark:border-rose-800',
    'Concluído': 'bg-gold-400 text-white border-gold-500 shadow-sm',
    'Pago': 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-800',
    'Atrasado': 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-100 dark:border-red-800',

    // Generic / Legacy
    'Pendente': 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-100 dark:border-yellow-800',
    'Lançamento': 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-100 dark:border-purple-800',
    'Em Construção': 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-100 dark:border-orange-800',
    'Pronto': 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 border-teal-100 dark:border-teal-800',
  };

  const defaultStyle = 'bg-surface-100 text-text-secondary border-surface-200';

  return (
    <span className={cn(
      "px-2.5 py-1 rounded-md text-xs font-medium border",
      styles[status] || defaultStyle,
      className
    )}>
      {status}
    </span>
  );
};
