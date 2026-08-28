/**
 * Taxas de comissão — fonte canônica do frontend.
 * SYNC com supabase/migrations/20260827120000_commission_entries.sql
 * (trigger usa CORRETOR.ownRate * TAX_DEDUCTION para o ledger da venda).
 */
export const COMMISSION_CONFIG: Record<string, { ownRate: number; teamRate: number }> = {
  CORRETOR: { ownRate: 0.018, teamRate: 0 },
  COORDENADOR: { ownRate: 0.020, teamRate: 0.001 },
  GERENTE: { ownRate: 0.024, teamRate: 0.004 },
  DIRETOR: { ownRate: 0.024, teamRate: 0.001 },
};

export const TAX_DEDUCTION = 0.86;
export const BROKER_OWN_RATE = COMMISSION_CONFIG.CORRETOR.ownRate;

export type CommissionPaymentStatus = 'pending' | 'paid';
export type CommissionDisplayStatus = 'Pago' | 'Pendente' | 'Atrasado';

export function parseCurrency(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isNaN(value) ? 0 : value;
  const cleaned = String(value)
    .replace(/R\$\s*/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return parseFloat(cleaned) || 0;
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function calcBrokerCommission(vgv: number): number {
  return roundMoney(vgv * BROKER_OWN_RATE * TAX_DEDUCTION);
}

/** Comissão desta venda: corretor (própria) + coordenador/gerente (taxa de equipe). */
export function calcSaleCommissionSplit(vgv: number): {
  corretor: number;
  coordenador: number;
  gerente: number;
  total: number;
} {
  const corretor = calcBrokerCommission(vgv);
  const coordenador = calcRoleCommission(0, vgv, 'COORDENADOR').teamCommission;
  const gerente = calcRoleCommission(0, vgv, 'GERENTE').teamCommission;
  return {
    corretor,
    coordenador,
    gerente,
    total: roundMoney(corretor + coordenador + gerente),
  };
}

export function calcRoleCommission(vgvOwn: number, vgvTeam: number, role: string): {
  ownCommission: number;
  teamCommission: number;
  totalCommission: number;
} {
  const config = COMMISSION_CONFIG[role.toUpperCase()] ?? COMMISSION_CONFIG.CORRETOR;
  const ownCommission = roundMoney(vgvOwn * config.ownRate * TAX_DEDUCTION);
  const teamCommission = roundMoney(vgvTeam * config.teamRate * TAX_DEDUCTION);
  return {
    ownCommission,
    teamCommission,
    totalCommission: roundMoney(ownCommission + teamCommission),
  };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function deriveCommissionDisplayStatus(
  paymentStatus: CommissionPaymentStatus | string | null | undefined,
  dueDate: string | null | undefined,
  today: Date = new Date(),
): CommissionDisplayStatus {
  if (paymentStatus === 'paid') return 'Pago';
  if (!dueDate) return 'Pendente';
  if (dueDate < toDateOnly(today)) return 'Atrasado';
  return 'Pendente';
}

export function soldAtYearMonth(soldAt: string | null | undefined): { year: number; month: number } | null {
  if (!soldAt) return null;
  const date = new Date(soldAt);
  if (!Number.isNaN(date.getTime())) {
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
  }
  const match = String(soldAt).match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function isSoldInYearMonth(soldAt: string | null | undefined, year: number, month: number): boolean {
  const parts = soldAtYearMonth(soldAt);
  return !!parts && parts.year === year && parts.month === month;
}
