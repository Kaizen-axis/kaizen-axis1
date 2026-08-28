export const USER_ROLE_OPTIONS = [
  { value: 'CORRETOR', label: 'CORRETOR' },
  { value: 'COORDENADOR', label: 'COORDENADOR' },
  { value: 'GERENTE', label: 'GERENTE' },
  { value: 'DIRETOR', label: 'DIRETOR' },
  { value: 'ADMIN', label: 'ADMIN' },
  { value: 'RECEPCAO', label: 'RECEPÇÃO' },
  { value: 'RECEPCAO_ZN', label: 'RECEPÇÃO ZN' },
  { value: 'ANALISTA', label: 'ANALISTA' },
] as const;

export type UserRole = typeof USER_ROLE_OPTIONS[number]['value'];
export type ReceptionRole = Extract<UserRole, 'RECEPCAO' | 'RECEPCAO_ZN'>;

const ROLE_VALUES = new Set<string>(USER_ROLE_OPTIONS.map(option => option.value));
const RECEPTION_UNIT_BY_ROLE: Record<ReceptionRole, 'zona_oeste' | 'zona_norte'> = {
  RECEPCAO: 'zona_oeste',
  RECEPCAO_ZN: 'zona_norte',
};

export function normalizeUserRole(value: unknown): UserRole {
  const normalized = String(value ?? '').trim().toUpperCase();
  return ROLE_VALUES.has(normalized) ? normalized as UserRole : 'CORRETOR';
}

export function isReceptionRole(value: unknown): value is ReceptionRole {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'RECEPCAO' || normalized === 'RECEPCAO_ZN';
}

export function getReceptionUnitCode(value: unknown): 'zona_oeste' | 'zona_norte' | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return isReceptionRole(normalized) ? RECEPTION_UNIT_BY_ROLE[normalized] : null;
}

export function getUserRoleLabel(value: unknown): string {
  const normalized = normalizeUserRole(value);
  return USER_ROLE_OPTIONS.find(option => option.value === normalized)?.label ?? normalized;
}
