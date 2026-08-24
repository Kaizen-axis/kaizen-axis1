import type { Team } from '@/context/AppContext';
import type { CategorySlice } from '@/types/reports';

// ─── Shared report helpers ────────────────────────────────────────────────────
// Single source of truth for logic previously duplicated between
// src/pages/Reports.tsx and src/pages/admin/AdminPanel.tsx.

/** Parse "R$ 1.500.000,00" or "1500000,00" → 1500000 */
export function parseCurrency(v: string | undefined | null): number {
  if (!v) return 0;
  return parseFloat(String(v).replace(/[^\d,]/g, '').replace(',', '.')) || 0;
}

export function parseIsoDate(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

/** Sale = stage 'Concluído' whose closed_at falls inside [start, end] (ms; null = unbounded) */
export function isSaleInPeriod(
  client: { stage?: string; closed_at?: string | null },
  start: number | null,
  end: number | null,
): boolean {
  if (client?.stage !== 'Concluído') return false;
  const saleDate = parseIsoDate(client?.closed_at);
  if (saleDate === null) return false;
  if (start !== null && saleDate < start) return false;
  if (end !== null && saleDate > end) return false;
  return true;
}

export const normalizeTeamRef = (value?: string | null) => String(value || '').trim().toLowerCase();

/** Normalize free text for grouping (accents/case-insensitive: "CAMPO GRANDE" = "campo grande") */
export const normalizeText = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export interface TeamLikeProfile {
  id: string;
  role?: string;
  team?: string | null;
  team_id?: string | null;
  manager_id?: string | null;
  coordinator_id?: string | null;
}

export function profileMatchesTeam(
  profile: { team?: string | null; team_id?: string | null },
  team: Team,
): boolean {
  if (profile.team_id === team.id || profile.team === team.id) return true;

  // Legacy fallback: some older records store the team name in `profiles.team`
  const profileTeamName = normalizeTeamRef(profile.team);
  const teamName = normalizeTeamRef(team.name);
  return profileTeamName.length > 0 && profileTeamName === teamName;
}

/**
 * Members of a team:
 * - team.members[] is the authoritative list (set by the approval flow)
 * - fallback: profile.team can store UUID or legacy team name
 * - always include the team manager, their linked coordinators and those coordinators' brokers
 */
export function getTeamMemberIds(team: Team, profiles: TeamLikeProfile[]): string[] {
  const directMembers = profiles.filter(p => profileMatchesTeam(p, team)).map(p => p.id);
  const managerId = team.manager_id || null;
  const managerLinked = managerId
    ? profiles.filter(p => p.manager_id === managerId).map(p => p.id)
    : [];

  const coordinatorIds = managerId
    ? profiles
      .filter(p => p.role?.toUpperCase() === 'COORDENADOR' && p.manager_id === managerId)
      .map(p => p.id)
    : [];

  const coordinatorLinkedBrokers = coordinatorIds.length > 0
    ? profiles
      .filter(p => p.role?.toUpperCase() === 'CORRETOR' && p.coordinator_id && coordinatorIds.includes(p.coordinator_id))
      .map(p => p.id)
    : [];

  return Array.from(new Set([
    ...(team.members ?? []),
    ...directMembers,
    ...(managerId ? [managerId] : []),
    ...managerLinked,
    ...coordinatorIds,
    ...coordinatorLinkedBrokers,
  ]));
}

/** "João da Silva" → "João S." */
export function formatBrokerDisplayName(name?: string | null): string {
  const normalized = String(name || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return 'Sem nome';

  const parts = normalized.split(' ');
  const first = parts[0] || '';
  if (!first || first === '.') return 'Sem nome';
  if (parts.length === 1) return first;

  const last = parts[parts.length - 1] || '';
  const initial = last.charAt(0).toUpperCase();
  if (!initial || initial === '.') return first;

  return `${first} ${initial}.`;
}

/** Group clients by a free-text getter, returning sorted slices with percentages */
export function aggregateClientsBy(
  getter: (c: any) => string | undefined | null,
  list: any[],
): CategorySlice[] {
  const map = new Map<string, { label: string; value: number }>();
  list.forEach((c) => {
    const raw = (getter(c) || '').trim().replace(/\s+/g, ' ');
    if (!raw) return;
    const key = normalizeText(raw);
    const existing = map.get(key);
    if (existing) existing.value += 1;
    else map.set(key, { label: raw, value: 1 });
  });
  const total = Array.from(map.values()).reduce((a, b) => a + b.value, 0);
  return Array.from(map.values(), ({ label, value }) => ({
    name: label,
    value,
    percentual: total > 0 ? Number(((value / total) * 100).toFixed(1)) : 0,
  })).sort((a, b) => b.value - a.value);
}
