import { Team } from '@/context/AppContext';

const normalizeTeamRef = (value?: string | null) => String(value || '').trim().toLowerCase();

export function profileMatchesTeam(profile: { team?: string; team_id?: string | null }, team: Team): boolean {
  if (profile.team_id === team.id || profile.team === team.id) return true;
  const profileTeamName = normalizeTeamRef(profile.team);
  const teamName = normalizeTeamRef(team.name);
  return profileTeamName.length > 0 && profileTeamName === teamName;
}

export function getTeamMemberIds(team: Team, profiles: Array<{
  id: string;
  role?: string;
  team?: string;
  team_id?: string | null;
  manager_id?: string | null;
  coordinator_id?: string | null;
}>): string[] {
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
