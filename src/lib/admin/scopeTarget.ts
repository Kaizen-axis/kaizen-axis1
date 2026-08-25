export type ScopeType = 'All' | 'Directorate' | 'Team' | 'Coordinator' | 'User';

export const ANNOUNCEMENT_SCOPES: ScopeType[] = ['All', 'Directorate', 'Team', 'Coordinator', 'User'];
export const GOAL_SCOPES: ScopeType[] = ['All', 'Directorate', 'Team', 'Coordinator', 'User'];

export const SCOPE_LABELS: Record<ScopeType, string> = {
  All: 'Global',
  Directorate: 'Diretoria',
  Team: 'Equipe',
  Coordinator: 'Coordenação',
  User: 'Usuário',
};

export interface ScopeTargetValue {
  type: ScopeType;
  id?: string;
}

export interface NamedEntity {
  id: string;
  name?: string | null;
}

export interface ScopedProfile extends NamedEntity {
  role?: string | null;
  status?: string | null;
  directorate_id?: string | null;
  team_id?: string | null;
  team?: string | null;
  coordinator_id?: string | null;
}

export interface ScopedTeam extends NamedEntity {
  directorate_id?: string | null;
}

export function normalizeScopeType(value?: string | null): ScopeType {
  const v = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (!v || v === 'all' || v === 'global') return 'All';
  if (v === 'directorate' || v === 'diretoria') return 'Directorate';
  if (v === 'team' || v === 'equipe') return 'Team';
  if (v === 'coordinator' || v === 'coordenacao' || v === 'coordenator') return 'Coordinator';
  if (v === 'user' || v === 'individual') return 'User';
  return 'All';
}

export function resolveAssigneeLabel(
  target: { assignee_type?: string | null; assignee_id?: string | null; directorate_id?: string | null },
  catalogs: {
    directorates?: NamedEntity[];
    teams?: NamedEntity[];
    profiles?: Array<NamedEntity & { role?: string | null }>;
  },
): string {
  const type = normalizeScopeType(target.assignee_type || (target.directorate_id ? 'Directorate' : 'All'));
  const id = target.assignee_id || (type === 'Directorate' ? target.directorate_id : undefined);
  if (type === 'All') return 'Global';

  const nameOf = (list?: NamedEntity[]) => list?.find((item) => item.id === id)?.name || null;

  if (type === 'Directorate') return nameOf(catalogs.directorates) || 'Diretoria';
  if (type === 'Team') return nameOf(catalogs.teams) || 'Equipe';
  if (type === 'Coordinator') {
    const profile = catalogs.profiles?.find((item) => item.id === id);
    return profile?.name ? `Coordenação · ${profile.name}` : 'Coordenação';
  }
  const profile = catalogs.profiles?.find((item) => item.id === id);
  return profile?.name || 'Usuário';
}

export function resolveDirectorateIdForTarget(
  value: ScopeTargetValue,
  catalogs: {
    directorates?: NamedEntity[];
    teams?: ScopedTeam[];
    profiles?: ScopedProfile[];
    fallbackDirectorateId?: string | null;
  },
): string | null {
  if (value.type === 'All') return catalogs.fallbackDirectorateId ?? null;
  if (value.type === 'Directorate') return value.id || catalogs.fallbackDirectorateId || null;
  if (value.type === 'Team') {
    const team = catalogs.teams?.find((item) => item.id === value.id);
    return team?.directorate_id || catalogs.fallbackDirectorateId || null;
  }
  const profile = catalogs.profiles?.find((item) => item.id === value.id);
  return profile?.directorate_id || catalogs.fallbackDirectorateId || null;
}

export function isGoalVisibleToUser(
  goal: { assignee_type?: string | null; assignee_id?: string | null },
  ctx: {
    userId?: string | null;
    directorateId?: string | null;
    teamIds?: Array<string | null | undefined>;
    coordinatorId?: string | null;
  },
): boolean {
  const type = normalizeScopeType(goal.assignee_type);
  const id = goal.assignee_id || '';
  if (type === 'All') return true;
  if (!id) return false;
  if (type === 'User') return id === ctx.userId;
  if (type === 'Team') return (ctx.teamIds || []).filter(Boolean).includes(id);
  if (type === 'Directorate') return !!ctx.directorateId && id === ctx.directorateId;
  if (type === 'Coordinator') return id === ctx.userId || (!!ctx.coordinatorId && id === ctx.coordinatorId);
  return false;
}
