export type GoalObjectiveType = 'sales' | 'approved_clients' | string | null | undefined;

export function goalObjectiveLabel(type?: GoalObjectiveType): string {
  return type === 'approved_clients' ? 'fichas aprovadas' : 'vendas';
}

export function goalObjectiveBadge(type?: GoalObjectiveType): string {
  return type === 'approved_clients' ? 'Fichas aprovadas' : 'Vendas';
}

export function formatGoalProgressLine(opts: {
  measureType?: string | null;
  objectiveType?: GoalObjectiveType;
  current: number;
  target: number;
  prefix?: string;
}): string {
  const label = goalObjectiveLabel(opts.objectiveType);
  const current = opts.current || 0;
  const target = opts.target || 0;
  const prefix = opts.prefix ? `${opts.prefix}: ` : '';

  if (opts.measureType === 'quantity') {
    return `${prefix}${current} de ${target} ${label}`;
  }

  const fmt = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  return `${prefix}${fmt(current)} de ${fmt(target)} em ${label}`;
}
