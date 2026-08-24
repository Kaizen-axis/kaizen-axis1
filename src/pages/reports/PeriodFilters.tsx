export function PeriodFilters({
  period,
  onPeriodChange,
}: {
  period: string;
  onPeriodChange: (period: string) => void;
}) {
  return (
    <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar pb-2 print:hidden">
      {['Mês vigente', '30 dias', '60 dias', '90 dias', 'Personalizado'].map((p) => (
        <button
          key={p}
          onClick={() => onPeriodChange(p)}
          className={`px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${period === p || (p === 'Personalizado' && period.includes('/'))
            ? 'bg-primary-600 text-white shadow-md'
            : 'bg-card-bg text-text-secondary border border-surface-200'
            }`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
